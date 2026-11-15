/** Loads prisma/curriculum.json into the database. Run with `npm run db:seed`. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../src/server/db";
import { seedCurriculum, type CurriculumEntry } from "../src/server/services/words";

const entries = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "curriculum.json"), "utf8"),
) as CurriculumEntry[];

const lemmas = new Set(entries.map((e) => e.lemma));
if (lemmas.size !== entries.length) throw new Error("curriculum.json contains a repeated word");

const count = await seedCurriculum(entries);
console.log(`Curriculum loaded: ${count} words`);
await db.$disconnect();
