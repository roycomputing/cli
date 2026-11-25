import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { json, request } from "./http.js";
import { locked, read, stableVersion, store, type UpdateCheck } from "./state.js";

export const installedVersion = pkg.version;
const dayMs = 24 * 60 * 60_000;
const retryMs = 5 * 60_000;

// Set by bun build --compile. The npm entry point uses the registry even if launched with Bun.
declare const ROY_STANDALONE: boolean;
const releaseSource =
  // oxlint-disable-next-line unicorn/no-typeof-undefined -- The npm build has no such binding.
  typeof ROY_STANDALONE !== "undefined" && ROY_STANDALONE ? "standalone" : "npm";

async function publishedVersion(): Promise<string> {
  const github = releaseSource === "standalone";
  const url = github
    ? "https://api.github.com/repos/roycomputing/cli/releases/latest"
    : "https://registry.npmjs.org/@roycomputing%2Fcli/latest";
  const response = await request(url, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) {
    throw new Error(`Could not check for a roy update (HTTP ${response.status}).`);
  }
  if (github) {
    const { tag_name: tag } = await json(
      response,
      z.object({
        tag_name: z
          .string()
          .startsWith("v")
          .transform((s) => s.slice(1))
          .pipe(stableVersion),
      }),
    );
    return tag;
  }
  return (await json(response, z.object({ version: stableVersion }))).version;
}

type CheckMode = "daily" | "cached" | "force";

function useCached(mode: CheckMode, check: UpdateCheck | undefined): boolean {
  if (mode === "force" || check?.attemptedAt === undefined) {
    return false;
  }
  return mode === "cached" || Date.now() - check.attemptedAt < (check.failed ? retryMs : dayMs);
}

export async function latestVersion(mode: "force"): Promise<string>;
export async function latestVersion(mode: "daily" | "cached"): Promise<string | undefined>;
export async function latestVersion(mode: CheckMode): Promise<string | undefined> {
  const cached = mode === "force" ? undefined : (await read())?.updateChecks?.[releaseSource];
  if (useCached(mode, cached)) {
    return cached?.latest;
  }
  let lookup: Promise<string> | undefined;
  let latest = cached?.latest;
  try {
    return await locked(async (file) => {
      const state = await read(file);
      const previous = state?.updateChecks?.[releaseSource];
      latest = previous?.latest;
      if (useCached(mode, previous)) {
        return latest;
      }
      let failed = false;
      // On first use, start the 24-hour interval without contacting the release service.
      if (mode === "force" || previous?.attemptedAt !== undefined) {
        lookup = publishedVersion();
        const published = await lookup.catch(() => null);
        failed = published === null;
        latest = published ?? latest;
      }
      await store(file, {
        ...state,
        updateChecks: {
          ...state?.updateChecks,
          [releaseSource]: { attemptedAt: Date.now(), latest, failed: failed || undefined },
        },
      });
      return mode === "force" ? lookup : latest;
    });
  } catch {
    // An explicit check reports the network result even when the cache is unwritable.
    if (mode === "force") {
      return lookup ?? publishedVersion();
    }
    return latest;
  }
}

export function updateCommand(latest: string): string | undefined {
  const [core = "", prerelease] = pkg.version.split("+")[0]?.split("-") ?? [];
  const order = latest.localeCompare(core, "en", { numeric: true });
  if (order < 0 || (order === 0 && prerelease === undefined)) {
    return undefined;
  }
  if (releaseSource === "npm") {
    return "npm install --global @roycomputing/cli@latest";
  }
  return process.platform === "win32"
    ? 'powershell -ExecutionPolicy ByPass -c "irm https://roycomputing.com/install.ps1 | iex"'
    : "curl -fsSL https://roycomputing.com/install.sh | sh";
}

export function updateNotice(latest: string, command: string): string {
  return `roy ${latest} is available (installed ${pkg.version}). Update with: ${command}`;
}
