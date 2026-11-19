/**
 * The reference dictionary: loading it, looking words up, and finding the
 * dictionary form of a word as it appears in running text ("ran" -> "run",
 * "ubiquitously" stays itself, "studies" -> "study").
 */
import { createHash } from "node:crypto";
import type { DictionaryEntry } from "@/generated/prisma/client";
import { db } from "../db";

/** The shape of prisma/data/dictionary.json.gz (see scripts/build-dictionary.py). */
export type DictionaryData = {
  format: 1;
  /** [lemma, partOfSpeech, definition, synonyms, antonyms, examples, zipf] */
  entries: [string, string, string, string[], string[], string[], number][];
  /** [inflected form, lemma] */
  forms: [string, string][];
  /** The core curriculum's lemmas, in order of study. */
  core: string[];
};

export const CORE_TRACK_ID = "core";
const CORE_TITLE = "The core curriculum";
const CORE_DESCRIPTION =
  "Words worth knowing, from the WordNet dictionary, taken from more common to rarer.";

const CHUNK = 2000;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Load the dictionary and the core curriculum. Skipped when this exact data is
 * already loaded, so it is cheap to run on every start. Words already in the
 * collection, and everyone's progress, are untouched; only the order of the
 * core curriculum follows the new data.
 */
export async function loadDictionary(data: DictionaryData): Promise<"loaded" | "unchanged"> {
  const version = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  const [current, coreItems] = await Promise.all([
    db.setting.findUnique({ where: { key: "dictionaryVersion" } }),
    db.trackItem.count({ where: { trackId: CORE_TRACK_ID } }),
  ]);
  if (current?.value === version && coreItems === new Set(data.core).size) return "unchanged";

  await db.$transaction(
    async (tx) => {
      await tx.dictionaryEntry.deleteMany();
      for (const part of chunks(data.entries)) {
        await tx.dictionaryEntry.createMany({
          data: part.map(([lemma, partOfSpeech, definition, synonyms, antonyms, examples, zipf]) => ({
            lemma,
            partOfSpeech,
            definition,
            synonyms,
            antonyms,
            examples,
            zipf,
          })),
        });
      }
      await tx.wordForm.deleteMany();
      for (const part of chunks(data.forms)) {
        await tx.wordForm.createMany({ data: part.map(([form, lemma]) => ({ form, lemma })) });
      }
      await tx.track.upsert({
        where: { id: CORE_TRACK_ID },
        update: { title: CORE_TITLE, description: CORE_DESCRIPTION },
        create: {
          id: CORE_TRACK_ID,
          kind: "CORE",
          title: CORE_TITLE,
          description: CORE_DESCRIPTION,
        },
      });
      await tx.trackItem.deleteMany({ where: { trackId: CORE_TRACK_ID } });
      const core = [...new Set(data.core)];
      for (const part of chunks(core.map((lemma, i) => ({ lemma, position: i + 1 })))) {
        await tx.trackItem.createMany({
          data: part.map((item) => ({ trackId: CORE_TRACK_ID, ...item })),
        });
      }
      await tx.setting.upsert({
        where: { key: "dictionaryVersion" },
        update: { value: version },
        create: { key: "dictionaryVersion", value: version },
      });
    },
    { timeout: 300_000 },
  );
  cache = undefined;
  return "loaded";
}

// --- Finding the dictionary form of a word ----------------------------------

type Index = { zipf: Map<string, number>; forms: Map<string, string> };
let cache: Promise<Index> | undefined;

/** Every lemma's frequency and every irregular form, held in memory once loaded. */
function index(): Promise<Index> {
  cache ??= (async () => {
    const [entries, forms] = await Promise.all([
      db.dictionaryEntry.findMany({ select: { lemma: true, zipf: true } }),
      db.wordForm.findMany(),
    ]);
    return {
      zipf: new Map(entries.map((e) => [e.lemma, e.zipf])),
      forms: new Map(forms.map((f) => [f.form, f.lemma])),
    };
  })().catch((error) => {
    cache = undefined;
    throw error;
  });
  return cache;
}

/** Forget the in-memory index (after the dictionary changes). */
export function resetDictionaryCache() {
  cache = undefined;
}

// WordNet's "morphy" detachment rules for regular inflections.
const RULES: [string, string][] = [
  ["ies", "y"],
  ["ses", "s"],
  ["xes", "x"],
  ["zes", "z"],
  ["ches", "ch"],
  ["shes", "sh"],
  ["men", "man"],
  ["es", "e"],
  ["es", ""],
  ["s", ""],
  ["ied", "y"],
  ["ed", "e"],
  ["ed", ""],
  ["ing", "e"],
  ["ing", ""],
  ["est", "e"],
  ["est", ""],
  ["er", "e"],
  ["er", ""],
];

