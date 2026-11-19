/**
 * Curricula: ordered word lists that every player works through in the same
 * order. The core curriculum comes from the dictionary; players add others
 * from what they watch, read and listen to.
 *
 * A player's place in a list is derived, not stored: their next word is the
 * first one they have not begun (studying, finished or known). A word begun
 * anywhere counts everywhere, so nobody is asked to study a word twice.
 */
import type { z } from "zod";
import type { Track, User } from "@/generated/prisma/client";
import { MAX_IN_PROGRESS, type CreateCurriculumBody } from "../contract";
import { db } from "../db";
import { badRequest, conflict, forbidden, notFound, tutorUnavailable } from "../errors";
import { settle } from "./competition";
import { CORE_TRACK_ID, findCandidates, lemmaOf } from "./dictionary";
import { chooseSourceWords, suggestSourceWords, tutorAvailable } from "./tutor";
import {
  createEncounter,
  curriculaFor,
  enrichIfNeeded,
  publicUser,
  serializeSummary,
  summaryInclude,
  wordDetail,
  wordFromDictionary,
} from "./words";

type TrackWithCreator = Track & { createdBy: { id: string; displayName: string } | null };

type ItemRow = { position: number; lemma: string; context: string | null };

/** Where the player starts in a curriculum (1 unless a placement check moved it). */
async function startOf(trackId: string, userId: string): Promise<number> {
  const placement = await db.placement.findUnique({
    where: { userId_trackId: { userId, trackId } },
    select: { startPosition: true },
  });
  return placement?.startPosition ?? 1;
}

/** The player's next words in a curriculum: items they have not begun, in order. */
async function upcoming(trackId: string, userId: string, limit: number) {
  const start = await startOf(trackId, userId);
  const rows = await db.$queryRaw<ItemRow[]>`
    SELECT ti.position, ti.lemma, ti.context
    FROM "TrackItem" ti
    WHERE ti."trackId" = ${trackId}
      AND ti.position >= ${start}
      AND NOT EXISTS (
        SELECT 1 FROM "UserWord" uw JOIN "Word" w ON w.id = uw."wordId"
        WHERE uw."userId" = ${userId} AND w.lemma = ti.lemma)
    ORDER BY ti.position
    LIMIT ${limit}`;
  if (!rows.length) return [];
  const lemmas = rows.map((r) => r.lemma);
  // Prefer the collection's entry (it may have been corrected) over the dictionary's.
  const [words, entries] = await Promise.all([
    db.word.findMany({ where: { lemma: { in: lemmas } } }),
    db.dictionaryEntry.findMany({ where: { lemma: { in: lemmas } } }),
  ]);
  const word = new Map(words.map((w) => [w.lemma, w]));
  const entry = new Map(entries.map((e) => [e.lemma, e]));
  return rows.map((r) => {
    const w = word.get(r.lemma);
    const e = entry.get(r.lemma);
    return {
      lemma: r.lemma,
      position: r.position,
      partOfSpeech: w?.partOfSpeech ?? e?.partOfSpeech ?? null,
      definition: w?.definition ?? e?.definition ?? "",
      context: r.context,
      wordId: w?.id ?? null,
    };
  });
}

