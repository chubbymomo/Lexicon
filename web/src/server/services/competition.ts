/**
 * Challenges, achievements and progress statistics.
 *
 * Challenges and achievements are defined here in code and measured from what
 * players have actually done; only their completion is stored.
 */
import type { User } from "@/generated/prisma/client";
import { db } from "../db";
import { notFound } from "../errors";
import {
  activeDays,
  addDays,
  dayKey,
  startOfDay,
  startOfWeek,
  streakLength,
  timeZone,
} from "./progress";

// --- Challenges -------------------------------------------------------------

type Window = { from: Date; to: Date };

type ChallengeDef = {
  id: string;
  period: "DAILY" | "WEEKLY";
  scope: "PERSONAL" | "SHARED";
  title: string;
  description: (target: number) => string;
  target: (playerCount: number) => number;
  xp: number;
  /** Progress in the window; `userId` is null for shared challenges. */
  measure: (userId: string | null, window: Window, tz: string) => Promise<number>;
};

const within = (w: Window) => ({ gte: w.from, lt: w.to });

const challengeDefs: ChallengeDef[] = [
  {
    id: "daily-sentences",
    period: "DAILY",
    scope: "PERSONAL",
    title: "Three good sentences",
    description: (n) => `Have ${n} sentences accepted by the tutor today.`,
    target: () => 3,
    xp: 10,
    measure: (userId, w) =>
      db.sentence.count({
        where: { verdict: "ACCEPTED", createdAt: within(w), userWord: { userId: userId! } },
      }),
  },
  {
    id: "daily-recall",
    period: "DAILY",
    scope: "PERSONAL",
    title: "Five recollections",
    description: (n) => `Recall ${n} due words correctly today.`,
    target: () => 5,
    xp: 10,
    measure: (userId, w) =>
      db.reviewLog.count({
        where: { userId: userId!, rating: { gte: 3 }, reviewedAt: within(w) },
      }),
  },
  {
    id: "weekly-words",
    period: "WEEKLY",
    scope: "PERSONAL",
    title: "Three new words",
    description: (n) => `Finish studying ${n} words this week.`,
    target: () => 3,
    xp: 30,
    measure: (userId, w) =>
      db.userWord.count({ where: { userId: userId!, studiedAt: within(w) } }),
  },
  {
    id: "weekly-days",
    period: "WEEKLY",
    scope: "PERSONAL",
    title: "A steady week",
    description: (n) => `Study on ${n} different days this week.`,
    target: () => 5,
    xp: 30,
    measure: async (userId, w, tz) => (await activeDays(userId!, tz, w.from)).length,
  },
  {
    id: "weekly-together",
    period: "WEEKLY",
    scope: "SHARED",
    title: "Together",
    description: (n) => `Between all of you, finish studying ${n} words this week.`,
    target: (players) => 3 * players,
    xp: 20,
    measure: (_userId, w) => db.userWord.count({ where: { studiedAt: within(w) } }),
  },
];

function windows(now: Date, tz: string) {
  const today = dayKey(now, tz);
  const weekStart = startOfWeek(now, tz);
  const weekKey = dayKey(weekStart, tz);
  return {
    DAILY: {
      key: today,
      from: startOfDay(today, tz),
      to: startOfDay(addDays(today, 1), tz),
    },
    WEEKLY: {
      key: weekKey,
      from: weekStart,
      to: startOfDay(addDays(weekKey, 7), tz),
    },
  };
}

async function measureChallenges(userId: string, playerCount: number, now: Date) {
  const tz = timeZone();
  const w = windows(now, tz);
  // A shared challenge needs someone to share it with.
  const defs = challengeDefs.filter((d) => d.scope === "PERSONAL" || playerCount > 1);
  return Promise.all(
    defs.map(async (def) => {
      const window = w[def.period];
      const target = def.target(playerCount);
      const raw = await def.measure(def.scope === "SHARED" ? null : userId, window, tz);
      return {
        id: def.id,
        period: def.period,
        scope: def.scope,
        title: def.title,
        description: def.description(target),
        target,
        progress: Math.min(raw, target),
        completed: raw >= target,
        xp: def.xp,
        endsAt: window.to.toISOString(),
        awardKey: `challenge:${def.id}:${window.key}`,
      };
    }),
  );
}

