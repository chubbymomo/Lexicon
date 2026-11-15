/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies are checked by assertions */
import { db } from "@/server/db";

type Handler = (
  request: Request,
  route: { params: Promise<Record<string, string>> },
) => Promise<Response>;

/** Call a route handler the way Next.js would and decode the JSON reply. */
export async function call<T = any>(
  handler: Handler,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    params?: Record<string, string>;
    query?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; data: T; headers: Headers }> {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const request = new Request(`http://test/api${options.query ?? ""}`, {
    method,
    headers: {
      ...options.headers,
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) });
  const text = await response.text();
  return {
    status: response.status,
    data: (text ? JSON.parse(text) : null) as T,
    headers: response.headers,
  };
}

export async function resetDatabase() {
  await db.$executeRawUnsafe(
    `TRUNCATE "User", "Word", "Morpheme" RESTART IDENTITY CASCADE`,
  );
}
