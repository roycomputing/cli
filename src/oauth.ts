import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { apiOrigin, checkResponse, json, request, secureUrl } from "./http.js";
import { computerIdSchema, identity } from "./schemas.js";

const endpoint = z.url().transform((url) => secureUrl(url).href);
const discovery = z.object({
  issuer: z.url(),
  device_authorization_endpoint: endpoint,
  token_endpoint: endpoint,
  revocation_endpoint: endpoint.optional(),
});
const device = z.object({
  device_code: z.string().min(1),
  user_code: z.string().regex(/^[A-Za-z0-9-]+$/u),
  verification_uri: endpoint,
  verification_uri_complete: endpoint.optional(),
  expires_in: z.int().positive(),
  interval: z.int().positive().default(5),
});
const tokens = z.object({
  access_token: z.string().min(1),
  expires_in: z.int().positive(),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string().regex(/^Bearer$/iu),
});
export const credential = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  tokenEndpoint: endpoint,
  revocationEndpoint: endpoint.optional(),
  clientId: z.string(),
  profile: identity.optional(),
  profileAttemptAt: z.number().optional(),
  soleComputer: z.object({ id: computerIdSchema, checkedAt: z.number() }).optional(),
});
export type Credential = z.infer<typeof credential>;

function post(url: string, parameters: Record<string, string>, signal?: AbortSignal) {
  return request(url, { method: "POST", body: new URLSearchParams(parameters), signal });
}

async function oauthError(response: Response): Promise<string> {
  const value: unknown = await response.json().catch(() => null);
  return (
    z.object({ error: z.string().regex(/^[a-z_]+$/u) }).safeParse(value).data?.error ??
    "request_failed"
  );
}

export async function deviceLogin(): Promise<Credential> {
  const config = await request(`${apiOrigin()}/v1/cli/auth/config`);
  await checkResponse(config);
  const { clientId, issuer } = await json(
    config,
    z.object({ clientId: z.string().min(1), issuer: z.url() }),
  );
  const metadata = await request(
    `${secureUrl(issuer).origin}/.well-known/oauth-authorization-server`,
  );
  await checkResponse(metadata);
  const provider = await json(metadata, discovery);
  if (provider.issuer !== issuer) {
    throw new Error("The login provider returned an unexpected issuer.");
  }
  const start = await post(provider.device_authorization_endpoint, {
    client_id: clientId,
    scope: "user:org:read offline_access profile email",
  });
  await checkResponse(start);
  const code = await json(start, device);
  process.stderr.write(
    `Open ${code.verification_uri_complete ?? code.verification_uri}\nConfirm code ${code.user_code} at ${code.verification_uri} and select your organization.\n`,
  );
  const deadline = Date.now() + code.expires_in * 1000;
  let delay = code.interval * 1000;
  while (Date.now() + delay < deadline) {
    await sleep(delay);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    const result = await post(
      provider.token_endpoint,
      {
        client_id: clientId,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: code.device_code,
      },
      AbortSignal.timeout(Math.min(remaining, 30_000)),
    );
    if (result.ok) {
      const token = await json(result, tokens);
      if (!token.refresh_token) {
        throw new Error(
          "Login provider omitted the refresh token. Check the offline_access scope.",
        );
      }
      return {
        clientId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + token.expires_in * 1000,
        tokenEndpoint: provider.token_endpoint,
        revocationEndpoint: provider.revocation_endpoint,
      };
    }
    const reason = await oauthError(result);
    if (reason === "slow_down") {
      delay += 5000;
    } else if (reason !== "authorization_pending") {
      throw new Error(`Login ended (${reason}). Run roy auth login to try again.`);
    }
  }
  throw new Error("Login code expired. Run roy auth login to get a new code.");
}

export async function refreshCredential(current: Credential): Promise<Credential> {
  const result = await post(current.tokenEndpoint, {
    client_id: current.clientId,
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
  });
  if (!result.ok) {
    throw new Error(`Could not refresh login (${await oauthError(result)}). Run roy auth login.`);
  }
  const token = await json(result, tokens);
  return {
    ...current,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? current.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}

export async function revoke(current: Credential): Promise<void> {
  if (current.revocationEndpoint) {
    const result = await post(current.revocationEndpoint, {
      client_id: current.clientId,
      token: current.refreshToken,
      token_type_hint: "refresh_token",
    });
    await checkResponse(result);
  }
}
