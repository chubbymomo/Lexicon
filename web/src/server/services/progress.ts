/**
 * Experience points, streaks and the leaderboard.
 *
 * XP is only awarded for evidence of understanding (an accepted sentence, a
 * correct review of a card that was actually due), never for raw activity.
 */
import type { Prisma, User, XpReason } from "@/generated/prisma/client";
import { db } from "../db";

export const XP: Record<Exclude<XpReason, "CHALLENGE_COMPLETED">, number> = {
  WORD_ADDED: 5,
  SENTENCE_ACCEPTED: 4,
  WORD_STUDIED: 20,
  REVIEW_CORRECT: 10,
  WORD_MASTERED: 50,
};

export async function awardXp(
  tx: Prisma.TransactionClient,
  userId: string,
  reason: keyof typeof XP,
  wordId: string | null,
  now = new Date(),
): Promise<number> {
  await tx.xpEvent.create({
    data: { userId, reason, amount: XP[reason], wordId, createdAt: now },
  });
  return XP[reason];
}

/** The household's time zone, used for day boundaries in streaks and weeks. */
export function timeZone(): string {
  return process.env.LEXICON_TIMEZONE || "UTC";
}

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dayKey(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export const addDays = (key: string, days: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The instant at which a calendar date begins in a time zone. */
export function startOfDay(key: string, tz: string): Date {
  const utcMidnight = Date.parse(`${key}T00:00:00Z`);
  // Two passes settle the offset even across a daylight-saving change.
  let guess = utcMidnight;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    guess -= asUtc - utcMidnight;
  }
  return new Date(guess);
}

/** Start of the current week (Monday) in a time zone. */
export function startOfWeek(now: Date, tz: string): Date {
  const today = dayKey(now, tz);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return startOfDay(addDays(today, -((weekday + 6) % 7)), tz);
}

/**
 * Consecutive days with activity ending today, or yesterday if today has none
 * yet (so a streak is not shown as broken before the day is over).
 */
export function streakLength(activeDays: Iterable<string>, today: string): number {
  const days = new Set(activeDays);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Calendar days (in `tz`) on which the user earned XP by studying. */
export async function activeDays(userId: string, tz: string, since?: Date): Promise<string[]> {
  const from = since ?? new Date(0);
  const rows = await db.$queryRaw<{ day: string }[]>`
    SELECT DISTINCT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day
    FROM "XpEvent"
    WHERE "userId" = ${userId} AND "createdAt" >= ${from} AND reason <> 'CHALLENGE_COMPLETED'`;
  return rows.map((r) => r.day);
}

async function entryFor(user: User, me: string, now: Date, weekStart: Date, tz: string) {
  const [total, week, days, studied, mastered, correct, due] = await Promise.all([
    db.xpEvent.aggregate({ where: { userId: user.id }, _sum: { amount: true } }),
    db.xpEvent.aggregate({
      where: { userId: user.id, createdAt: { gte: weekStart } },
      _sum: { amount: true },
    }),
    activeDays(user.id, tz),
    db.userWord.count({ where: { userId: user.id, studiedAt: { not: null } } }),
    db.userWord.count({ where: { userId: user.id, stage: "MASTERED" } }),
    db.reviewLog.count({ where: { userId: user.id, rating: { gte: 3 } } }),
    db.userWord.count({
      where: { userId: user.id, stage: { not: "STUDYING" }, due: { lte: now } },
    }),
  ]);
  return {
    user: { id: user.id, displayName: user.displayName },
    isMe: user.id === me,
    xpTotal: total._sum.amount ?? 0,
    xpThisWeek: week._sum.amount ?? 0,
    streakDays: streakLength(days, dayKey(now, tz)),
    wordsStudied: studied,
    wordsMastered: mastered,
    reviewsCorrect: correct,
    reviewsDue: due,
  };
}

export async function leaderboard(me: User, now = new Date()) {
  const tz = timeZone();
  const weekStart = startOfWeek(now, tz);
  const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });
  const entries = await Promise.all(users.map((u) => entryFor(u, me.id, now, weekStart, tz)));
  entries.sort((a, b) => b.xpThisWeek - a.xpThisWeek || b.xpTotal - a.xpTotal);
  return { weekStartsAt: weekStart.toISOString(), entries };
}
