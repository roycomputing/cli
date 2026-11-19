import { apiOrigin, checkResponse, json, plain, request } from "./http.js";
import { identity, type Identity } from "./schemas.js";

export async function fetchIdentity(token: string, profile = false): Promise<Identity> {
  const response = await request(`${apiOrigin()}/v1/auth/status${profile ? "?profile=true" : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await checkResponse(response);
  return json(response, identity);
}

export function matchingProfile(user: Identity, cached?: Identity): Identity {
  return cached?.userId === user.userId && cached.orgId === user.orgId ? cached : user;
}

export async function refreshProfile(
  token: string,
  cached?: Identity,
  verify = false,
): Promise<Identity> {
  try {
    return await fetchIdentity(token, true);
  } catch {
    if (cached && !verify) {
      return cached;
    }
    // A failed profile lookup can still leave us with a valid login.
    return matchingProfile(await fetchIdentity(token), cached);
  }
}

export function userLabel(user: Identity): string {
  const name = [user.firstName?.trim(), user.lastName?.trim()].filter(Boolean).join(" ");
  if (name) {
    return plain(user.email ? `${name} (${user.email})` : name);
  }
  return plain(user.email ?? user.userId);
}
