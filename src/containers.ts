import { setTimeout as sleep } from "node:timers/promises";
import { InvalidArgumentError, type Command } from "commander";
import { computerHelp, computerTarget } from "./target.js";
import { localTimezone } from "./timezone.js";
import { accessToken } from "./credentials.js";
import { connectionPort, containerTable, withSshCommand } from "./container-list.js";
import { api, mutate } from "./client.js";
import { json } from "./http.js";
import { computerId, containerName, example, output, timeAgo } from "./output.js";
import { detail, refresh } from "./schemas.js";

function waitSeconds(value: string): number {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
    throw new InvalidArgumentError("Use a whole number of seconds between 1 and 3600.");
  }
  return seconds;
}

async function fetchContainers(id: string, token: string, name: string | undefined, wait: number) {
  const signal = wait > 0 ? AbortSignal.timeout(wait * 1000) : undefined;
  const listCommand = `roy containers list --computer ${id}`;
  let timeoutMessage = "Container list unavailable.";
  let bearer = token;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const data = await json(
        await api(`computers/${id}/refresh-state`, { method: "POST", token: bearer, signal }),
        refresh,
      );
      const snapshot = data.state_cache?.snapshot;
      if (snapshot) {
        const selected = name
          ? snapshot.containers.filter((c) => c.name === name)
          : snapshot.containers;
        const ready = selected.some((c) => connectionPort(c) !== undefined);
        if (!signal || name === undefined || (selected.length === 1 && ready)) {
          timeoutMessage = "Timed out retrieving the computer’s SSH address.";
          const host = ready
            ? (await json(await api(`computers/${id}`, { token: bearer, signal }), detail)).computer
                .server.ipv4
            : undefined;
          const containers = selected.map((container) => withSshCommand(container, host));
          return { containers, updatedAt: snapshot.capturedAt };
        }
        timeoutMessage =
          selected.length === 0
            ? `No container named ${name} in the latest list.`
            : `No SSH address available for ${name} yet.`;
      }
      if (!signal) {
        throw new Error(
          `Container list unavailable. Retry ${listCommand} after ${data.retryAfterMs} ms.`,
        );
      }
      await sleep(Math.min(Math.max(data.retryAfterMs, 1000), wait * 1000), undefined, { signal });
      bearer = await accessToken();
    }
  } catch (error) {
    if (signal?.aborted) {
      throw new Error(`${timeoutMessage} Check with ${listCommand}`, { cause: error });
    }
    throw error;
  }
}

async function listContainers(
  name: string | undefined,
  options: { computer?: string; wait?: number },
  cmd: Command,
): Promise<void> {
  if (options.wait !== undefined && name === undefined) {
    cmd.error("Specify the container to wait for: roy containers list <name> --wait <seconds>.");
  }
  const { id, token } = await computerTarget(options.computer);
  const data = await fetchContainers(id, token, name, options.wait ?? 0);
  output(
    cmd,
    data,
    `Last updated ${timeAgo(data.updatedAt)}\n` +
      containerTable(data.containers, name ? `No container named ${name}.` : "No containers."),
  );
}

export function registerContainers(program: Command): void {
  const group = program
    .command("containers")
    .description("Manage containers on an assigned computer");
  function command(verb: string, description: string) {
    return group
      .command(verb)
      .description(description)
      .option("--computer <id>", computerHelp, computerId);
  }
  example(
    command("list", "List containers and their SSH commands")
      .argument("[name]", "show only this container", containerName)
      .option("--wait <seconds>", "wait for the named container’s SSH address", waitSeconds)
      .action(listContainers),
    "containers list website --wait 120",
  );
  const operations = {
    create: "Create a container",
    start: "Start a stopped container",
    stop: "Stop a running container",
    delete: "Delete a container and its data",
  };
  for (const [operation, description] of Object.entries(operations)) {
    const cmd = command(operation, description).argument("<name>", "container name", containerName);
    example(cmd, `containers ${operation} website`).action(
      async (name: string, options: { computer?: string }) => {
        const { id: computer, token } = await computerTarget(options.computer);
        const base = `computers/${computer}/containers`;
        const path =
          operation === "create"
            ? base
            : `${base}/${name}${operation === "delete" ? "" : `/${operation}`}`;
        const next = `roy containers list --computer ${computer}`;
        await mutate(
          path,
          operation === "delete" ? "DELETE" : "POST",
          202,
          operation === "create" ? { name, timezone: localTimezone() } : undefined,
          `Inspect with: ${next}`,
          token,
        );
        output(
          cmd,
          { status: "accepted", operation, computer, name },
          `Request accepted to ${operation} container ${name}. Check progress with: ${next}`,
        );
      },
    );
  }
}
