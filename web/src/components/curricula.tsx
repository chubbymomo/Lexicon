"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { api, type CurriculumSummary, type SourceKind } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { useMe } from "./shell";
import { Button, Field, Meter, Notice, TextArea } from "./ui";

const sourceKinds: { id: SourceKind; label: string }[] = [
  { id: "series", label: "Series" },
  { id: "film", label: "Film" },
  { id: "video", label: "Video" },
  { id: "book", label: "Book" },
  { id: "article", label: "Article" },
  { id: "podcast", label: "Podcast" },
  { id: "other", label: "Other" },
];

const kindLabel = (c: CurriculumSummary) =>
  c.kind === "CORE"
    ? "Core"
    : (sourceKinds.find((k) => k.id === c.sourceKind)?.label ?? "Source");

/**
 * Begin a curriculum's next word and open it. The busy flag is cleared once the
 * new page is on its way: pages keep their state when you come back to them,
 * so a flag left set would show "Opening…" forever.
 */
export function useBeginNext() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function begin(curriculumId: string) {
    setBusy(curriculumId);
    setError(null);
    try {
      const word = await api.startNextWord(curriculumId);
      router.push(`/words/${word.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return { begin, busy, error };
}

export function CurriculumCard({
  state,
  onChange,
}: {
  state: CurriculumSummary;
  onChange: () => void;
}) {
  const me = useMe();
  const { begin, busy, error: beginError } = useBeginNext();
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function skip(lemma: string) {
    setSkipping(true);
    setError(null);
    try {
      await api.skipWord(state.id, lemma);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSkipping(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove “${state.title}” for everyone? Words already begun are kept.`)) return;
    try {
      await api.deleteCurriculum(state.id);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <article className="rounded-sm border border-rule bg-raised p-4 sm:p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h3 className="font-display text-2xl font-semibold">{state.title}</h3>
        <span className="label">
          {kindLabel(state)} · {state.total.toLocaleString()} words
        </span>
      </header>
      {(state.description || state.createdBy) && (
        <p className="text-soft">
          {state.description}
          {state.description && state.createdBy && " · "}
          {state.createdBy && `added by ${state.createdBy.id === me.id ? "you" : state.createdBy.displayName}`}
        </p>
      )}

      <ul className="mt-3 space-y-1">
        {state.players.map((p) => (
          <li key={p.user.id} className="grid grid-cols-[6.5rem_1fr] items-center gap-3">
            <span className="truncate">
              {p.user.displayName}
              {p.isMe && <span className="label ml-2">you</span>}
            </span>
            <Meter
              value={p.progress}
              max={state.total}
              label={`${p.progress.toLocaleString()} of ${state.total.toLocaleString()}`}
            />
          </li>
        ))}
      </ul>

      {state.placementAvailable &&
        (!state.placementTaken && state.studied + state.known + state.inProgress.length < 25 ? (
          <div className="mt-4 rounded-sm border border-accent/40 p-3">
            <p>
              The list starts with common words. A short check finds where yours stop being
              familiar, so you can start there.
            </p>
            <Link href="/placement" className="label mt-1 inline-block text-accent hover:text-ink">
              Find my starting point
            </Link>
          </div>
        ) : (
          <p className="mt-2 text-sm text-soft">
            {state.startPosition > 1 && `You start at word ${state.startPosition.toLocaleString()}. `}
            <Link href="/placement" className="text-accent underline">
              {state.placementTaken ? "Take the placement check again" : "Find my starting point"}
            </Link>
          </p>
        ))}

      {state.inProgress.length > 0 && (
        <p className="mt-3">
          <span className="label mr-2">In progress</span>
          {state.inProgress.map((word, i) => (
            <span key={word.id}>
              {i > 0 && ", "}
              <Link href={`/words/${word.id}`} className="text-accent underline">
                {word.lemma}
              </Link>{" "}
              <span className="text-soft">
                ({word.myProgress?.acceptedSentences ?? 0}/{word.myProgress?.sentencesRequired ?? 3})
              </span>
            </span>
          ))}
        </p>
      )}

      {state.next ? (
        <div className="mt-4 border-t border-rule pt-3">
          <p className="label">Next · word {state.next.position.toLocaleString()}</p>
          <p>
            <span className="font-display text-3xl font-semibold">{state.next.lemma}</span>
            {state.next.partOfSpeech && (
              <span className="ml-2 text-soft italic">{state.next.partOfSpeech}</span>
            )}
          </p>
          {state.next.context && <p className="text-soft italic">“{state.next.context}”</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {state.canStartNext ? (
              <Button onClick={() => begin(state.id)} disabled={busy !== null}>
                {busy ? "Opening…" : "Begin this word"}
              </Button>
            ) : (
              <span className="text-soft">
                Finish a word in progress first; up to {state.maxInProgress} can be under way.
              </span>
            )}
            <Button
              variant="quiet"
              onClick={() => skip(state.next!.lemma)}
              disabled={skipping || busy !== null}
              title="Mark it as known and move on; it will not be reviewed"
            >
              {skipping ? "Moving on…" : "I already know it"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <Notice tone="good">You have reached the end of this curriculum.</Notice>
        </div>
      )}
      {(error || beginError) && (
        <div className="mt-3">
          <Notice>{error ?? beginError}</Notice>
        </div>
      )}
      {state.kind === "SOURCE" && state.createdBy?.id === me.id && (
        <button onClick={remove} className="label mt-4 hover:text-ink">
          Remove this curriculum
        </button>
      )}
    </article>
  );
}

const MAX_TEXT = 500_000;

/** Make a curriculum from a video, series, book or other source. */
export function NewCurriculum({
  tutorAvailable,
  onCreated,
}: {
  tutorAvailable: boolean;
  onCreated: () => void;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_TEXT * 2) {
      setError("That file is too large; a film's subtitles are usually well under 200 KB.");
      return;
    }
    setText((await file.text()).slice(0, MAX_TEXT));
    setFileName(file.name);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const curriculum = await api.createCurriculum({
        title: values.title,
        sourceKind: values.sourceKind as SourceKind,
        description: values.description || undefined,
        text: text.trim() || undefined,
        wordCount: Number(values.wordCount),
      });
      setCreated(`“${curriculum.title}” is ready with ${curriculum.total} words.`);
      form.reset();
      setText("");
      setFileName(null);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-soft">
        Make a list from something you are watching, reading or listening to. Paste its subtitles
        or transcript (or choose an .srt, .vtt or .txt file) and Lexicon picks the words worth
        learning, in the order they come up, with the line each appears in.
        {tutorAvailable && " With only a title, the tutor suggests words from what it knows of the work."}
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <Field label="Title" name="title" required maxLength={120} placeholder="The Wire, season 1" />
        <label className="block">
          <span className="label">Kind</span>
          <select
            name="sourceKind"
            defaultValue="series"
            className="mt-1 w-full rounded-sm border border-rule bg-raised px-3 py-2 text-ink"
          >
            {sourceKinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <TextArea
        label={fileName ? `Text from ${fileName}` : "Subtitles, transcript or text"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFileName(null);
        }}
        rows={5}
        maxLength={MAX_TEXT}
        placeholder={tutorAvailable ? "Optional with the tutor; leave empty to work from the title" : ""}
        required={!tutorAvailable}
      />
      <div className="flex flex-wrap items-end gap-4">
        <label className="label cursor-pointer hover:text-ink">
          Choose a file
          <input type="file" accept=".srt,.vtt,.txt,text/plain" onChange={readFile} className="sr-only" />
        </label>
        <label className="flex items-center gap-2 text-soft">
          Words
          <select
            name="wordCount"
            defaultValue="25"
            className="rounded-sm border border-rule bg-raised px-2 py-1 text-ink"
          >
            {[10, 15, 25, 40, 60, 100].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <Field label="Note (optional)" name="description" maxLength={500} />
      </div>
      {error && <Notice>{error}</Notice>}
      {created && <Notice tone="good">{created}</Notice>}
      <Button type="submit" disabled={busy}>
        {busy ? "Choosing words… this can take a minute" : "Make the curriculum"}
      </Button>
    </form>
  );
}

/** After finishing a word: the next word in each curriculum, ready to begin. */
export function KeepGoing() {
  const curricula = useResource(api.curricula);
  const { begin, busy, error } = useBeginNext();
  const ready = (curricula.data?.curricula ?? []).filter((c) => c.next && c.canStartNext);

  return (
    <div className="space-y-3">
      {ready.length > 0 ? (
        <ul className="space-y-2">
          {ready.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button onClick={() => begin(c.id)} disabled={busy !== null}>
                {busy === c.id ? "Opening…" : `Begin “${c.next!.lemma}”`}
              </Button>
              <span className="text-soft">next in {c.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        curricula.data && (
          <p className="text-soft">
            Finish a word in progress before beginning another, or add a curriculum from the
            library.
          </p>
        )
      )}
      {error && <Notice>{error}</Notice>}
      <p className="flex flex-wrap gap-x-5">
        <Link href="/review" className="label text-accent hover:text-ink">
          Review due words
        </Link>
        <Link href="/" className="label text-accent hover:text-ink">
          Back to the library
        </Link>
      </p>
    </div>
  );
}
