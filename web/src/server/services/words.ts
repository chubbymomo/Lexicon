/** The shared vocabulary collection and each word's study page. */
import type { z } from "zod";
import type { Prisma, User } from "@/generated/prisma/client";
import type {
  CreateWordBody,
  EncounterInput,
  ListWordsQuery,
  MorphemeInput,
  UpdateWordBody,
} from "../contract";
import { db } from "../db";
import { conflict, notFound } from "../errors";
import { settle } from "./competition";
import { awardXp } from "./progress";
import { draftEntry } from "./tutor";

type Tx = Prisma.TransactionClient;

const publicUser = (u: { id: string; displayName: string }) => ({
  id: u.id,
  displayName: u.displayName,
});

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const progressInclude = {
  introducedBy: true,
  sentences: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.UserWordInclude;

type UserWordWithSentences = Prisma.UserWordGetPayload<{ include: typeof progressInclude }>;

/** The latest attempt in each of the five slots. */
function slots(userWord: UserWordWithSentences) {
  return [1, 2, 3, 4, 5].map((slot) => {
    const attempts = userWord.sentences.filter((s) => s.slot === slot);
    const latest = attempts.at(-1) ?? null;
    return {
      slot,
      attempts: attempts.length,
      latest: latest && { ...latest, createdAt: latest.createdAt.toISOString() },
    };
  });
}

export function serializeProgress(userWord: UserWordWithSentences) {
  return {
    userWordId: userWord.id,
    stage: userWord.stage,
    acceptedSentences: slots(userWord).filter((s) => s.latest?.verdict === "ACCEPTED").length,
    due: iso(userWord.due),
    reps: userWord.reps,
    lapses: userWord.lapses,
    stabilityDays: userWord.stability,
    introducedBy: userWord.introducedBy && publicUser(userWord.introducedBy),
    studiedAt: iso(userWord.studiedAt),
    masteredAt: iso(userWord.masteredAt),
  };
}

const summaryInclude = {
  addedBy: true,
  userWords: { include: { ...progressInclude, user: true } },
} satisfies Prisma.WordInclude;

type WordForSummary = Prisma.WordGetPayload<{ include: typeof summaryInclude }>;

function serializeSummary(word: WordForSummary, userId: string) {
  const mine = word.userWords.find((uw) => uw.userId === userId);
  return {
    id: word.id,
    lemma: word.lemma,
    partOfSpeech: word.partOfSpeech,
    definition: word.definition,
    difficulty: word.difficulty,
    addedBy: word.addedBy && publicUser(word.addedBy),
    curriculumPosition: word.curriculumPosition,
    createdAt: word.createdAt.toISOString(),
    myProgress: mine ? serializeProgress(mine) : null,
    others: word.userWords
      .filter((uw) => uw.userId !== userId)
      .map((uw) => ({ user: publicUser(uw.user), stage: uw.stage }))
      .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName)),
  };
}

export async function listWords(user: User, query: z.output<typeof ListWordsQuery>) {
  const mine = { userWords: { some: { userId: user.id } } };
  const where: Prisma.WordWhereInput = {
    ...(query.q ? { lemma: { startsWith: query.q.toLowerCase() } } : {}),
    ...(query.stage === "NOT_STARTED"
      ? { NOT: mine }
      : query.stage
        ? { userWords: { some: { userId: user.id, stage: query.stage } } }
        : {}),
  };
  const words = await db.word.findMany({
    where,
    include: summaryInclude,
    orderBy: { lemma: "asc" },
  });
  return { words: words.map((w) => serializeSummary(w, user.id)) };
}

