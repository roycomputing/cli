import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import lockfile from "proper-lockfile";
import { catch as withFallback, z } from "zod";
import { apiOrigin } from "./http.js";
import { credential } from "./oauth.js";

export const stableVersion = z.string().regex(/^\d+\.\d+\.\d+$/u);
const check = z.object({
  attemptedAt: z.number().optional(),
  failed: z.literal(true).optional(),
  latest: stableVersion.optional(),
});
export type UpdateCheck = z.infer<typeof check>;
const updateChecks = withFallback(
  z.object({ standalone: check.optional(), npm: check.optional() }),
  {},
);

// Keep existing login files readable and allow an update cache before login or after logout.
const savedState = z.union([
  credential.extend({ updateChecks: updateChecks.optional() }),
  z.strictObject({ updateChecks }),
]);
type SavedState = z.infer<typeof savedState>;

function credentialFile(): string {
  const config = [
    process.env.XDG_CONFIG_HOME,
    process.platform === "win32" ? process.env.LOCALAPPDATA : undefined,
  ].find((path) => path !== undefined && isAbsolute(path));
  const directory = config ?? join(homedir(), ".config");
  const key = createHash("sha256").update(apiOrigin()).digest("hex");
  return join(directory, "roycomputing", `${key}.json`);
}

export async function read(file = credentialFile()): Promise<SavedState | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    return savedState.parse(value);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new Error("Could not read saved credentials. Run roy auth login.", { cause: error });
  }
}

export async function store(file: string, value: SavedState): Promise<void> {
  const temp = `${file}.${randomUUID()}`;
  try {
    await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

// Concurrent commands must share a rotated refresh token. Lock the read/refresh/write together.
export async function locked<T>(operation: (file: string) => Promise<T>): Promise<T> {
  const file = credentialFile();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const unlock = await lockfile.lock(file, {
    realpath: false,
    retries: { retries: 50, minTimeout: 100, maxTimeout: 800 },
  });
  try {
    return await operation(file);
  } finally {
    await unlock();
  }
}
