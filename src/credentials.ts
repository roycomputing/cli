import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import lockfile from "proper-lockfile";
import { apiOrigin, productionOrigin } from "./http.js";
import { credential, refreshCredential, revoke, type Credential } from "./oauth.js";
import { fetchIdentity, matchingProfile, refreshProfile } from "./profile.js";
import type { Identity } from "./schemas.js";

const cacheLifetimeMs = 5 * 60_000;

function credentialFile(): string {
  const config =
    process.env.XDG_CONFIG_HOME ??
    (process.platform === "win32" ? process.env.LOCALAPPDATA : undefined);
  const directory = config && isAbsolute(config) ? config : join(homedir(), ".config");
  const key = createHash("sha256").update(apiOrigin()).digest("hex");
  return join(directory, "roycomputing", `${key}.json`);
}

async function read(file: string): Promise<Credential | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    return credential.parse(value);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new Error("Could not read saved credentials. Run roy auth login.", { cause: error });
  }
}

async function store(file: string, value: Credential): Promise<void> {
  const temp = `${file}.${randomUUID()}`;
  try {
    await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

// Concurrent commands must share a rotated refresh token. Lock the read/refresh/write together.
async function locked<T>(operation: (file: string) => Promise<T>): Promise<T> {
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

export function saveLogin(value: Credential): Promise<void> {
  return locked((file) => store(file, value));
}

export async function currentUser(
  token: string,
  mode: "display" | "verify" = "display",
): Promise<Identity> {
  if (process.env.ROYCOMPUTING_TOKEN) {
    return fetchIdentity(token);
  }
  return locked(async (file) => {
    const login = await read(file);
    // Another process may have replaced the login since this command obtained its token.
    if (login?.accessToken !== token) {
      return fetchIdentity(token);
    }
    const now = Date.now();
    if (now - (login.profileAttemptAt ?? 0) >= cacheLifetimeMs) {
      login.profileAttemptAt = now;
      await store(file, login);
      const user = await refreshProfile(token, login.profile, mode === "verify");
      if (
        login.profile &&
        (user.orgId !== login.profile.orgId || user.userId !== login.profile.userId)
      ) {
        delete login.soleComputer;
      }
      login.profile = user;
      await store(file, login);
      return login.profile;
    }
    if (login.profile && mode !== "verify") {
      return login.profile;
    }
    const user = matchingProfile(await fetchIdentity(token), login.profile);
    if (user !== login.profile) {
      delete login.soleComputer;
      login.profile = user;
      await store(file, login);
    }
    return user;
  });
}

export async function soleComputer(token: string, lookup: () => Promise<string>): Promise<string> {
  if (process.env.ROYCOMPUTING_TOKEN) {
    return lookup();
  }
  return locked(async (file) => {
    const login = await read(file);
    if (login?.accessToken !== token) {
      return lookup();
    }
    if (login.soleComputer && Date.now() - login.soleComputer.checkedAt < cacheLifetimeMs) {
      return login.soleComputer.id;
    }
    const id = await lookup();
    login.soleComputer = { id, checkedAt: Date.now() };
    await store(file, login);
    return id;
  });
}

export async function accessToken(): Promise<string> {
  const token = process.env.ROYCOMPUTING_TOKEN;
  if (token) {
    if ((process.env.ROYCOMPUTING_TOKEN_ORIGIN ?? productionOrigin) !== apiOrigin()) {
      throw new Error(
        "ROYCOMPUTING_TOKEN belongs to another API. Unset it to use the saved login, or set ROYCOMPUTING_TOKEN_ORIGIN for a token issued for this origin.",
      );
    }
    return token;
  }
  return locked(async (file) => {
    const current = await read(file);
    if (!current) {
      throw new Error(`No login for ${apiOrigin()}. Run roy auth login.`);
    }
    if (current.expiresAt > Date.now() + 30_000) {
      return current.accessToken;
    }
    const next = await refreshCredential(current);
    await store(file, next);
    return next.accessToken;
  });
}

export async function logout(): Promise<void> {
  await locked(async (file) => {
    const current = await read(file);
    try {
      if (current) {
        await revoke(current);
      }
    } finally {
      await rm(file, { force: true });
    }
  });
}
