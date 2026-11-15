"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, type Sentence, type WordDetail } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { useMe } from "./shell";
import { Button, dueText, Field, Notice, Section, Stage, TextArea } from "./ui";

const kindLabel = { PREFIX: "prefix", ROOT: "root", SUFFIX: "suffix" } as const;

function Entry({ word }: { word: WordDetail }) {
  return (
    <>
      <header>
        {word.curriculumPosition !== null && (
          <p className="label">Curriculum · word {word.curriculumPosition}</p>
        )}
        <h1 className="font-display text-6xl font-semibold leading-tight">{word.lemma}</h1>
        <p className="text-soft">
          {word.pronunciation && <span className="mr-3">{word.pronunciation}</span>}
          {word.partOfSpeech && <span className="italic">{word.partOfSpeech}</span>}
        </p>
        <p className="mt-4 text-2xl leading-snug">{word.definition}</p>
      </header>

      {word.etymology && (
        <Section title="Etymology">
          <p>{word.etymology}</p>
        </Section>
      )}

      {word.morphemes.length > 0 && (
        <Section title="Construction">
          <dl className="space-y-2">
            {word.morphemes.map((m) => (
              <div key={m.id}>
                <dt className="inline font-display text-xl font-semibold">{m.form}</dt>{" "}
                <dd className="inline">
                  <span className="text-soft italic">
                    {kindLabel[m.kind]}
                    {m.origin && `, ${m.origin}`}
                  </span>{" "}
                  · {m.meaning}
                  {/* Suffixes are shared by too many words to be a useful link. */}
                  {m.kind !== "SUFFIX" && m.relatedWords.length > 0 && (
                    <span className="block pl-4 text-soft">
                      also in{" "}
                      {m.relatedWords.map((related, i) => (
                        <span key={related.id}>
                          {i > 0 && ", "}
                          <Link href={`/words/${related.id}`} className="text-accent underline">
                            {related.lemma}
                          </Link>
                        </span>
                      ))}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {word.examples.length > 0 && (
        <Section title="In use">
          <ul className="space-y-2">
            {word.examples.map((example) => (
              <li key={example} className="border-l border-rule pl-4 italic">
                {example}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(word.relatedForms.length > 0 || word.synonyms.length > 0 || word.antonyms.length > 0) && (
        <Section title="Relations">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {(
              [
                ["Forms", word.relatedForms],
                ["Synonyms", word.synonyms],
                ["Antonyms", word.antonyms],
              ] as const
            ).map(
              ([label, items]) =>
                items.length > 0 && (
                  <div key={label} className="contents">
                    <dt className="text-soft italic">{label}</dt>
                    <dd>{items.join(", ")}</dd>
                  </div>
                ),
            )}
          </dl>
        </Section>
      )}
    </>
  );
}

function Verdict({ sentence }: { sentence: Sentence }) {
  const accepted = sentence.verdict === "ACCEPTED";
  const checks = [
    ["Grammar", sentence.grammarOk],
    ["Usage", sentence.usageOk],
    ["Context", sentence.contextOk],
  ] as const;
  return (
    <div className="mt-2 text-base">
      <p className="flex flex-wrap gap-x-4">
        {checks.map(([label, ok]) => (
          <span key={label} className={`label ${ok ? "text-good" : "text-warn"}`}>
            {label} {ok ? "✓" : "✗"}
          </span>
        ))}
      </p>
      <p className={accepted ? "text-soft" : ""}>{sentence.feedback}</p>
      {sentence.suggestion && (
        <p className="text-soft">
          Consider: <span className="italic">{sentence.suggestion}</span>
        </p>
      )}
    </div>
  );
}

function SentenceSlot({
  word,
  slot,
  onChange,
}: {
  word: WordDetail;
  slot: WordDetail["sentences"][number];
  onChange: () => void;
}) {
  const latest = slot.latest;
  const accepted = latest?.verdict === "ACCEPTED";
  const [text, setText] = useState(latest && !accepted ? latest.text : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.submitSentence(word.id, { slot: slot.slot, text });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex gap-4 border-b border-rule py-4">
      <span className={`font-display text-3xl ${accepted ? "text-good" : "text-soft"}`}>
        {slot.slot}
      </span>
      <div className="flex-1">
        {accepted ? (
          <p>{latest.text}</p>
        ) : (
          <form onSubmit={submit} className="space-y-2">
            <TextArea
              label={latest ? "Revise your sentence" : `Use “${word.lemma}” in a sentence`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              maxLength={600}
              required
            />
            <Button type="submit" disabled={busy || text.trim().length < 3}>
              {busy ? "The tutor is reading…" : latest ? "Submit revision" : "Submit"}
            </Button>
          </form>
        )}
        {error && <Notice>{error}</Notice>}
        {latest && <Verdict sentence={latest} />}
      </div>
    </li>
  );
}

function Encounters({ word, onChange }: { word: WordDetail; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = Object.fromEntries(new FormData(formElement)) as Record<string, string>;
    setError(null);
    try {
      await api.addEncounter(word.id, {
        sourceTitle: form.sourceTitle,
        sourceAuthor: form.sourceAuthor || undefined,
        passage: form.passage || undefined,
      });
      formElement.reset();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Section title="Met in reading">
      <ul className="space-y-3">
        {word.encounters.map((e) => (
          <li key={e.id}>
            {e.passage && <blockquote className="border-l border-rule pl-4 italic">{e.passage}</blockquote>}
            <p className="text-soft">
              {e.sourceTitle}
              {e.sourceAuthor && `, ${e.sourceAuthor}`} · noted by {e.user.displayName}
            </p>
          </li>
        ))}
      </ul>
      <details className="mt-3">
        <summary className="label cursor-pointer hover:text-ink">Record an encounter</summary>
        <form onSubmit={submit} className="mt-3 space-y-3">
          <Field label="Book or article" name="sourceTitle" required maxLength={200} />
          <Field label="Author" name="sourceAuthor" maxLength={200} />
          <TextArea label="The passage" name="passage" rows={2} maxLength={2000} />
          {error && <Notice>{error}</Notice>}
          <Button type="submit" variant="quiet">
            Save
          </Button>
        </form>
      </details>
    </Section>
  );
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
const commas = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** Correct the shared entry. Everyone sees the change. */
function EditEntry({ word, onSaved }: { word: WordDetail; onSaved: (word: WordDetail) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api.updateWord(word.id, {
          definition: form.definition,
          pronunciation: form.pronunciation,
          partOfSpeech: form.partOfSpeech,
          etymology: form.etymology,
          examples: lines(form.examples),
          relatedForms: commas(form.relatedForms),
          synonyms: commas(form.synonyms),
          antonyms: commas(form.antonyms),
        }),
      );
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-10" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="label cursor-pointer hover:text-ink">Correct this entry</summary>
      {open && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <p className="text-soft">The entry is shared, so a correction changes it for everyone.</p>
          <TextArea label="Definition" name="definition" defaultValue={word.definition} rows={2} required maxLength={1000} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pronunciation" name="pronunciation" defaultValue={word.pronunciation ?? ""} maxLength={100} />
            <Field label="Part of speech" name="partOfSpeech" defaultValue={word.partOfSpeech ?? ""} maxLength={40} />
          </div>
          <TextArea label="Etymology" name="etymology" defaultValue={word.etymology ?? ""} rows={3} maxLength={2000} />
          <TextArea label="Examples, one per line" name="examples" defaultValue={word.examples.join("\n")} rows={3} />
          <Field label="Related forms, separated by commas" name="relatedForms" defaultValue={word.relatedForms.join(", ")} />
          <Field label="Synonyms, separated by commas" name="synonyms" defaultValue={word.synonyms.join(", ")} />
          <Field label="Antonyms, separated by commas" name="antonyms" defaultValue={word.antonyms.join(", ")} />
          {error && <Notice>{error}</Notice>}
          <Button type="submit" variant="quiet" disabled={busy}>
            {busy ? "Saving…" : "Save correction"}
          </Button>
        </form>
      )}
    </details>
  );
}

function Others({ word, onChange }: { word: WordDetail; onChange: (action: () => Promise<WordDetail>) => void }) {
  const me = useMe();
  const users = useResource(api.listUsers);
  const have = new Set(word.others.map((o) => o.user.id));
  const candidates = (users.data?.users ?? []).filter((u) => u.id !== me.id && !have.has(u.id));

  return (
    <div className="mt-4 space-y-1 text-soft">
      {word.others.map((o) => (
        <p key={o.user.id}>
          {o.user.displayName}: <Stage stage={o.stage} />
        </p>
      ))}
      {word.curriculumPosition === null && candidates.length > 0 && (
        <p>
          Introduce this word to{" "}
          {candidates.map((u, i) => (
            <span key={u.id}>
              {i > 0 && ", "}
              <button
                className="text-accent underline"
                onClick={() => onChange(() => api.introduceWord(word.id, u.id))}
              >
                {u.displayName}
              </button>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

export function WordStudy() {
  const { id } = useParams<{ id: string }>();
  const word = useResource(() => api.getWord(id), id);
  const [error, setError] = useState<string | null>(null);

  if (word.error && !word.data) return <Notice>{word.error.message}</Notice>;
  if (!word.data) return <p className="text-soft">Turning to the page…</p>;

  const data = word.data;
  const progress = data.myProgress;

  async function act(action: () => Promise<WordDetail>) {
    setError(null);
    try {
      word.set(await action());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <article>
      <Entry word={data} />

      <Section title="Your study">
        {error && <Notice>{error}</Notice>}
        {!progress ? (
          <div className="space-y-3">
            <p className="text-soft">
              {data.curriculumPosition === null
                ? "This word is in the collection but not yet on your list."
                : `This is word ${data.curriculumPosition} of the curriculum. You can begin it when it is your next word.`}
            </p>
            <Button onClick={() => act(() => api.studyWord(data.id))}>Begin studying</Button>
          </div>
        ) : (
          <>
            <p className="flex flex-wrap items-baseline gap-x-4">
              <Stage stage={progress.stage} />
              <span className="text-soft">
                {progress.stage === "STUDYING"
                  ? `${progress.acceptedSentences} of 5 sentences accepted`
                  : dueText(progress.due)}
                {progress.introducedBy && ` · introduced by ${progress.introducedBy.displayName}`}
              </span>
            </p>
            {progress.stage === "STUDYING" && (
              <p className="mt-2 text-soft">
                Write five original sentences. Each should make the meaning of the word plain from
                its context.
              </p>
            )}
            <ol>
              {data.sentences.map((slot) => (
                <SentenceSlot
                  key={`${slot.slot}:${slot.attempts}`}
                  word={data}
                  slot={slot}
                  onChange={word.reload}
                />
              ))}
            </ol>
          </>
        )}
        <Others word={data} onChange={act} />
      </Section>

      <Encounters word={data} onChange={word.reload} />
      <EditEntry word={data} onSaved={word.set} />
    </article>
  );
}
