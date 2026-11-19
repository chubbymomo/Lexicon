"use client";

import Link from "next/link";
import { useState } from "react";
import { api, type PlacementStep } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { useBeginNext } from "./curricula";
import { Button, Notice } from "./ui";

const CORE = "core";
const number = (n: number) => n.toLocaleString();

function Intro({ onStart, busy }: { onStart: () => void; busy: boolean }) {
  const core = useResource(() => api.curriculum(CORE), CORE);
  const state = core.data;
  return (
    <div className="space-y-4">
      <h1 className="font-display text-5xl font-semibold">Find your starting point</h1>
      <p>
        The core curriculum runs from more common words to rarer ones
        {state && `, ${number(state.total)} in all`}. This short check finds where the words stop
        being familiar to you, so you can start there instead of passing over easy words one at a
        time.
      </p>
      <p className="text-soft">
        Each question shows a word and four definitions. It climbs through ten levels, two or three
        questions each, and stops at the first level you do not pass, usually after a few minutes.
        Choose “I don’t know” rather than guessing: a lucky guess only starts you on words you will
        not know.
      </p>
      <p className="text-soft">
        Words before your starting point are passed over, not marked as known. Words you have
        already begun keep their progress, and you can take the check again whenever you like.
      </p>
      {state?.placementTaken && (
        <p>
          You currently start at word {number(state.startPosition)}.
        </p>
      )}
      <Button onClick={onStart} disabled={busy}>
        {busy ? "Preparing…" : state?.placementTaken ? "Take the check again" : "Begin the check"}
      </Button>
    </div>
  );
}

function Question({
  step,
  onAnswer,
  busy,
}: {
  step: NonNullable<PlacementStep["question"]>;
  onAnswer: (choice: number | null) => void;
  busy: boolean;
}) {
  return (
    <div>
      <p className="label">
        Level {step.level} of {step.levels} · question {step.number}
      </p>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-rule"
        role="progressbar"
        aria-label={`Level ${step.level} of ${step.levels}`}
        aria-valuenow={step.level}
        aria-valuemin={1}
        aria-valuemax={step.levels}
      >
        <div className="h-full bg-accent" style={{ width: `${(step.level / step.levels) * 100}%` }} />
      </div>
      <div className="mt-6 rounded-sm border border-rule bg-raised p-6 sm:p-8">
        <p className="label">What does it mean?</p>
        <p className="mt-2">
          <span className="font-display text-5xl font-semibold">{step.word}</span>
          <span className="ml-3 text-soft italic">{step.partOfSpeech}</span>
        </p>
        <ul className="mt-6 space-y-2">
          {step.options.map((option, i) => (
            <li key={`${step.id}-${i}`}>
              <button
                onClick={() => onAnswer(i)}
                disabled={busy}
                className="w-full rounded-sm border border-rule px-4 py-3 text-left transition hover:border-accent disabled:opacity-60"
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
        <Button variant="quiet" className="mt-4" onClick={() => onAnswer(null)} disabled={busy}>
          I don’t know
        </Button>
      </div>
    </div>
  );
}

function Result({ result }: { result: NonNullable<PlacementStep["result"]> }) {
  const { begin, busy, error } = useBeginNext();
  const passedOver = result.startPosition - 1;
  return (
    <div className="space-y-4">
      <h1 className="font-display text-5xl font-semibold">
        You start at word {number(result.startPosition)}
      </h1>
      <p>
        You passed {result.levelsPassed} of {result.levels} levels, answering {result.correct} of{" "}
        {result.asked} questions.{" "}
        {passedOver > 0
          ? `The ${number(passedOver)} commoner words before your starting point are passed over.`
          : "You start at the beginning of the curriculum."}
      </p>
      {result.startWord && (
        <p className="text-soft">
          Your first word is <span className="font-display text-2xl text-ink">{result.startWord}</span>,
          unless you have already begun it.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => begin(CORE)} disabled={busy !== null}>
          {busy ? "Opening…" : "Begin my next word"}
        </Button>
        <Link href="/" className="label text-accent hover:text-ink">
          Back to the library
        </Link>
      </div>
      {error && <Notice>{error}</Notice>}
    </div>
  );
}

export function Placement() {
  const [step, setStep] = useState<PlacementStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<PlacementStep>) {
    setBusy(true);
    setError(null);
    try {
      setStep(await action());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const question = step?.question;
  return (
    <div className="mx-auto max-w-2xl">
      {step?.result ? (
        <Result result={step.result} />
      ) : question ? (
        <Question
          step={question}
          busy={busy}
          onAnswer={(choice) => run(() => api.answerPlacement(CORE, question.id, choice))}
        />
      ) : (
        <Intro busy={busy} onStart={() => run(() => api.startPlacement(CORE))} />
      )}
      {error && (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      )}
    </div>
  );
}
