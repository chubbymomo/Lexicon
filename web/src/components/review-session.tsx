"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api, type ReviewCard, type ReviewResult } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { Button, dueText, Notice, TextArea } from "./ui";

const ratings = [
  { rating: 1, label: "Forgot" },
  { rating: 2, label: "Hard" },
  { rating: 3, label: "Good" },
  { rating: 4, label: "Easy" },
];

const instruction: Record<ReviewCard["kind"], string> = {
  DEFINITION_RECALL: "Recall the meaning",
  WORD_FROM_CONTEXT: "Which word belongs here?",
  SENTENCE: "Compose",
};

function Answer({ card }: { card: ReviewCard }) {
  const { answer } = card;
  return (
    <div className="mt-6 border-t border-rule pt-4">
      <p>
        <span className="font-display text-3xl font-semibold">{answer.lemma}</span>
        {answer.partOfSpeech && <span className="ml-2 text-soft italic">{answer.partOfSpeech}</span>}
      </p>
      <p className="text-xl">{answer.definition}</p>
      {answer.example && <p className="mt-2 text-soft italic">{answer.example}</p>}
    </div>
  );
}

function Card({ card, onDone }: { card: ReviewCard; onDone: (xp: number) => void }) {
  const [revealed, setRevealed] = useState(false);
  const [sentence, setSentence] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(body: { rating?: number; sentence?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.submitReview({ userWordId: card.userWordId, kind: card.kind, ...body });
      // A composed sentence gets written feedback, so pause on it before moving on.
      if (card.kind === "SENTENCE") setResult(res);
      else onDone(res.xpAwarded);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-sm border border-rule bg-raised p-6 sm:p-8">
      <p className="label">{instruction[card.kind]}</p>
      <p
        className={
          card.kind === "DEFINITION_RECALL"
            ? "mt-3 font-display text-5xl font-semibold"
            : "mt-3 text-2xl"
        }
      >
        {card.prompt}
      </p>

      {card.kind === "SENTENCE" ? (
        result ? (
          <>
            <p className="mt-4 italic">{sentence}</p>
            <div className="mt-3">
              <Notice tone={result.rating >= 3 ? "good" : "warn"}>{result.evaluation?.feedback}</Notice>
            </div>
            {result.evaluation?.suggestion && (
              <p className="mt-2 text-soft">
                Consider: <span className="italic">{result.evaluation.suggestion}</span>
              </p>
            )}
            <Answer card={card} />
            <Button className="mt-6" onClick={() => onDone(result.xpAwarded)}>
              Continue
            </Button>
          </>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              submit({ sentence });
            }}
          >
            <TextArea
              label="Your sentence"
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              rows={2}
              maxLength={600}
              required
            />
            <Button type="submit" disabled={busy || sentence.trim().length < 3}>
              {busy ? "The tutor is reading…" : "Submit"}
            </Button>
          </form>
        )
      ) : revealed ? (
        <>
          <Answer card={card} />
          <p className="label mt-6">How well did you recall it?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ratings.map(({ rating, label }) => (
              <Button
                key={rating}
                variant={rating === 3 ? "primary" : "quiet"}
                disabled={busy}
                onClick={() => submit({ rating })}
              >
                {label}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <Button className="mt-6" onClick={() => setRevealed(true)}>
          Show the answer
        </Button>
      )}
      {error && (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      )}
    </div>
  );
}

export function ReviewSession() {
  const due = useResource(api.dueReviews);
  const [index, setIndex] = useState(0);
  const [xp, setXp] = useState(0);

  if (due.error && !due.data) return <Notice>{due.error.message}</Notice>;
  if (!due.data) return <p className="text-soft">Gathering today&apos;s words…</p>;

  const { cards, dueCount } = due.data;
  const card = cards[index];

  if (!card) {
    const more = dueCount - cards.length;
    return (
      <div className="py-10 text-center">
        <p className="font-display text-4xl font-semibold">
          {cards.length === 0 ? "Nothing is due" : "Reviews complete"}
        </p>
        <p className="mt-2 text-soft">
          {cards.length === 0
            ? "Words return here when it is time to recall them."
            : `You reviewed ${cards.length} ${cards.length === 1 ? "word" : "words"} and earned ${xp} XP.`}
        </p>
        {more > 0 ? (
          <Button
            className="mt-6"
            onClick={() => {
              setIndex(0);
              due.reload();
            }}
          >
            Continue with {more} more
          </Button>
        ) : (
          <Link href="/" className="label mt-6 inline-block text-accent">
            Back to the library
          </Link>
        )}
      </div>
    );
  }

  return (
    <>
      <p className="label mb-4">
        {index + 1} of {cards.length} · {dueText(card.due)}
      </p>
      <Card
        key={card.userWordId}
        card={card}
        onDone={(earned) => {
          setXp((total) => total + earned);
          setIndex((i) => i + 1);
        }}
      />
    </>
  );
}