export async function challenges(user: User, now = new Date()) {
  return { challenges: await measureChallenges(user.id, await db.user.count(), now) };
}

// --- Achievements -----------------------------------------------------------

type Tally = {
  studied: number;
  mastered: number;
  recalled: number;
  streak: number;
  added: number;
  introduced: number;
  encounters: number;
  curriculum: number;
};

const achievementDefs: {
  code: string;
  title: string;
  description: string;
  target: number;
  of: keyof Tally;
}[] = [
  { code: "studied-1", title: "First entry", description: "Finish studying your first word.", target: 1, of: "studied" },
  { code: "studied-10", title: "Apprentice", description: "Finish studying 10 words.", target: 10, of: "studied" },
  { code: "studied-50", title: "Scholar", description: "Finish studying 50 words.", target: 50, of: "studied" },
  { code: "studied-100", title: "Lexicographer", description: "Finish studying 100 words.", target: 100, of: "studied" },
  { code: "mastered-1", title: "Committed to memory", description: "Master your first word.", target: 1, of: "mastered" },
  { code: "mastered-10", title: "A shelf of ten", description: "Master 10 words.", target: 10, of: "mastered" },
  { code: "mastered-50", title: "A working vocabulary", description: "Master 50 words.", target: 50, of: "mastered" },
  { code: "streak-7", title: "A week of study", description: "Study seven days running.", target: 7, of: "streak" },
  { code: "streak-30", title: "A month of study", description: "Study thirty days running.", target: 30, of: "streak" },
  { code: "streak-100", title: "A hundred days", description: "Study a hundred days running.", target: 100, of: "streak" },
  { code: "recalled-100", title: "A hundred recollections", description: "Recall 100 reviews correctly.", target: 100, of: "recalled" },
  { code: "recalled-500", title: "Five hundred recollections", description: "Recall 500 reviews correctly.", target: 500, of: "recalled" },
  { code: "curriculum-25", title: "Twenty-five down", description: "Finish studying 25 words from the curricula.", target: 25, of: "curriculum" },
  { code: "added-10", title: "Word collector", description: "Add 10 words of your own to the collection.", target: 10, of: "added" },
  { code: "introduced-1", title: "A word between friends", description: "Introduce a word to another player.", target: 1, of: "introduced" },
  { code: "encounters-5", title: "Marginalia", description: "Record 5 words met in your reading.", target: 5, of: "encounters" },
];

