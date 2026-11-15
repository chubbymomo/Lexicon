/** Writes the API contract to openapi/openapi.json at the repository root. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildOpenApi } from "../src/server/openapi";

const target = resolve(import.meta.dirname, "../../openapi/openapi.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
console.log(`Wrote ${target}`);
