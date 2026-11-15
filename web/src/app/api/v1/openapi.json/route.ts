import { buildOpenApi } from "@/server/openapi";

export function GET() {
  return Response.json(buildOpenApi());
}
