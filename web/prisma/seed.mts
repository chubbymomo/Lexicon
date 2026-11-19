/**
 * Brings the database's reference data up to date. Runs on every start (after
 * migrations) and is cheap when nothing has changed:
 *   - loads the dictionary and core curriculum from prisma/data;
 *   - finishes the study of words that already have enough accepted sentences.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { db } from "../src/server/db";
import { loadDictionary, type DictionaryData } from "../src/server/services/dictionary";
import { promoteCompletedStudies } from "../src/server/services/study";

const file = resolve(import.meta.dirname, "data/dictionary.json.gz");
const data = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as DictionaryData;

const started = Date.now();
const result = await loadDictionary(data);
console.log(
  result === "loaded"
    ? `Dictionary loaded: ${data.entries.length} words, core curriculum of ${data.core.length} (${Math.round((Date.now() - started) / 1000)}s)`
    : "Dictionary already up to date",
);
const promoted = await promoteCompletedStudies();
if (promoted) console.log(`Finished the study of ${promoted} words that had enough sentences`);
await db.$disconnect();
