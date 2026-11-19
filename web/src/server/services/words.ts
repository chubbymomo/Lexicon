/** The shared vocabulary collection and each word's study page. */
import type { z } from "zod";
import type { Prisma, User } from "@/generated/prisma/client";
import {
  SENTENCES_PER_WORD,
  type CreateWordBody,
  type EncounterInput,
  type ListWordsQuery,
  type MorphemeInput,
  type UpdateWordBody,
} from "../contract";
import { db } from "../db";
import { conflict, notFound } from "../errors";
import { settle } from "./competition";
import { difficultyFromZipf, lookup } from "./dictionary";
import { awardXp } from "./progress";
import { draftEntry, enrichEntry, tutorAvailable } from "./tutor";

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

/** The latest attempt in each sentence slot. */
function slots(userWord: UserWordWithSentences) {
  return Array.from({ length: SENTENCES_PER_WORD }, (_, i) => i + 1).map((slot) => {
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
    sentencesRequired: SENTENCES_PER_WORD,
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

type CurriculumRef = { id: string; title: string; position: number };

/** The curricula each of these words belongs to, keyed by lemma. */
export async function curriculaFor(lemmas: string[]): Promise<Map<string, CurriculumRef[]>> {
  const items = lemmas.length
    ? await db.trackItem.findMany({
        where: { lemma: { in: lemmas } },
        include: { track: { select: { title: true, kind: true } } },
      })
    : [];
  const map = new Map<string, CurriculumRef[]>();
  // The core curriculum first, then the others by name.
  items.sort(
    (a, b) =>
      Number(a.track.kind !== "CORE") - Number(b.track.kind !== "CORE") ||
      a.track.title.localeCompare(b.track.title),
  );
  for (const item of items) {
    const list = map.get(item.lemma) ?? [];
    list.push({ id: item.trackId, title: item.track.title, position: item.position });
    map.set(item.lemma, list);
  }
  return map;
}

export function serializeSummary(
  word: WordForSummary,
  userId: string,
  curricula: Map<string, CurriculumRef[]>,
) {
  const mine = word.userWords.find((uw) => uw.userId === userId);
  return {
    id: word.id,
    lemma: word.lemma,
    partOfSpeech: word.partOfSpeech,
    definition: word.definition,
    difficulty: word.difficulty,
    addedBy: word.addedBy && publicUser(word.addedBy),
    curricula: curricula.get(word.lemma) ?? [],
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
  const curricula = await curriculaFor(words.map((w) => w.lemma));
  return { words: words.map((w) => serializeSummary(w, user.id, curricula)) };
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
    ...serializeSummary(word, user.id, await curriculaFor([word.lemma])),
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
      sourceKind: e.sourceKind as z.output<typeof EncounterInput>["sourceKind"],
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

/**
 * Fill in what a word's entry lacks (etymology, construction, pronunciation,
 * examples) with the tutor. Best effort: without the tutor, or if it fails, the
 * word keeps its dictionary entry.
 */
export async function enrichIfNeeded(wordId: string): Promise<void> {
  const word = await db.word.findUnique({
    where: { id: wordId },
    include: { morphemes: { select: { morphemeId: true } } },
  });
  if (!word || word.enrichedAt || !tutorAvailable()) return;
  try {
    const extra = await enrichEntry({
      lemma: word.lemma,
      partOfSpeech: word.partOfSpeech,
      definition: word.definition,
    });
    await db.$transaction(async (tx) => {
      await tx.word.update({
        where: { id: wordId },
        data: {
          pronunciation: word.pronunciation ?? emptyToNull(extra.pronunciation),
          etymology: word.etymology ?? emptyToNull(extra.etymology),
          relatedForms: word.relatedForms.length ? word.relatedForms : extra.relatedForms,
          examples: [...word.examples, ...extra.examples]
            .filter((e, i, all) => all.indexOf(e) === i)
            .slice(0, 5),
          difficulty: Math.min(5, Math.max(1, extra.difficulty || word.difficulty)),
          enrichedAt: new Date(),
        },
      });
      if (!word.morphemes.length) await setMorphemes(tx, wordId, extra.morphemes);
    });
  } catch (error) {
    console.error(`Could not enrich "${word.lemma}"`, error);
  }
}

/**
 * The collection's entry for a dictionary word, created from the dictionary if
 * nobody has studied it yet. Null if the dictionary does not know the word.
 */
export async function wordFromDictionary(
  lemma: string,
  addedById: string | null = null,
): Promise<{ id: string; lemma: string; created: boolean } | null> {
  const existing = await db.word.findUnique({ where: { lemma } });
  if (existing) return { id: existing.id, lemma, created: false };
  const entry = await lookup(lemma);
  if (!entry) return null;
  const again = await db.word.findUnique({ where: { lemma: entry.lemma } });
  if (again) return { id: again.id, lemma: entry.lemma, created: false };
  const word = await db.word.upsert({
    where: { lemma: entry.lemma },
    update: {},
    create: {
      lemma: entry.lemma,
      partOfSpeech: entry.partOfSpeech,
      definition: entry.definition,
      synonyms: entry.synonyms,
      antonyms: entry.antonyms,
      examples: entry.examples,
      difficulty: difficultyFromZipf(entry.zipf),
      relatedForms: [],
      addedById,
    },
  });
  return { id: word.id, lemma: entry.lemma, created: true };
}

const alreadyThere = (lemma: string) => conflict(`"${lemma}" is already in the collection`);

export async function createWord(user: User, body: z.output<typeof CreateWordBody>) {
  let lemma = body.lemma.toLowerCase().replace(/\s+/g, " ");
  if (await db.word.findUnique({ where: { lemma } })) throw alreadyThere(lemma);

  let wordId: string;
  if (body.definition) {
    const entry = { ...body, definition: body.definition };
    wordId = await db.$transaction(async (tx) => {
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
      return word.id;
    });
  } else {
    // The dictionary first; the tutor drafts an entry only for words it lacks.
    const entry = await lookup(lemma);
    if (entry) {
      lemma = entry.lemma;
      if (await db.word.findUnique({ where: { lemma } })) throw alreadyThere(lemma);
      wordId = (await wordFromDictionary(lemma, user.id))!.id;
      await enrichIfNeeded(wordId);
    } else {
      const drafted = await draftEntry(lemma);
      if (!drafted.isEnglishWord) {
        throw conflict(`"${lemma}" is not in the dictionary, and the tutor does not recognise it`);
      }
      // The tutor may normalise the headword ("ran" to "run"); re-check for duplicates.
      lemma = drafted.lemma.trim().toLowerCase() || lemma;
      if (await db.word.findUnique({ where: { lemma } })) throw alreadyThere(lemma);
      wordId = await db.$transaction(async (tx) => {
        const word = await tx.word.create({
          data: {
            lemma,
            definition: drafted.definition,
            pronunciation: emptyToNull(drafted.pronunciation),
            partOfSpeech: emptyToNull(drafted.partOfSpeech),
            etymology: emptyToNull(drafted.etymology),
            relatedForms: drafted.relatedForms,
            synonyms: drafted.synonyms,
            antonyms: drafted.antonyms,
            examples: drafted.examples,
            difficulty: Math.min(5, Math.max(1, drafted.difficulty)),
            enrichedAt: new Date(),
            addedById: user.id,
          },
        });
        await setMorphemes(tx, word.id, drafted.morphemes);
        return word.id;
      });
    }
  }

  await db.$transaction(async (tx) => {
    if (body.encounter) await createEncounter(tx, user.id, wordId, body.encounter);
    if (body.study) {
      await tx.userWord.upsert({
        where: { userId_wordId: { userId: user.id, wordId } },
        update: {},
        create: { userId: user.id, wordId },
      });
    }
    await awardXp(tx, user.id, "WORD_ADDED", wordId);
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
  await db.userWord.upsert({
    where: { userId_wordId: { userId: user.id, wordId } },
    update: {},
    create: { userId: user.id, wordId },
  });
  await enrichIfNeeded(wordId);
  return wordDetail(user, wordId);
}

/** Put a word on another player's study list, credited to the user. */
export async function introduceWord(user: User, wordId: string, targetId: string) {
  const word = await db.word.findUnique({ where: { id: wordId } });
  if (!word) throw notFound("Word");
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

export { progressInclude, summaryInclude, publicUser, createEncounter };
