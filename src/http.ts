import { z } from "zod";

export function secureUrl(value: string): URL {
  const url = URL.parse(value);
  if (
    !url ||
    url.username ||
    url.password ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  ) {
    throw new Error("Use an HTTPS URL, or HTTP on localhost.");
  }
  return url;
}

export const productionOrigin = "https://api.roycomputing.com";
export function apiOrigin(): string {
  const url = secureUrl(process.env.ROYCOMPUTING_API_URL ?? productionOrigin);
  if (url.pathname !== "/" || url.search) {
    throw new Error("ROYCOMPUTING_API_URL must be an origin, without a path or query.");
  }
  return url.origin;
}

export async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      redirect: "error",
      signal: init?.signal ?? AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(`Could not reach ${new URL(url).origin}. Check your connection and API URL.`);
  }
}

export async function json<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const value: unknown = await response.json().catch(() => null);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Unexpected response format. Check that the CLI and API are up to date.");
  }
  return parsed.data;
}

// Prevent untrusted terminal text from introducing control sequences or extra rows.
export function plain(value: string): string {
  return value.replaceAll(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ");
}

export async function checkResponse(response: Response, hint?: string): Promise<void> {
  if (response.ok) {
    return;
  }
  const body: unknown = await response.json().catch(() => null);
  const message = z.object({ error: z.string() }).safeParse(body).data?.error;
  const expired = process.env.ROYCOMPUTING_TOKEN
    ? "Supply a fresh ROYCOMPUTING_TOKEN, or unset it and run roy auth login."
    : "Run roy auth login.";
  const next = response.status === 401 ? expired : hint;
  throw new Error(
    `HTTP ${response.status}: ${plain(message ?? "Request failed")}${next ? ` ${next}` : ""}`,
  );
}
