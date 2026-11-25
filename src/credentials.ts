import { rm } from "node:fs/promises";
import { apiOrigin, productionOrigin } from "./http.js";
import { refreshCredential, revoke, type Credential } from "./oauth.js";
import { fetchIdentity, matchingProfile, refreshProfile } from "./profile.js";
import type { Identity } from "./schemas.js";
import { locked, read, store } from "./state.js";

const cacheLifetimeMs = 5 * 60_000;

async function readLogin(file: string) {
  const state = await read(file);
  return state && "accessToken" in state ? state : undefined;
}

export function saveLogin(value: Credential): Promise<void> {
  return locked(async (file) => {
    // A fresh login can also replace a damaged credential file.
    const previous = await read(file).catch(() => null);
    await store(file, { ...value, updateChecks: previous?.updateChecks });
  });
}

export async function currentUser(
  token: string,
  mode: "display" | "verify" = "display",
): Promise<Identity> {
  if (process.env.ROYCOMPUTING_TOKEN) {
    return fetchIdentity(token);
  }
  return locked(async (file) => {
    const login = await readLogin(file);
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
    const login = await readLogin(file);
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
    const current = await readLogin(file);
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
      if (current && "accessToken" in current) {
        await revoke(current);
      }
    } finally {
      if (current?.updateChecks) {
        // Logout must still remove the tokens if the cache cannot be rewritten.
        await store(file, { updateChecks: current.updateChecks }).catch(() =>
          rm(file, { force: true }),
        );
      } else {
        await rm(file, { force: true });
      }
    }
  });
}