export async function wordDetail(user: User, wordId: string) {
  const word = await db.word.findUnique({
    where: { id: wordId },
    include: {
      ...summaryInclude,
      encounters: { include: { user: true }, orderBy: { createdAt: "desc" } },
      morphemes: {
        orderBy: { position: "asc" },
        include: {
          morpheme: {
            include: {
              words: {
                where: { wordId: { not: wordId } },
                include: { word: { select: { id: true, lemma: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!word) throw notFound("Word");
  const mine = word.userWords.find((uw) => uw.userId === user.id);
  return {
    ...serializeSummary(word, user.id),
    pronunciation: word.pronunciation,
    etymology: word.etymology,
    relatedForms: word.relatedForms,
    synonyms: word.synonyms,
    antonyms: word.antonyms,
    examples: word.examples,
    morphemes: word.morphemes.map(({ morpheme }) => ({
      id: morpheme.id,
      kind: morpheme.kind,
      form: morpheme.form,
      meaning: morpheme.meaning,
      origin: morpheme.origin,
      relatedWords: morpheme.words
        .map((w) => w.word)
        .sort((a, b) => a.lemma.localeCompare(b.lemma)),
    })),
    encounters: word.encounters.map((e) => ({
      id: e.id,
      user: publicUser(e.user),
      sourceTitle: e.sourceTitle,
      sourceAuthor: e.sourceAuthor,
      sourceKind: e.sourceKind as "book" | "article" | "other",
      passage: e.passage,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
    sentences: mine ? slots(mine) : [],
  };
}

/** Link a word to its prefixes, roots and suffixes, creating any that are new. */
async function setMorphemes(tx: Tx, wordId: string, morphemes: z.output<typeof MorphemeInput>[]) {
  await tx.wordMorpheme.deleteMany({ where: { wordId } });
  const seen = new Set<string>();
  let position = 0;
  for (const m of morphemes) {
    const form = m.form.toLowerCase().replace(/^-+|-+$/g, "");
    if (!form || seen.has(`${m.kind}:${form}`)) continue;
    seen.add(`${m.kind}:${form}`);
    // An existing morpheme keeps its meaning so every word linked to it agrees.
    const morpheme = await tx.morpheme.upsert({
      where: { kind_form: { kind: m.kind, form } },
      update: {},
      create: { kind: m.kind, form, meaning: m.meaning, origin: m.origin || null },
    });
    await tx.wordMorpheme.create({
      data: { wordId, morphemeId: morpheme.id, position: position++ },
    });
  }
}

const emptyToNull = (s: string | undefined) => s || null;

export async function createWord(user: User, body: z.output<typeof CreateWordBody>) {
  let lemma = body.lemma.toLowerCase().replace(/\s+/g, " ");
  if (await db.word.findUnique({ where: { lemma } })) {
    throw conflict(`"${lemma}" is already in the collection`);
  }

  let entry: Omit<z.output<typeof UpdateWordBody>, "definition"> & { definition: string };
  if (body.definition) {
    entry = { ...body, definition: body.definition };
  } else {
    const drafted = await draftEntry(lemma);
    if (!drafted.isEnglishWord) {
      throw conflict(`The tutor does not recognise "${lemma}" as an English word`);
    }
    // The tutor may normalise the headword ("ran" to "run"); re-check for duplicates.
    lemma = drafted.lemma.trim().toLowerCase() || lemma;
    if (await db.word.findUnique({ where: { lemma } })) {
      throw conflict(`"${lemma}" is already in the collection`);
    }
    entry = { ...drafted, difficulty: Math.min(5, Math.max(1, drafted.difficulty)) };
  }

  const wordId = await db.$transaction(async (tx) => {
    const word = await tx.word.create({
      data: {
        lemma,
        definition: entry.definition,
        pronunciation: emptyToNull(entry.pronunciation),
        partOfSpeech: emptyToNull(entry.partOfSpeech),
        etymology: emptyToNull(entry.etymology),
        relatedForms: entry.relatedForms ?? [],
        synonyms: entry.synonyms ?? [],
        antonyms: entry.antonyms ?? [],
        examples: entry.examples ?? [],
        difficulty: entry.difficulty ?? 3,
        addedById: user.id,
      },
    });
    await setMorphemes(tx, word.id, entry.morphemes ?? []);
    if (body.encounter) await createEncounter(tx, user.id, word.id, body.encounter);
    if (body.study) await tx.userWord.create({ data: { userId: user.id, wordId: word.id } });
    await awardXp(tx, user.id, "WORD_ADDED", word.id);
    return word.id;
  });
  await settle(user.id);
  return wordDetail(user, wordId);
}

export async function updateWord(
  user: User,
  wordId: string,
  body: z.output<typeof UpdateWordBody>,
) {
  if (!(await db.word.findUnique({ where: { id: wordId } }))) throw notFound("Word");
  const { morphemes, ...fields } = body;
  await db.$transaction(async (tx) => {
    await tx.word.update({ where: { id: wordId }, data: fields });
    if (morphemes) await setMorphemes(tx, wordId, morphemes);
  });
  return wordDetail(user, wordId);
}

function createEncounter(
  tx: Tx,
  userId: string,
  wordId: string,
  input: z.output<typeof EncounterInput>,
) {
  return tx.encounter.create({
    data: {
      userId,
      wordId,
      sourceTitle: input.sourceTitle,
      sourceAuthor: emptyToNull(input.sourceAuthor),
      sourceKind: input.sourceKind,
      passage: emptyToNull(input.passage),
      note: emptyToNull(input.note),
    },
  });
}

export async function addEncounter(
  user: User,
  wordId: string,
  input: z.output<typeof EncounterInput>,
) {
  if (!(await db.word.findUnique({ where: { id: wordId } }))) throw notFound("Word");
  await createEncounter(db, user.id, wordId, input);
  await settle(user.id);
  return wordDetail(user, wordId);
}

/** Add a word to the user's own study list. Idempotent. */
export async function studyWord(user: User, wordId: string) {
  const word = await db.word.findUnique({ where: { id: wordId } });
  if (!word) throw notFound("Word");
  const mine = { userId_wordId: { userId: user.id, wordId } };
  if (word.curriculumPosition !== null && !(await db.userWord.findUnique({ where: mine }))) {
    // Curriculum words are taken in order, so only the next one can be begun.
    const state = await curriculum(user);
    if (state.next?.id !== wordId) {
      throw conflict("This word comes later in the curriculum; words are studied in order");
    }
    if (!state.canStartNext) {
      throw conflict(
        `Finish the five sentences for a word in progress before starting another (limit ${MAX_CURRICULUM_IN_PROGRESS})`,
      );
    }
  }
  await db.userWord.upsert({
    where: mine,
    update: {},
    create: { userId: user.id, wordId },
  });
  return wordDetail(user, wordId);
}

/** Put a word on another player's study list, credited to the user. */
export async function introduceWord(user: User, wordId: string, targetId: string) {
  const word = await db.word.findUnique({ where: { id: wordId } });
  if (!word) throw notFound("Word");
  if (word.curriculumPosition !== null) {
    throw conflict("Curriculum words reach everyone in order and cannot be introduced");
  }
  if (targetId === user.id) throw conflict("Use the study endpoint to add a word for yourself");
  const target = await db.user.findUnique({ where: { id: targetId } });
  if (!target) throw notFound("Player");
  const existing = await db.userWord.findUnique({
    where: { userId_wordId: { userId: target.id, wordId } },
  });
  if (existing) throw conflict(`${target.displayName} already has this word`);
  await db.userWord.create({
    data: { userId: target.id, wordId, introducedById: user.id },
  });
  await settle(user.id);
  return wordDetail(user, wordId);
}

export async function listUsers() {
  const users = await db.user.findMany({ orderBy: { displayName: "asc" } });
  return { users: users.map(publicUser) };
}

// --- The shared curriculum --------------------------------------------------

/** How many curriculum words a player may have unfinished before starting another. */
export const MAX_CURRICULUM_IN_PROGRESS = 3;

export async function curriculum(user: User) {
  const [total, mine, users, studiedByUser] = await Promise.all([
    db.word.count({ where: { curriculumPosition: { not: null } } }),
    db.word.findMany({
      where: {
        curriculumPosition: { not: null },
        userWords: { some: { userId: user.id } },
      },
      include: summaryInclude,
      orderBy: { curriculumPosition: "asc" },
    }),
    db.user.findMany({ orderBy: { createdAt: "asc" } }),
    db.userWord.groupBy({
      by: ["userId"],
      where: { studiedAt: { not: null }, word: { curriculumPosition: { not: null } } },
      _count: true,
    }),
  ]);
  // Everyone takes the words in the same order: the next one is the first not yet started.
  const next = await db.word.findFirst({
    where: { curriculumPosition: { not: null }, NOT: { userWords: { some: { userId: user.id } } } },
    include: summaryInclude,
    orderBy: { curriculumPosition: "asc" },
  });
  const summaries = mine.map((w) => serializeSummary(w, user.id));
  const inProgress = summaries.filter((w) => w.myProgress?.stage === "STUDYING");
  const studied = new Map(studiedByUser.map((row) => [row.userId, row._count]));
  return {
    total,
    started: summaries.length,
    studied: summaries.length - inProgress.length,
    inProgress,
    next: next && serializeSummary(next, user.id),
    canStartNext: next !== null && inProgress.length < MAX_CURRICULUM_IN_PROGRESS,
    maxInProgress: MAX_CURRICULUM_IN_PROGRESS,
    players: users
      .map((u) => ({ user: publicUser(u), isMe: u.id === user.id, studied: studied.get(u.id) ?? 0 }))
      .sort((a, b) => b.studied - a.studied),
  };
}

export type CurriculumEntry = {
  lemma: string;
  pronunciation: string;
  partOfSpeech: string;
  definition: string;
  etymology: string;
  /** [kind, form, meaning, origin] */
  morphemes: [z.output<typeof MorphemeInput>["kind"], string, string, string][];
  relatedForms: string[];
  synonyms: string[];
  antonyms: string[];
  examples: string[];
  difficulty: number;
};

/**
 * Load the curriculum: the list's order becomes every player's order. Safe to
 * re-run; existing words are updated in place and keep players' progress. A
 * word a player had already added is adopted into the curriculum.
 */
export async function seedCurriculum(entries: CurriculumEntry[]): Promise<number> {
  await db.$transaction(
    async (tx) => {
      // Clear positions first so a reordered list cannot collide with itself.
      await tx.word.updateMany({
        where: { curriculumPosition: { not: null } },
        data: { curriculumPosition: null },
      });
      for (const [index, entry] of entries.entries()) {
        const { morphemes, lemma, ...fields } = entry;
        const data = { ...fields, curriculumPosition: index + 1 };
        const word = await tx.word.upsert({
          where: { lemma },
          update: data,
          create: { lemma, ...data },
        });
        await setMorphemes(
          tx,
          word.id,
          morphemes.map(([kind, form, meaning, origin]) => ({ kind, form, meaning, origin })),
        );
      }
    },
    { timeout: 120_000 },
  );
  return entries.length;
}

export async function startNextCurriculumWord(user: User) {
  const state = await curriculum(user);
  if (!state.next) throw conflict("You have started every word in the curriculum");
  return studyWord(user, state.next.id);
}

export { progressInclude };
