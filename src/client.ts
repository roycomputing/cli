import type { z } from "zod";
import { accessToken } from "./credentials.js";
import { apiOrigin, checkResponse, json, request } from "./http.js";

export async function api(
  path: string,
  options: {
    method?: string;
    body?: object;
    token?: string;
    hint?: string;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  const token = options.token ?? (await accessToken());
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (options.body) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await request(`${apiOrigin()}/v1/${path}`, {
      method: options.method,
      body: JSON.stringify(options.body),
      headers,
      signal: options.signal,
    });
  } catch (error) {
    if (!options.hint || !(error instanceof Error)) {
      throw error;
    }
    throw new Error(`${error.message} ${options.hint}`, { cause: error });
  }
  await checkResponse(response, options.hint);
  return response;
}

export async function get<T>(path: string, schema: z.ZodType<T>, token?: string): Promise<T> {
  return json(await api(path, { token }), schema);
}

export async function mutate(
  path: string,
  method: string,
  status: number,
  body?: object,
  hint?: string,
  token?: string,
): Promise<void> {
  const result = await api(path, { method, body, hint, token });
  if (result.status !== status) {
    throw new Error(
      `Unexpected HTTP ${result.status}. Inspect the target before repeating the command.`,
    );
  }
}
