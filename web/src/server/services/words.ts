/** The shared vocabulary collection and each word's study page. */
import type { z } from "zod";
import type { Prisma, User } from "@/generated/prisma/client";
import { partnerOf } from "../auth";
import type {
  CreateWordBody,
  EncounterInput,
  ListWordsQuery,
  MorphemeInput,
  UpdateWordBody,
} from "../contract";
import { db } from "../db";
import { conflict, notFound } from "../errors";
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
  userWords: { include: progressInclude },
} satisfies Prisma.WordInclude;

type WordForSummary = Prisma.WordGetPayload<{ include: typeof summaryInclude }>;

function serializeSummary(word: WordForSummary, userId: string) {
  const mine = word.userWords.find((uw) => uw.userId === userId);
  const partners = word.userWords.find((uw) => uw.userId !== userId);
  return {
    id: word.id,
    lemma: word.lemma,
    partOfSpeech: word.partOfSpeech,
    definition: word.definition,
    difficulty: word.difficulty,
    addedBy: publicUser(word.addedBy),
    createdAt: word.createdAt.toISOString(),
    myProgress: mine ? serializeProgress(mine) : null,
    partnerStage: partners?.stage ?? null,
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
  return wordDetail(user, wordId);
}

/** Add a word to the user's own study list. Idempotent. */
export async function studyWord(user: User, wordId: string) {
  if (!(await db.word.findUnique({ where: { id: wordId } }))) throw notFound("Word");
  await db.userWord.upsert({
    where: { userId_wordId: { userId: user.id, wordId } },
    update: {},
    create: { userId: user.id, wordId },
  });
  return wordDetail(user, wordId);
}

/** Put a word on the partner's study list, credited to the user. */
export async function introduceWord(user: User, wordId: string) {
  if (!(await db.word.findUnique({ where: { id: wordId } }))) throw notFound("Word");
  const partner = await partnerOf(user.id);
  if (!partner) throw conflict("Your partner has not joined yet");
  const existing = await db.userWord.findUnique({
    where: { userId_wordId: { userId: partner.id, wordId } },
  });
  if (existing) throw conflict(`${partner.displayName} already has this word`);
  await db.userWord.create({
    data: { userId: partner.id, wordId, introducedById: user.id },
  });
  return wordDetail(user, wordId);
}

export { progressInclude };
