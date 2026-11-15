import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import type { User } from "@/generated/prisma/client";
import { userFromRequest } from "./auth";
import type { Endpoint } from "./contract";
import { ApiError, badRequest } from "./errors";

type Out<S> = S extends z.ZodType ? z.output<S> : undefined;
type In<S> = S extends z.ZodType ? z.input<S> : void;

type Context<E extends Endpoint> = {
  request: Request;
  user: E["auth"] extends true ? User : null;
  params: Record<string, string>;
  query: Out<E["query"]>;
  body: Out<E["body"]>;
  /** Queue a Set-Cookie header on the response. */
  setCookie: (cookie: string) => void;
};

function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  console.error(error);
  return Response.json(
    { error: { code: "internal", message: "Something went wrong" } },
    { status: 500 },
  );
}

function parse<S extends z.ZodType>(schema: S, value: unknown, where: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(`Invalid ${where}`, z.flattenError(result.error));
  }
  return result.data;
}

/**
 * Build a Next.js route handler from an endpoint declaration: authenticates,
 * validates the query and body, and shapes the response to the contract.
 */
export function handle<E extends Endpoint>(
  endpoint: E,
  fn: (ctx: Context<E>) => Promise<In<E["response"]>>,
) {
  return async (
    request: Request,
    route: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    // Reading the request marks the route as dynamic, so Next.js never prerenders
    // an API response at build time (even for endpoints that need no token).
    void request.headers;
    try {
      const user = endpoint.auth ? await userFromRequest(request) : null;
      const query = endpoint.query
        ? parse(
            endpoint.query,
            Object.fromEntries(new URL(request.url).searchParams),
            "query",
          )
        : undefined;
      let body: unknown;
      if (endpoint.body) {
        const json = await request.json().catch(() => {
          throw badRequest("Request body must be JSON");
        });
        body = parse(endpoint.body, json, "request body");
      }
      const headers = new Headers();
      const data = await fn({
        request,
        user,
        params: await route.params,
        query,
        body,
        setCookie: (cookie) => headers.append("set-cookie", cookie),
      } as Context<E>);
      if (!endpoint.response) return new Response(null, { status: 204, headers });
      // Parsing strips anything not in the contract, so responses never leak extra fields.
      return Response.json(endpoint.response.parse(data), { headers });
    } catch (error) {
      // Let Next.js handle its own control-flow errors rather than answering 500.
      unstable_rethrow(error);
      return errorResponse(error);
    }
  };
}
