"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, type Challenge, type Leaderboard, type WordSummary } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { CurriculumCard, NewCurriculum } from "./curricula";
import { useMe } from "./shell";
import { Button, dueText, Field, Meter, Notice, Section, Stage, TextArea } from "./ui";

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
            {rank === 0 && entry.xpThisWeek > 0 && board.entries.length > 1 && (
              <span className="label text-accent">Leading</span>
            )}
          </div>
          <p className="mt-1">
            <span className="text-2xl">{entry.xpThisWeek}</span>{" "}
            <span className="text-soft">XP this week · {entry.xpTotal} in all</span>
          </p>
          <p className="text-soft">
            {entry.streakDays === 0 ? "No streak yet" : `${entry.streakDays}-day streak`} ·{" "}
            {entry.wordsMastered} mastered · {entry.wordsStudied} studied
          </p>
        </div>
      ))}
    </div>
  );
}

function Challenges({ challenges }: { challenges: Challenge[] }) {
  return (
    <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {challenges.map((c) => (
        <li key={c.id}>
          <p className="flex items-baseline justify-between gap-3">
            <span>
              <span className="font-display text-xl font-semibold">{c.title}</span>
              <span className="label ml-2">
                {c.period === "DAILY" ? "today" : "this week"}
                {c.scope === "SHARED" && " · shared"}
              </span>
            </span>
            <span className={`label shrink-0 ${c.completed ? "text-good" : ""}`}>
              {c.completed ? `Done · +${c.xp} XP` : `${c.xp} XP`}
            </span>
          </p>
          <p className="text-soft">{c.description}</p>
          <Meter value={c.progress} max={c.target} label={`${c.progress} of ${c.target}`} />
        </li>
      ))}
    </ul>
  );
}

function AddWord({ tutorAvailable }: { tutorAvailable: boolean }) {
  const router = useRouter();
  const [manual, setManual] = useState(false);
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
    } finally {
      // Pages keep their state when you return to them; never leave this set.
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
          {busy ? "Adding…" : "Add"}
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
      <label className="flex items-center gap-2 text-soft">
        <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
        Write the definition myself
      </label>
      {!manual && (
        <p className="text-sm text-soft">
          The entry comes from the dictionary
          {tutorAvailable
            ? "; the tutor fills in its history and drafts words the dictionary lacks."
            : ". Words it lacks need a definition written by hand."}
        </p>
      )}
      {error && <Notice>{error}</Notice>}
    </form>
  );
}

function WordRow({ word }: { word: WordSummary }) {
  const progress = word.myProgress;
  const others = word.others.map((o) => o.user.displayName).join(", ");
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
        <p className="text-sm text-soft">
          {progress &&
            (progress.stage === "STUDYING"
              ? `${progress.acceptedSentences} of ${progress.sentencesRequired} sentences`
              : dueText(progress.due))}
          {progress && others && " · "}
          {others && `also studied by ${others}`}
        </p>
      </Link>
    </li>
  );
}

type Filter = "mine" | "discover" | "all";

const filters: { id: Filter; label: string }[] = [
  { id: "mine", label: "My words" },
  { id: "discover", label: "Discover" },
  { id: "all", label: "All" },
];

function Collection({ words }: { words: WordSummary[] }) {
  const me = useMe();
  const [filter, setFilter] = useState<Filter>("mine");
  const [query, setQuery] = useState("");

  const prefix = query.trim().toLowerCase();
  const shown = words.filter((w) => {
    if (!w.lemma.startsWith(prefix)) return false;
    if (filter === "mine") return w.myProgress !== null;
    // Discover: words other players added themselves that you have not begun.
    if (filter === "discover") {
      return w.myProgress === null && w.addedBy !== null && w.addedBy.id !== me.id;
    }
    return true;
  });
  const empty: Record<Filter, string> = {
    mine: "Nothing on your list yet. Begin a word from a curriculum or add one of your own.",
    discover: "Nothing new from the others just now.",
    all: "Nothing matches.",
  };

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className="label hover:text-ink aria-pressed:text-accent"
          >
            {f.label}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a word"
          aria-label="Find a word"
          className="min-w-32 flex-1 border-b border-rule bg-transparent py-1 placeholder:text-soft"
        />
      </div>
      <ul>
        {shown.map((word) => (
          <WordRow key={word.id} word={word} />
        ))}
      </ul>
      {shown.length === 0 && (
        <p className="mt-3 text-soft italic">{prefix ? "Nothing matches." : empty[filter]}</p>
      )}
    </>
  );
}

export function Library() {
  const words = useResource(api.listWords);
  const board = useResource(api.leaderboard);
  const meta = useResource(api.meta);
  const curricula = useResource(api.curricula);
  const challenges = useResource(api.challenges);

  return (
    <>
      {board.data && <Standings board={board.data} />}

      {challenges.data && challenges.data.challenges.length > 0 && (
        <Section title="Challenges">
          <Challenges challenges={challenges.data.challenges} />
        </Section>
      )}

      <Section title="Curricula">
        {curricula.error && <Notice>{curricula.error.message}</Notice>}
        {curricula.data && (
          <div className="space-y-4">
            <p className="text-soft">
              Everyone works through each list in the same order. Pass over words you already
              know; they will not come back for review.
            </p>
            {curricula.data.curricula.map((c) => (
              <CurriculumCard key={c.id} state={c} onChange={curricula.reload} />
            ))}
          </div>
        )}
      </Section>

      <Section title="A curriculum from a video, series or book">
        {meta.data && (
          <NewCurriculum tutorAvailable={meta.data.tutorAvailable} onCreated={curricula.reload} />
        )}
      </Section>

      <Section title="Add a word of your own">
        {meta.data && <AddWord tutorAvailable={meta.data.tutorAvailable} />}
      </Section>

      <Section title={`The collection${words.data ? ` · ${words.data.words.length}` : ""}`}>
        {words.error && <Notice>{words.error.message}</Notice>}
        {words.data && <Collection words={words.data.words} />}
      </Section>
    </>
  );
}
