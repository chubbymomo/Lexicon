/**
 * The placement check: a short multiple-choice test that finds where a player
 * should start in the core curriculum, so they need not pass over hundreds of
 * words they already know one at a time.
 *
 * The curriculum is divided into levels, from common to rare words. Each level
 * asks two or three questions (a word and four definitions, or "I don't
 * know"); two right answers pass it, and the check climbs until a level is
 * failed. The player then starts at the beginning of that level.
 *
 * Answers are kept on the server, so a client never sees which option is right.
 */
import { randomInt, randomUUID } from "node:crypto";
import { Prisma, type User } from "@/generated/prisma/client";
import { db } from "../db";
import { conflict, notFound } from "../errors";

/** Where each level begins, as a share of the curriculum: dense at the common end. */
const LEVEL_STARTS = [0, 0.02, 0.05, 0.09, 0.14, 0.21, 0.3, 0.42, 0.58, 0.78];
const PER_LEVEL = 3;
const TO_PASS = 2;
const OPTIONS = 4;

type Question = {
  id: string;
  lemma: string;
  partOfSpeech: string;
  options: string[];
  answer: number;
};

type State = {
  /** 1-based position where each level begins. */
  levels: number[];
  level: number;
  right: number;
  wrong: number;
  asked: number;
  correct: number;
  /** Words already asked, so none comes up twice. */
  seen: string[];
  current: Question;
};

export type PlacementStep = {
  question: {
    id: string;
    number: number;
    level: number;
    levels: number;
    word: string;
    partOfSpeech: string;
    options: string[];
  } | null;
  result: {
    startPosition: number;
    startWord: string | null;
    total: number;
    levelsPassed: number;
    levels: number;
    asked: number;
    correct: number;
  } | null;
};

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A definition that does not give the word away by containing it. */
function fair(lemma: string, definition: string): boolean {
  const stem = lemma.slice(0, Math.max(4, lemma.length - 3)).toLowerCase();
  return definition.length >= 8 && !definition.toLowerCase().includes(stem);
}

const tidy = (definition: string) => {
  const d = definition.length > 160 ? `${definition.slice(0, 157)}…` : definition;
  return d[0].toUpperCase() + d.slice(1);
};

async function trackSize(trackId: string) {
  return db.trackItem.count({ where: { trackId } });
}

function levelStarts(total: number): number[] {
  const starts = LEVEL_STARTS.map((f) => Math.floor(f * total) + 1);
  return [...new Set(starts)].filter((p) => p <= total);
}

/** A question drawn from one level of the curriculum. */
async function question(trackId: string, from: number, to: number, seen: string[]): Promise<Question> {
  const pool = await db.$queryRaw<{ lemma: string; partOfSpeech: string; definition: string }[]>`
    SELECT ti.lemma, d."partOfSpeech", d.definition
    FROM "TrackItem" ti JOIN "DictionaryEntry" d ON d.lemma = ti.lemma
    WHERE ti."trackId" = ${trackId} AND ti.position BETWEEN ${from} AND ${to}
    ORDER BY random() LIMIT 25`;
  const word =
    pool.find((w) => !seen.includes(w.lemma) && fair(w.lemma, w.definition)) ??
    pool.find((w) => !seen.includes(w.lemma));
  if (!word) throw conflict("This curriculum has too few words for a placement check");

  // Wrong answers: definitions of other words of the same kind, of similar rarity.
  const distractors = await db.$queryRaw<{ definition: string }[]>`
    SELECT DISTINCT d.definition
    FROM "TrackItem" ti JOIN "DictionaryEntry" d ON d.lemma = ti.lemma
    WHERE ti."trackId" = ${trackId}
      AND d."partOfSpeech" = ${word.partOfSpeech}
      AND d.lemma <> ${word.lemma}
      AND d.definition <> ${word.definition}
      AND ti.position BETWEEN ${Math.max(1, from - 2000)} AND ${to + 2000}
    ORDER BY 1 LIMIT 200`;
  const others = shuffle(distractors.map((d) => d.definition)).slice(0, OPTIONS - 1);
  if (others.length < OPTIONS - 1) {
    throw conflict("This curriculum has too few words for a placement check");
  }
  const options = shuffle([word.definition, ...others]);
  return {
    id: randomUUID(),
    lemma: word.lemma,
    partOfSpeech: word.partOfSpeech,
    options: options.map(tidy),
    answer: options.indexOf(word.definition),
  };
}

