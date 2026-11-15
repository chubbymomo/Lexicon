/** The five-sentence method and spaced-repetition reviews. */
import type { z } from "zod";
import type { User } from "@/generated/prisma/client";
import type { SubmitReviewBody, SubmitSentenceBody } from "../contract";
import { db } from "../db";
import { badRequest, conflict, notFound } from "../errors";
import { awardXp } from "./progress";
import {
  blankWord,
  isMastered,
  pickReviewKind,
  schedule,
  scheduleFirst,
} from "./scheduling";
import { evaluateSentence, isAccepted, tutorAvailable } from "./tutor";
import { progressInclude, serializeProgress } from "./words";

async function progressOf(userWordId: string) {
  const userWord = await db.userWord.findUniqueOrThrow({
    where: { id: userWordId },
    include: progressInclude,
  });
  return serializeProgress(userWord);
}

export async function submitSentence(
  user: User,
  wordId: string,
  body: z.output<typeof SubmitSentenceBody>,
) {
  const userWord = await db.userWord.findUnique({
    where: { userId_wordId: { userId: user.id, wordId } },
    include: { word: true, sentences: { orderBy: { createdAt: "asc" } } },
  });
  if (!userWord) throw notFound("Word in your study list");

  const latestBySlot = new Map(userWord.sentences.map((s) => [s.slot, s]));
  if (latestBySlot.get(body.slot)?.verdict === "ACCEPTED") {
    throw conflict(`Sentence ${body.slot} has already been accepted`);
  }
  const accepted = [...latestBySlot.values()].filter((s) => s.verdict === "ACCEPTED");

  const evaluation = await evaluateSentence({
    lemma: userWord.word.lemma,
    partOfSpeech: userWord.word.partOfSpeech,
    definition: userWord.word.definition,
    sentence: body.text,
    otherSentences: accepted.map((s) => s.text),
  });
  const ok = isAccepted(evaluation);
  const now = new Date();

  return db.$transaction(async (tx) => {
    const sentence = await tx.sentence.create({
      data: {
        userWordId: userWord.id,
        slot: body.slot,
        text: body.text,
        verdict: ok ? "ACCEPTED" : "NEEDS_REVISION",
        // A sentence that leaves the word out cannot be using it correctly.
        grammarOk: evaluation.grammarOk,
        usageOk: evaluation.usageOk && evaluation.usesWord,
        contextOk: evaluation.contextOk,
        feedback: evaluation.feedback,
        suggestion: evaluation.suggestion,
        createdAt: now,
      },
    });

    let xpAwarded = 0;
    if (ok) {
      xpAwarded += await awardXp(tx, user.id, "SENTENCE_ACCEPTED", wordId, now);
      // The fifth accepted sentence completes the study and starts spaced repetition.
      if (accepted.length + 1 === 5 && userWord.stage === "STUDYING") {
        await tx.userWord.update({
          where: { id: userWord.id },
          data: { stage: "REVIEWING", studiedAt: now, ...scheduleFirst(now) },
        });
        xpAwarded += await awardXp(tx, user.id, "WORD_STUDIED", wordId, now);
      }
    }

    const updated = await tx.userWord.findUniqueOrThrow({
      where: { id: userWord.id },
      include: progressInclude,
    });
    return {
      sentence: { ...sentence, createdAt: sentence.createdAt.toISOString() },
      progress: serializeProgress(updated),
      xpAwarded,
    };
  });
}

