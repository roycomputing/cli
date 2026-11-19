import { createReadStream } from "node:fs";
import { InvalidArgumentError, Option, type Command } from "commander";
import { computerHelp, computerTarget } from "./target.js";
import { api, mutate } from "./client.js";
import { json } from "./http.js";
import { computerId, containerName, example, output, table } from "./output.js";
import { sshFingerprint } from "./ssh-fingerprint.js";
import { sshKeys } from "./schemas.js";

async function publicKey(file: string): Promise<{ key: string; comment: string }> {
  if (file === "-" && process.stdin.isTTY) {
    throw new Error("Pipe an OpenSSH public key to stdin or use --key-file <path>.");
  }
  const input = file === "-" ? process.stdin : createReadStream(file);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError("Expected a public key file.");
    }
    size += chunk.length;
    if (size > 8194) {
      throw new Error("Public key exceeds 8192 bytes.");
    }
    chunks.push(chunk);
  }
  const line = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/u, "");
  const fields = /^((?:ssh-|ecdsa-|sk-)[\w@.-]+)[ \t]+([A-Za-z0-9+/]+={0,2})(?:[ \t]+(.*))?$/u.exec(
    line,
  );
  const [, type, blob, comment = ""] = fields ?? [];
  if (!type || !blob || line.includes("\0")) {
    throw new Error("Expected one OpenSSH public key. Use the .pub file.");
  }
  return { key: type + " " + blob, comment };
}

function fingerprintArgument(value: string): string {
  if (!/^SHA256:[A-Za-z0-9+/]{43}(?![\s\S])/u.test(value)) {
    throw new InvalidArgumentError("Use the full SHA256: fingerprint from roy ssh-keys list.");
  }
  return value;
}

const characters = new Intl.Segmenter("en", { granularity: "grapheme" });

function shortComment(comment: string): string {
  const parts = Array.from(characters.segment(comment), (part) => part.segment);
  return parts.length > 30 ? parts.slice(0, 29).join("") + "…" : comment;
}

async function listKeys(path: string, token: string, hint?: string) {
  const data = await json(await api(path, { token, hint }), sshKeys);
  const keys = data.keys.map((entry) =>
    Object.assign(entry, { fingerprint: sshFingerprint(entry.key) }),
  );
  return { ...data, keys };
}

function matchingKey(
  keys: { key: string; fingerprint: string | null }[],
  fingerprint: string,
  inspect: string,
): string {
  const matches = new Set(
    keys.filter((entry) => entry.fingerprint === fingerprint).map((entry) => entry.key),
  );
  if (matches.size > 1) {
    throw new Error(`Different keys share ${fingerprint}. Use --key-file to select the exact key.`);
  }
  const key = matches.values().next().value;
  if (!key) {
    throw new Error(`No SSH key matches ${fingerprint}. Check the fingerprints with ${inspect}.`);
  }
  return key;
}

export function registerKeys(program: Command): void {
  const group = program
    .command("ssh-keys")
    .description("Manage SSH public keys for the roy account");
  for (const verb of ["list", "add", "remove"]) {
    const cmd = group
      .command(verb)
      .description(`${verb} SSH public keys for the host or one container`)
      .option("--computer <id>", computerHelp, computerId)
      .option("--container <name>", "target this container (default: host)", containerName);
    const fileHelp = "OpenSSH public key file, or - for stdin";
    if (verb === "remove") {
      cmd
        .option("--key-file <path>", fileHelp)
        .addOption(
          new Option("--fingerprint <fingerprint>", "SHA256 fingerprint from roy ssh-keys list")
            .argParser(fingerprintArgument)
            .conflicts("keyFile"),
        );
    }
    if (verb === "add") {
      cmd.requiredOption("--key-file <path>", fileHelp);
      cmd.option("--comment <text>", "override the public key comment");
    }
    example(
      cmd,
      verb === "remove"
        ? "ssh-keys remove --container website --fingerprint <fingerprint>"
        : `ssh-keys ${verb} --container website${verb === "add" ? " --key-file ~/.ssh/id_ed25519.pub" : ""}`,
    ).action(
      async (options: {
        computer?: string;
        container?: string;
        keyFile?: string;
        fingerprint?: string;
        comment?: string;
      }) => {
        const file = options.keyFile ? await publicKey(options.keyFile) : undefined;
        if (verb !== "list" && !file && !options.fingerprint) {
          cmd.error("Specify --fingerprint <fingerprint> or --key-file <path>.");
        }
        const { id: computer, token } = await computerTarget(options.computer);
        const target = options.container ? `containers/${options.container}` : "host";
        const path = `computers/${computer}/${target}/ssh-keys`;
        const hint = options.container
          ? `Inspect with: roy containers list --computer ${computer}`
          : undefined;
        if (verb === "list") {
          const data = await listKeys(path, token, hint);
          const text = table(
            ["FINGERPRINT", "COMMENT"],
            data.keys.map((k) => [
              k.fingerprint ?? "Fingerprint unavailable",
              shortComment(k.comment),
            ]),
            "No SSH keys.",
          );
          const invalid = data.invalidLineNumbers ?? [];
          output(
            cmd,
            data,
            invalid.length > 0 ? `${text}\nInvalid key lines: ${invalid.join(", ")}` : text,
          );
          return;
        }
        const inspect = `roy ssh-keys list --computer ${computer}${options.container ? ` --container ${options.container}` : ""}`;
        let key = file?.key;
        if (options.fingerprint) {
          const { keys } = await listKeys(path, token, hint);
          key = matchingKey(keys, options.fingerprint, inspect);
        }
        await mutate(
          path,
          verb === "add" ? "POST" : "DELETE",
          204,
          verb === "add" ? { key, comment: options.comment ?? file?.comment } : { key },
          `Inspect keys with: ${inspect}. ${hint ?? ""}`.trimEnd(),
          token,
        );
        output(
          cmd,
          {
            computer,
            container: options.container,
            status: verb === "add" ? "present" : "absent",
          },
          `SSH public key is ${verb === "add" ? "present" : "absent"} on ${options.container ?? "the host"}.`,
        );
      },
    );
  }
}