function candidates(word: string): string[] {
  const out = [word];
  for (const [suffix, ending] of RULES) {
    if (word.endsWith(suffix) && word.length > suffix.length + 2) {
      const stem = word.slice(0, -suffix.length);
      out.push(stem + ending);
      // "running" -> "run", "stopped" -> "stop"
      if (ending === "" && stem.length > 3 && stem.at(-1) === stem.at(-2)) out.push(stem.slice(0, -1));
    }
  }
  return out;
}

/** The dictionary form of a word, or null if the dictionary does not know it. */
export async function lemmaOf(word: string): Promise<string | null> {
  const { zipf, forms } = await index();
  const lower = word.toLowerCase();
  const irregular = forms.get(lower);
  if (irregular) return irregular;
  return candidates(lower).find((c) => zipf.has(c)) ?? null;
}

export async function lookup(word: string): Promise<DictionaryEntry | null> {
  const lemma = await lemmaOf(word.trim());
  return lemma ? db.dictionaryEntry.findUnique({ where: { lemma } }) : null;
}

/** How common a dictionary word is (Zipf scale), or null for an unknown word. */
export async function zipfOf(lemma: string): Promise<number | null> {
  return (await index()).zipf.get(lemma) ?? null;
}

/** A 1 (easy) to 5 (rare) difficulty from how common a word is. */
export function difficultyFromZipf(zipf: number): number {
  if (zipf >= 3.8) return 1;
  if (zipf >= 3.2) return 2;
  if (zipf >= 2.6) return 3;
  if (zipf >= 2.1) return 4;
  return 5;
}

// --- Finding vocabulary in a text -------------------------------------------

export type Candidate = {
  lemma: string;
  zipf: number;
  /** How many times the word appears. */
  count: number;
  /** Order of first appearance, from 0. */
  firstSeen: number;
  /** The sentence where it first appears. */
  context: string;
};

/** Strip subtitle numbering, timestamps and markup, leaving the spoken text. */
export function plainText(source: string): string {
  return source
    .replace(/\r/g, "")
    .split("\n")
    .filter(
      (line) =>
        !/^\s*\d+\s*$/.test(line) &&
        !line.includes("-->") &&
        !/^\s*(WEBVTT|NOTE|STYLE|Kind:|Language:)/.test(line),
    )
    .join("\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\\[^}]*\}/g, " ")
    .replace(/\[[^\]]*\]|\([^)]*\)|♪/g, " ")
    .replace(/[ \t]+/g, " ");
}

function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…])\s+(?=["'“‘A-Z0-9-])/)
    .map((s) => s.replace(/^[-–—\s]+/, "").trim())
    .filter(Boolean);
}

/**
 * Dictionary words in a text that are uncommon enough to be worth learning,
 * with the sentence each first appears in. A word capitalised in the middle of
 * a sentence and never written in lower case is taken to be a name.
 */
export async function findCandidates(
  source: string,
  { maxZipf = 4.0, minZipf = 1.2 } = {},
): Promise<Candidate[]> {
  const { zipf } = await index();
  const found = new Map<string, Candidate & { lowercase: boolean; name: boolean }>();
  let order = 0;
  for (const sentence of sentences(plainText(source))) {
    for (const match of sentence.matchAll(/[A-Za-z]+(?:'[a-z]+)?/g)) {
      const token = match[0];
      const initial = match.index === sentence.search(/[A-Za-z]/);
      if (token.includes("'") || token.length < 4) continue;
      const lemma = await lemmaOf(token);
      if (!lemma) continue;
      const frequency = zipf.get(lemma)!;
      if (frequency > maxZipf || frequency < minZipf) continue;
      const lowercase = token === token.toLowerCase();
      const name = !lowercase && !initial;
      const seen = found.get(lemma);
      if (seen) {
        seen.count++;
        seen.name ||= name;
        if (lowercase && !seen.lowercase) {
          seen.lowercase = true;
          seen.context = sentence;
        }
      } else {
        found.set(lemma, {
          lemma,
          zipf: frequency,
          count: 1,
          firstSeen: order++,
          context: sentence,
          lowercase,
          name,
        });
      }
    }
  }
  return [...found.values()]
    .filter((c) => c.lowercase || !c.name)
    .map((c) => ({
      lemma: c.lemma,
      zipf: c.zipf,
      count: c.count,
      firstSeen: c.firstSeen,
      context: c.context.length > 300 ? `${c.context.slice(0, 297)}…` : c.context,
    }));
}