export async function dueReviews(user: User, limit: number, now = new Date()) {
  const where = {
    userId: user.id,
    stage: { not: "STUDYING" as const },
    due: { lte: now },
  };
  const [dueCount, cards] = await Promise.all([
    db.userWord.count({ where }),
    db.userWord.findMany({
      where,
      include: { word: true },
      orderBy: { due: "asc" },
      take: limit,
    }),
  ]);
  const tutor = tutorAvailable();
  return {
    dueCount,
    cards: cards.map((card) => {
      const { word } = card;
      // Rotate through the examples so the same context is not shown every time.
      const contexts = word.examples
        .map((example) => ({ example, blanked: blankWord(example, word.lemma) }))
        .filter((c): c is { example: string; blanked: string } => c.blanked !== null);
      const context = contexts.length ? contexts[card.reps % contexts.length] : null;
      const kind = pickReviewKind(card.reps, context !== null, tutor);
      const prompt =
        kind === "SENTENCE"
          ? `Write an original sentence using "${word.lemma}".`
          : kind === "WORD_FROM_CONTEXT"
            ? context!.blanked
            : word.lemma;
      return {
        userWordId: card.id,
        wordId: word.id,
        kind,
        prompt,
        due: card.due!.toISOString(),
        answer: {
          lemma: word.lemma,
          pronunciation: word.pronunciation,
          partOfSpeech: word.partOfSpeech,
          definition: word.definition,
          example: context?.example ?? word.examples[0] ?? null,
        },
      };
    }),
  };
}

export async function submitReview(
  user: User,
  body: z.output<typeof SubmitReviewBody>,
  now = new Date(),
) {
  const userWord = await db.userWord.findUnique({
    where: { id: body.userWordId },
    include: { word: true },
  });
  if (!userWord || userWord.userId !== user.id) throw notFound("Review card");
  if (userWord.stage === "STUDYING" || !userWord.due) {
    throw conflict("Finish the five sentences before reviewing this word");
  }
  if (userWord.due > now) throw conflict("This word is not due for review yet");

  let rating: number;
  let evaluation = null;
  if (body.kind === "SENTENCE") {
    if (!body.sentence) throw badRequest("`sentence` is required for a SENTENCE review");
    const result = await evaluateSentence({
      lemma: userWord.word.lemma,
      partOfSpeech: userWord.word.partOfSpeech,
      definition: userWord.word.definition,
      sentence: body.sentence,
      otherSentences: [],
    });
    const ok = isAccepted(result);
    rating = ok ? 3 : 1;
    evaluation = {
      text: body.sentence,
      verdict: ok ? ("ACCEPTED" as const) : ("NEEDS_REVISION" as const),
      grammarOk: result.grammarOk,
      usageOk: result.usageOk && result.usesWord,
      contextOk: result.contextOk,
      feedback: result.feedback,
      suggestion: result.suggestion,
    };
  } else {
    if (body.rating === undefined) throw badRequest("`rating` is required for this review kind");
    rating = body.rating;
  }

  const next = schedule(userWord, rating, now);
  const mastered = isMastered(next);

  const xpAwarded = await db.$transaction(async (tx) => {
    // Guard against a double submit: only reschedule if the card is unchanged.
    const { count } = await tx.userWord.updateMany({
      where: { id: userWord.id, reps: userWord.reps, due: userWord.due },
      data: {
        ...next,
        stage: mastered ? "MASTERED" : "REVIEWING",
        masteredAt: userWord.masteredAt ?? (mastered ? now : null),
      },
    });
    if (count === 0) throw conflict("This review was already recorded");
    await tx.reviewLog.create({
      data: {
        userWordId: userWord.id,
        userId: user.id,
        kind: body.kind,
        rating,
        stateBefore: userWord.cardState,
        stability: next.stability,
        fsrsDifficulty: next.fsrsDifficulty,
        scheduledDays: next.scheduledDays,
        reviewedAt: now,
      },
    });
    let xp = 0;
    if (rating >= 3) xp += await awardXp(tx, user.id, "REVIEW_CORRECT", userWord.wordId, now);
    // Mastery XP is awarded once, even if the word later lapses and recovers.
    if (mastered && !userWord.masteredAt) {
      xp += await awardXp(tx, user.id, "WORD_MASTERED", userWord.wordId, now);
    }
    return xp;
  });

  return { rating, progress: await progressOf(userWord.id), xpAwarded, evaluation };
}
