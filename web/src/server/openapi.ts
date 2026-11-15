/** Builds the OpenAPI 3.1 document from the endpoint registry in `contract.ts`. */
import { z } from "zod";
import { endpoints, ErrorBody, type Endpoint } from "./contract";

type Json = Record<string, unknown>;

/**
 * Convert a schema to JSON Schema, hoisting every schema that has a `meta({ id })`
 * into `components.schemas` so clients generate one named type per model.
 */
function converter(io: "input" | "output", components: Record<string, Json>) {
  return (schema: z.ZodType): Json => {
    // Schemas with an id are emitted under `$defs`; point their refs at components instead.
    const json = JSON.stringify(z.toJSONSchema(schema, { io })).replaceAll(
      '"#/$defs/',
      '"#/components/schemas/',
    );
    const { $defs, $schema, ...rest } = JSON.parse(json) as Json & {
      $defs?: Record<string, Json>;
    };
    void $schema;
    for (const [id, def] of Object.entries($defs ?? {})) components[id] = def;
    return rest;
  };
}

export function buildOpenApi(): Json {
  const schemas: Record<string, Json> = {};
  const input = converter("input", schemas);
  const output = converter("output", schemas);
  const errorRef = output(ErrorBody);
  const errorResponse = (description: string) => ({
    description,
    content: { "application/json": { schema: errorRef } },
  });

  const paths: Record<string, Json> = {};
  for (const [operationId, e] of Object.entries(endpoints) as [string, Endpoint][]) {
    const parameters: Json[] = [];
    for (const [, name] of e.path.matchAll(/\{(\w+)\}/g)) {
      parameters.push({ name, in: "path", required: true, schema: { type: "string" } });
    }
    if (e.query) {
      const query = z.toJSONSchema(e.query, { io: "input" }) as {
        properties?: Record<string, Json>;
        required?: string[];
      };
      for (const [name, schema] of Object.entries(query.properties ?? {})) {
        const { description, ...rest } = schema;
        parameters.push({
          name,
          in: "query",
          required: query.required?.includes(name) ?? false,
          ...(description ? { description } : {}),
          schema: rest,
        });
      }
    }

    const responses: Record<string, Json> = e.response
      ? {
          "200": {
            description: "OK",
            content: { "application/json": { schema: output(e.response) } },
          },
        }
      : { "204": { description: "No content" } };
    if (e.body || e.query) responses["400"] = errorResponse("Invalid request");
    if (e.auth) responses["401"] = errorResponse("Missing or expired token");

    (paths[e.path] ??= {})[e.method.toLowerCase()] = {
      operationId,
      tags: [e.tag],
      summary: e.summary,
      ...(e.description ? { description: e.description } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(e.body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: input(e.body) } },
            },
          }
        : {}),
      responses,
      security: e.auth ? [{ bearerAuth: [] }] : [],
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Lexicon API",
      version: "1.0.0",
      description:
        "API for Lexicon, a two-person vocabulary learning app. All scheduling, scoring and AI evaluation happen on the server, so every client sees the same state.\n\nAuthenticate with the token returned by `/auth/login` or `/auth/register`. Errors use the `ErrorBody` shape with a stable `code`.",
    },
    servers: [{ url: "/api/v1" }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: Object.fromEntries(Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b))),
    },
  };
}