async function summarize(track: TrackWithCreator, user: User) {
  const [total, counts, placements, inProgressIds, next] = await Promise.all([
    db.trackItem.count({ where: { trackId: track.id } }),
    db.$queryRaw<{ userId: string; studied: bigint; known: bigint; beyond: bigint }[]>`
      SELECT uw."userId",
        count(*) FILTER (WHERE uw."studiedAt" IS NOT NULL) AS studied,
        count(*) FILTER (WHERE uw.stage = 'KNOWN') AS known,
        count(*) FILTER (WHERE ti.position >= coalesce(p."startPosition", 1)) AS beyond
      FROM "TrackItem" ti
      JOIN "Word" w ON w.lemma = ti.lemma
      JOIN "UserWord" uw ON uw."wordId" = w.id
      LEFT JOIN "Placement" p ON p."userId" = uw."userId" AND p."trackId" = ti."trackId"
      WHERE ti."trackId" = ${track.id}
      GROUP BY uw."userId"`,
    db.placement.findMany({ where: { trackId: track.id, startPosition: { not: null } } }),
    db.$queryRaw<{ id: string }[]>`
      SELECT w.id
      FROM "TrackItem" ti
      JOIN "Word" w ON w.lemma = ti.lemma
      JOIN "UserWord" uw ON uw."wordId" = w.id
      WHERE ti."trackId" = ${track.id} AND uw."userId" = ${user.id} AND uw.stage = 'STUDYING'
      ORDER BY ti.position`,
    upcoming(track.id, user.id, 1),
  ]);
  const order = inProgressIds.map((r) => r.id);
  const words = await db.word.findMany({ where: { id: { in: order } }, include: summaryInclude });
  const curricula = await curriculaFor(words.map((w) => w.lemma));
  const inProgress = words
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map((w) => serializeSummary(w, user.id, curricula));

  const byUser = new Map(counts.map((c) => [c.userId, c]));
  const startBy = new Map(placements.map((p) => [p.userId, p.startPosition!]));
  const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });
  const players = users
    .map((u) => {
      const startPosition = startBy.get(u.id) ?? 1;
      return {
        user: publicUser(u),
        isMe: u.id === user.id,
        studied: Number(byUser.get(u.id)?.studied ?? 0),
        known: Number(byUser.get(u.id)?.known ?? 0),
        startPosition,
        // Words behind the player: those before their starting point, and those begun since.
        progress: Math.min(total, startPosition - 1 + Number(byUser.get(u.id)?.beyond ?? 0)),
      };
    })
    .sort((a, b) => b.progress - a.progress);
  const mine = players.find((p) => p.isMe)!;

  return {
    id: track.id,
    kind: track.kind,
    title: track.title,
    description: track.description,
    sourceKind: track.sourceKind as z.output<typeof CreateCurriculumBody>["sourceKind"] | null,
    createdBy: track.createdBy && publicUser(track.createdBy),
    createdAt: track.createdAt.toISOString(),
    total,
    studied: mine.studied,
    known: mine.known,
    startPosition: mine.startPosition,
    placementAvailable: track.kind === "CORE",
    placementTaken: startBy.has(user.id),
    inProgress,
    next: next[0] ?? null,
    canStartNext: next.length > 0 && inProgress.length < MAX_IN_PROGRESS,
    maxInProgress: MAX_IN_PROGRESS,
    players,
  };
}

async function findTrack(id: string): Promise<TrackWithCreator> {
  const track = await db.track.findUnique({ where: { id }, include: { createdBy: true } });
  if (!track) throw notFound("Curriculum");
  return track;
}

export async function listCurricula(user: User) {
  const tracks = await db.track.findMany({
    include: { createdBy: true },
    // The core curriculum first, then the newest.
    orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
  });
  return { curricula: await Promise.all(tracks.map((t) => summarize(t, user))) };
}

export async function curriculumDetail(user: User, id: string) {
  const track = await findTrack(id);
  const [summary, next] = await Promise.all([summarize(track, user), upcoming(id, user.id, 10)]);
  return { ...summary, upcoming: next };
}

/** Begin the player's next word: add it to the collection if needed, then to their list. */
export async function startNext(user: User, id: string) {
  const track = await findTrack(id);
  const state = await summarize(track, user);
  if (!state.next) throw conflict("You have begun every word in this curriculum");
  if (!state.canStartNext) {
    throw conflict(
      `Finish the sentences for a word in progress before beginning another (at most ${MAX_IN_PROGRESS} at once)`,
    );
  }
  const word = await wordFromDictionary(state.next.lemma);
  if (!word) throw notFound(`"${state.next.lemma}" in the dictionary`);
  const begun = await db.$transaction(async (tx) => {
    const existing = await tx.userWord.findUnique({
      where: { userId_wordId: { userId: user.id, wordId: word.id } },
    });
    if (existing) return false;
    await tx.userWord.create({ data: { userId: user.id, wordId: word.id } });
    // A line from the source becomes a record of where the word was met.
    if (track.kind === "SOURCE" && state.next!.context) {
      await createEncounter(tx, user.id, word.id, {
        sourceTitle: track.title,
        sourceKind: (track.sourceKind ?? "other") as "other",
        passage: state.next!.context,
      });
    }
    return true;
  });
  if (!begun) throw conflict("You have already begun this word");
  await enrichIfNeeded(word.id);
  return wordDetail(user, word.id);
}

