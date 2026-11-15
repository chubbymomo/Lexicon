/**
 * Spaced repetition. Pure functions around ts-fsrs so they are easy to test;
 * nothing here touches the database.
 */
import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from "ts-fsrs";
import type { CardState, ReviewKind, UserWord } from "@/generated/prisma/client";

/** A word counts as mastered once FSRS expects it to be remembered for this long. */
export const MASTERY_STABILITY_DAYS = 21;

const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  // Day-scale intervals only: Lexicon is a once-a-day habit, not a cram session.
  enable_short_term: false,
});

const toState: Record<CardState, State> = {
  NEW: State.New,
  LEARNING: State.Learning,
  REVIEW: State.Review,
  RELEARNING: State.Relearning,
};
const fromState: Record<State, CardState> = {
  [State.New]: "NEW",
  [State.Learning]: "LEARNING",
  [State.Review]: "REVIEW",
  [State.Relearning]: "RELEARNING",
};

export type CardFields = Pick<
  UserWord,
  | "due"
  | "stability"
  | "fsrsDifficulty"
  | "elapsedDays"
  | "scheduledDays"
  | "learningSteps"
  | "reps"
  | "lapses"
  | "cardState"
  | "lastReview"
>;

function toCard(fields: CardFields, now: Date): Card {
  if (!fields.due) return createEmptyCard(now);
  return {
    due: fields.due,
    stability: fields.stability,
    difficulty: fields.fsrsDifficulty,
    elapsed_days: fields.elapsedDays,
    scheduled_days: fields.scheduledDays,
    learning_steps: fields.learningSteps,
    reps: fields.reps,
    lapses: fields.lapses,
    state: toState[fields.cardState],
    last_review: fields.lastReview ?? undefined,
  };
}

function fromCard(card: Card): CardFields {
  return {
    due: card.due,
    stability: card.stability,
    fsrsDifficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    cardState: fromState[card.state],
    lastReview: card.last_review ?? null,
  };
}

/** Apply a rating (1 Again to 4 Easy) and return the rescheduled card. */
export function schedule(fields: CardFields, rating: number, now: Date): CardFields {
  if (![Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].includes(rating)) {
    throw new RangeError(`Invalid rating ${rating}`);
  }
  return fromCard(scheduler.next(toCard(fields, now), now, rating as Grade).card);
}

/**
 * The first scheduling, when the five sentences are accepted. Writing them is
 * itself a successful recall, so it counts as a first "Good" review.
 */
export function scheduleFirst(now: Date): CardFields {
  return fromCard(scheduler.next(createEmptyCard(now), now, Rating.Good).card);
}

export function isMastered(fields: Pick<CardFields, "cardState" | "stability">): boolean {
  return fields.cardState === "REVIEW" && fields.stability >= MASTERY_STABILITY_DAYS;
}

/**
 * Replace the word (and its inflections) in an example with a blank.
 * Returns null if the example does not contain it.
 */
export function blankWord(example: string, lemma: string): string | null {
  // Match the stem so "ephemeral" also blanks "ephemerally", "obviate" blanks "obviated".
  const stem = lemma.length > 4 ? lemma.replace(/(e|y)$/i, "") : lemma;
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\p{L}])${escaped}[\\p{L}]*`, "giu");
  const blanked = example.replace(pattern, "_____");
  return blanked === example ? null : blanked;
}

/**
 * Vary how a word is tested as it matures: mostly definition recall and
 * recognising it in context, with an occasional original sentence.
 */
export function pickReviewKind(
  reps: number,
  hasContextExample: boolean,
  tutorAvailable: boolean,
): ReviewKind {
  if (tutorAvailable && reps % 5 === 4) return "SENTENCE";
  if (hasContextExample && reps % 2 === 1) return "WORD_FROM_CONTEXT";
  return "DEFINITION_RECALL";
}
