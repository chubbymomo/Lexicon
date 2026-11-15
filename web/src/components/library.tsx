"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, type Leaderboard, type WordSummary } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { Button, dueText, Field, Notice, Section, Stage, TextArea } from "./ui";

function Standings({ board }: { board: Leaderboard }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {board.entries.map((entry, rank) => (
        <div key={entry.user.id} className="rounded-sm border border-rule bg-raised p-4">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-2xl font-semibold">
              {entry.user.displayName}
              {entry.isMe && <span className="label ml-2">you</span>}
            </span>
            {rank === 0 && entry.xpThisWeek > 0 && <span className="label text-accent">Leading</span>}
          </div>
          <p className="mt-1">
            <span className="text-2xl">{entry.xpThisWeek}</span>{" "}
            <span className="text-soft">XP this week · {entry.xpTotal} in all</span>
          </p>
          <p className="text-soft">
            {entry.streakDays === 0
              ? "No streak yet"
              : `${entry.streakDays}-day streak`}{" "}
            · {entry.wordsMastered} mastered · {entry.wordsStudied} studied
          </p>
        </div>
      ))}
    </div>
  );
}

function AddWord({ tutorAvailable }: { tutorAvailable: boolean }) {
  const router = useRouter();
  const [manual, setManual] = useState(!tutorAvailable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError(null);
    try {
      const word = await api.createWord({
        lemma: form.lemma,
        definition: manual ? form.definition : undefined,
        encounter: form.sourceTitle
          ? { sourceTitle: form.sourceTitle, passage: form.passage || undefined }
          : undefined,
      });
      router.push(`/words/${word.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Field label="A new word" name="lemma" required maxLength={60} autoComplete="off" />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? (manual ? "Adding…" : "Consulting the tutor…") : "Add"}
        </Button>
      </div>
      {manual && <TextArea label="Definition" name="definition" required rows={2} maxLength={1000} />}
      <details>
        <summary className="label cursor-pointer hover:text-ink">Where did you meet it?</summary>
        <div className="mt-3 space-y-3">
          <Field label="Book or article" name="sourceTitle" maxLength={200} />
          <TextArea label="The passage" name="passage" rows={2} maxLength={2000} />
        </div>
      </details>
      {tutorAvailable ? (
        <label className="flex items-center gap-2 text-soft">
          <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
          Write the definition myself
        </label>
      ) : (
        <p className="text-sm text-soft">
          The AI tutor is not configured, so entries are written by hand for now.
        </p>
      )}
      {error && <Notice>{error}</Notice>}
    </form>
  );
}

function WordRow({ word }: { word: WordSummary }) {
  const progress = word.myProgress;
  return (
    <li className="border-b border-rule py-3">
      <Link href={`/words/${word.id}`} className="group block">
        <div className="flex items-baseline justify-between gap-4">
          <span>
            <span className="font-display text-2xl font-semibold group-hover:text-accent">
              {word.lemma}
            </span>
            {word.partOfSpeech && <span className="ml-2 text-soft italic">{word.partOfSpeech}</span>}
          </span>
          <span className="shrink-0 text-right">
            <Stage stage={progress?.stage ?? null} />
          </span>
        </div>
        <p className="text-soft">{word.definition}</p>
        {progress && (
          <p className="text-sm text-soft">
            {progress.stage === "STUDYING"
              ? `${progress.acceptedSentences} of 5 sentences`
              : dueText(progress.due)}
          </p>
        )}
      </Link>
    </li>
  );
}

export function Library() {
  const words = useResource(api.listWords);
  const board = useResource(api.leaderboard);
  const meta = useResource(api.meta);
  const [filter, setFilter] = useState("");

  const shown = words.data?.words.filter((w) => w.lemma.startsWith(filter.trim().toLowerCase()));

  return (
    <>
      {board.data && <Standings board={board.data} />}

      <Section title="Add to the collection">
        {meta.data && <AddWord tutorAvailable={meta.data.tutorAvailable} />}
      </Section>

      <Section title={`The collection${words.data ? ` · ${words.data.words.length}` : ""}`}>
        {words.error && <Notice>{words.error.message}</Notice>}
        {words.data &&
          (words.data.words.length === 0 ? (
            <p className="text-soft italic">
              No words yet. Add the first one you would like to learn.
            </p>
          ) : (
            <>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Find a word"
                aria-label="Find a word"
                className="w-full border-b border-rule bg-transparent py-1 placeholder:text-soft"
              />
              <ul>{shown!.map((word) => <WordRow key={word.id} word={word} />)}</ul>
              {shown!.length === 0 && <p className="mt-3 text-soft italic">Nothing matches.</p>}
            </>
          ))}
      </Section>
    </>
  );
}