/** Pass over the next word because the player already knows it. */
export async function skipNext(user: User, id: string, lemma: string) {
  const track = await findTrack(id);
  const [next] = await upcoming(id, user.id, 1);
  if (!next || next.lemma !== lemma) {
    throw conflict(`"${lemma}" is not your next word in this curriculum`);
  }
  const word = await wordFromDictionary(lemma);
  if (!word) throw notFound(`"${lemma}" in the dictionary`);
  await db.userWord.upsert({
    where: { userId_wordId: { userId: user.id, wordId: word.id } },
    update: {},
    create: { userId: user.id, wordId: word.id, stage: "KNOWN" },
  });
  return curriculumDetail(user, track.id);
}

export async function deleteCurriculum(user: User, id: string) {
  const track = await findTrack(id);
  if (track.kind === "CORE") throw forbidden("The core curriculum cannot be removed");
  if (track.createdById !== user.id) throw forbidden("Only its creator can remove a curriculum");
  await db.track.delete({ where: { id } });
}

// --- Making a curriculum from a source --------------------------------------

/** How many candidate words found in a text are shown to the tutor. */
const MAX_CANDIDATES = 150;

type Pick = { lemma: string; context: string | null };

async function wordsFromText(body: z.output<typeof CreateCurriculumBody>): Promise<Pick[]> {
  const candidates = await findCandidates(body.text!);
  if (!candidates.length) {
    throw badRequest("No dictionary words worth learning were found in that text");
  }
  // The rarest words are the likeliest to be worth learning.
  const pool = [...candidates].sort((a, b) => a.zipf - b.zipf).slice(0, MAX_CANDIDATES);
  let chosen: string[];
  if (tutorAvailable()) {
    const entries = await db.dictionaryEntry.findMany({
      where: { lemma: { in: pool.map((c) => c.lemma) } },
    });
    const definition = new Map(entries.map((e) => [e.lemma, e.definition]));
    const picked = await chooseSourceWords({
      title: body.title,
      sourceKind: body.sourceKind,
      count: body.wordCount,
      candidates: pool.map((c) => ({
        lemma: c.lemma,
        definition: definition.get(c.lemma) ?? "",
        context: c.context,
      })),
    });
    const allowed = new Set(pool.map((c) => c.lemma));
    chosen = [...new Set(picked.map((w) => w.trim().toLowerCase()))].filter((w) => allowed.has(w));
  } else {
    // Without the tutor, the rarest words that appear in ordinary prose.
    chosen = pool.filter((c) => c.zipf >= 1.8).map((c) => c.lemma);
  }
  const byLemma = new Map(candidates.map((c) => [c.lemma, c]));
  // Study in the order the words come up, so the list follows the source.
  return chosen
    .slice(0, body.wordCount)
    .map((lemma) => byLemma.get(lemma)!)
    .sort((a, b) => a.firstSeen - b.firstSeen)
    .map((c) => ({ lemma: c.lemma, context: c.context }));
}

async function wordsFromTitle(body: z.output<typeof CreateCurriculumBody>): Promise<Pick[]> {
  if (!tutorAvailable()) {
    throw tutorUnavailable(
      "Without the AI tutor, a curriculum needs the source's text: paste its subtitles or transcript",
    );
  }
  const suggested = await suggestSourceWords({
    title: body.title,
    sourceKind: body.sourceKind,
    description: body.description ?? null,
    count: body.wordCount,
  });
  if (!suggested.recognised) {
    throw conflict(
      `The tutor does not know "${body.title}" well enough; paste its subtitles or transcript instead`,
    );
  }
  const picks: Pick[] = [];
  const seen = new Set<string>();
  for (const s of suggested.words) {
    // Only words the dictionary knows, in their dictionary form.
    const lemma = await lemmaOf(s.word.trim());
    if (!lemma || seen.has(lemma)) continue;
    seen.add(lemma);
    picks.push({ lemma, context: s.context.trim() || null });
  }
  return picks.slice(0, body.wordCount);
}

export async function createCurriculum(user: User, body: z.output<typeof CreateCurriculumBody>) {
  const picks = body.text?.trim() ? await wordsFromText(body) : await wordsFromTitle(body);
  if (picks.length < 3) {
    throw conflict("Too few words worth learning were found; try a longer text");
  }
  const track = await db.track.create({
    data: {
      kind: "SOURCE",
      title: body.title,
      description: body.description || null,
      sourceKind: body.sourceKind,
      createdById: user.id,
      items: {
        create: picks.map((p, i) => ({ position: i + 1, lemma: p.lemma, context: p.context })),
      },
    },
  });
  await settle(user.id);
  return curriculumDetail(user, track.id);
}

export { CORE_TRACK_ID };