function levelRange(state: State, total: number): [number, number] {
  const from = state.levels[state.level];
  const to = (state.levels[state.level + 1] ?? total + 1) - 1;
  return [from, to];
}

function asQuestion(state: State): PlacementStep {
  return {
    question: {
      id: state.current.id,
      number: state.asked + 1,
      level: state.level + 1,
      levels: state.levels.length,
      word: state.current.lemma,
      partOfSpeech: state.current.partOfSpeech,
      options: state.current.options,
    },
    result: null,
  };
}

async function coreTrack(trackId: string) {
  const track = await db.track.findUnique({ where: { id: trackId } });
  if (!track) throw notFound("Curriculum");
  if (track.kind !== "CORE") {
    throw conflict("A placement check is only offered for the core curriculum");
  }
  return track;
}

/** Begin (or begin again) a placement check. */
export async function startPlacement(user: User, trackId: string): Promise<PlacementStep> {
  await coreTrack(trackId);
  const total = await trackSize(trackId);
  const levels = levelStarts(total);
  const partial = { levels, level: 0, right: 0, wrong: 0, asked: 0, correct: 0, seen: [] as string[] };
  const [from, to] = levelRange({ ...partial } as State, total);
  const current = await question(trackId, from, to, []);
  const state: State = { ...partial, seen: [current.lemma], current };
  await db.placement.upsert({
    where: { userId_trackId: { userId: user.id, trackId } },
    update: { state },
    create: { userId: user.id, trackId, state },
  });
  return asQuestion(state);
}

/** Record an answer (an option's index, or null for "I don't know") and move on. */
export async function answerPlacement(
  user: User,
  trackId: string,
  questionId: string,
  choice: number | null,
): Promise<PlacementStep> {
  await coreTrack(trackId);
  const placement = await db.placement.findUnique({
    where: { userId_trackId: { userId: user.id, trackId } },
  });
  const state = placement?.state as State | null | undefined;
  if (!state) throw conflict("No placement check is under way; start one first");
  if (state.current.id !== questionId) {
    throw conflict("That question has already been answered");
  }

  state.asked++;
  if (choice === state.current.answer) {
    state.right++;
    state.correct++;
  } else {
    state.wrong++;
  }

  const total = await trackSize(trackId);
  const passed = state.right >= TO_PASS;
  const failed = state.wrong > PER_LEVEL - TO_PASS;
  let finishedAt: number | null = null;
  if (failed) {
    // Start where the words stopped being familiar.
    finishedAt = state.level;
  } else if (passed) {
    if (state.level + 1 >= state.levels.length) {
      // Every level passed: start among the rarest words.
      finishedAt = state.level;
    } else {
      state.level++;
      state.right = 0;
      state.wrong = 0;
    }
  }

  if (finishedAt !== null) {
    const startPosition = state.levels[finishedAt];
    await db.placement.update({
      where: { userId_trackId: { userId: user.id, trackId } },
      data: { startPosition, state: Prisma.DbNull },
    });
    const first = await db.trackItem.findUnique({
      where: { trackId_position: { trackId, position: startPosition } },
    });
    return {
      question: null,
      result: {
        startPosition,
        startWord: first?.lemma ?? null,
        total,
        levelsPassed: failed ? finishedAt : finishedAt + 1,
        levels: state.levels.length,
        asked: state.asked,
        correct: state.correct,
      },
    };
  }

  const [from, to] = levelRange(state, total);
  state.current = await question(trackId, from, to, state.seen);
  state.seen.push(state.current.lemma);
  await db.placement.update({
    where: { userId_trackId: { userId: user.id, trackId } },
    data: { state },
  });
  return asQuestion(state);
}