async function tally(userId: string, now: Date): Promise<Tally> {
  const tz = timeZone();
  const [studied, mastered, recalled, days, added, introduced, encounters, curriculum] =
    await Promise.all([
      db.userWord.count({ where: { userId, studiedAt: { not: null } } }),
      db.userWord.count({ where: { userId, masteredAt: { not: null } } }),
      db.reviewLog.count({ where: { userId, rating: { gte: 3 } } }),
      activeDays(userId, tz),
      db.word.count({ where: { addedById: userId } }),
      db.userWord.count({ where: { introducedById: userId } }),
      db.encounter.count({ where: { userId } }),
      db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "UserWord" uw JOIN "Word" w ON w.id = uw."wordId"
        WHERE uw."userId" = ${userId} AND uw."studiedAt" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "TrackItem" ti WHERE ti.lemma = w.lemma)`.then((r) =>
        Number(r[0].n),
      ),
    ]);
  return {
    studied,
    mastered,
    recalled,
    streak: streakLength(days, dayKey(now, tz)),
    added,
    introduced,
    encounters,
    curriculum,
  };
}

export async function achievements(userId: string, now = new Date()) {
  if (!(await db.user.findUnique({ where: { id: userId } }))) throw notFound("Player");
  const [counts, unlocked] = await Promise.all([
    tally(userId, now),
    db.achievement.findMany({ where: { userId } }),
  ]);
  const unlockedAt = new Map(unlocked.map((a) => [a.code, a.unlockedAt]));
  return {
    achievements: achievementDefs.map((def) => ({
      code: def.code,
      title: def.title,
      description: def.description,
      target: def.target,
      // Once unlocked an achievement stays complete, even if a streak later breaks.
      progress: unlockedAt.has(def.code) ? def.target : Math.min(counts[def.of], def.target),
      unlockedAt: unlockedAt.get(def.code)?.toISOString() ?? null,
    })),
  };
}

// --- Settling ---------------------------------------------------------------

/**
 * Record anything newly earned: challenge XP for every player (a shared
 * challenge can complete for all at once) and achievements for the player who
 * just acted. Safe to call repeatedly; each award is granted once.
 */
export async function settle(actorId: string, now = new Date()): Promise<void> {
  const users = await db.user.findMany({ select: { id: true } });
  for (const { id } of users) {
    const done = (await measureChallenges(id, users.length, now)).filter((c) => c.completed);
    if (done.length) {
      await db.xpEvent.createMany({
        data: done.map((c) => ({
          userId: id,
          reason: "CHALLENGE_COMPLETED" as const,
          amount: c.xp,
          key: c.awardKey,
          createdAt: now,
        })),
        skipDuplicates: true,
      });
    }
  }
  const counts = await tally(actorId, now);
  const reached = achievementDefs.filter((def) => counts[def.of] >= def.target);
  if (reached.length) {
    await db.achievement.createMany({
      data: reached.map((def) => ({ userId: actorId, code: def.code, unlockedAt: now })),
      skipDuplicates: true,
    });
  }
}

// --- Statistics -------------------------------------------------------------

export async function stats(userId: string, now = new Date()) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("Player");
  const tz = timeZone();
  const today = dayKey(now, tz);
  const dayKeys = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
  const since = startOfDay(dayKeys[0], tz);

  const [userWords, reviews, xpEvents] = await Promise.all([
    db.userWord.findMany({
      where: { userId },
      select: { stage: true, due: true, studiedAt: true, masteredAt: true },
    }),
    db.reviewLog.findMany({
      where: { userId, reviewedAt: { gte: since } },
      select: { rating: true, reviewedAt: true },
    }),
    db.xpEvent.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { amount: true, createdAt: true },
    }),
  ]);

  const days = new Map(dayKeys.map((day) => [day, { day, reviews: 0, recalled: 0, xp: 0 }]));
  for (const r of reviews) {
    const bucket = days.get(dayKey(r.reviewedAt, tz));
    if (!bucket) continue;
    bucket.reviews++;
    if (r.rating > 1) bucket.recalled++;
  }
  for (const e of xpEvents) {
    const bucket = days.get(dayKey(e.createdAt, tz));
    if (bucket) bucket.xp += e.amount;
  }
  const recalled = reviews.filter((r) => r.rating > 1).length;

  const thisWeek = dayKey(startOfWeek(now, tz), tz);
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const weekStart = addDays(thisWeek, (i - 11) * 7);
    const end = startOfDay(addDays(weekStart, 7), tz);
    const by = (at: Date | null) => at !== null && at < end;
    return {
      weekStart,
      studied: userWords.filter((w) => by(w.studiedAt)).length,
      mastered: userWords.filter((w) => by(w.masteredAt)).length,
    };
  });

  const forecastKeys = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const forecast = new Map(forecastKeys.map((day) => [day, 0]));
  for (const w of userWords) {
    if (w.stage === "STUDYING" || !w.due) continue;
    // Anything overdue is waiting today.
    const key = w.due <= now ? today : dayKey(w.due, tz);
    if (forecast.has(key)) forecast.set(key, forecast.get(key)! + 1);
  }

  const count = (stage: string) => userWords.filter((w) => w.stage === stage).length;
  return {
    user: { id: user.id, displayName: user.displayName },
    stages: {
      studying: count("STUDYING"),
      reviewing: count("REVIEWING"),
      mastered: count("MASTERED"),
      known: count("KNOWN"),
    },
    recallRate: reviews.length ? recalled / reviews.length : null,
    weeks,
    days: [...days.values()],
    forecast: forecastKeys.map((day) => ({ day, due: forecast.get(day)! })),
  };
}
