/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies are checked by assertions */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { loadDictionary, type DictionaryData } from "@/server/services/dictionary";
import type {
  DraftedEntry,
  EnrichedEntry,
  SentenceEvaluation,
  suggestSourceWords,
} from "@/server/services/tutor";
import { call, resetDatabase } from "./helpers";

// The tutor is the only external dependency; tests script its answers.
const tutor = vi.hoisted(() => ({
  available: vi.fn(() => true),
  draft: vi.fn<(lemma: string) => Promise<DraftedEntry>>(),
  evaluate: vi.fn<(input: { sentence: string }) => Promise<SentenceEvaluation>>(),
  enrich: vi.fn<(input: { lemma: string }) => Promise<EnrichedEntry>>(),
  choose: vi.fn<(input: { candidates: { lemma: string }[] }) => Promise<string[]>>(),
  suggest: vi.fn<typeof suggestSourceWords>(),
}));
vi.mock("@/server/services/tutor", async (original) => ({
  ...(await original<typeof import("@/server/services/tutor")>()),
  tutorAvailable: tutor.available,
  draftEntry: tutor.draft,
  evaluateSentence: tutor.evaluate,
  enrichEntry: tutor.enrich,
  chooseSourceWords: tutor.choose,
  suggestSourceWords: tutor.suggest,
}));

import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { GET as leaderboard } from "@/app/api/v1/leaderboard/route";
import { GET as achievements } from "@/app/api/v1/achievements/route";
import { GET as challenges } from "@/app/api/v1/challenges/route";
import { POST as nextWord } from "@/app/api/v1/curricula/[id]/next/route";
import { DELETE as deleteCurriculum, GET as curriculum } from "@/app/api/v1/curricula/[id]/route";
import { POST as skipWord } from "@/app/api/v1/curricula/[id]/skip/route";
import { POST as createCurriculum, GET as listCurricula } from "@/app/api/v1/curricula/route";
import { GET as me } from "@/app/api/v1/me/route";
import { GET as meta } from "@/app/api/v1/meta/route";
import { GET as stats } from "@/app/api/v1/stats/route";
import { GET as listUsers } from "@/app/api/v1/users/route";
import { promoteCompletedStudies } from "@/server/services/study";
import { GET as dueReviews } from "@/app/api/v1/reviews/due/route";
import { POST as submitReview } from "@/app/api/v1/reviews/route";
import { POST as introduce } from "@/app/api/v1/words/[id]/introduce/route";
import { GET as getWord } from "@/app/api/v1/words/[id]/route";
import { POST as submitSentence } from "@/app/api/v1/words/[id]/sentences/route";
import { GET as listWords, POST as createWord } from "@/app/api/v1/words/route";

const good: SentenceEvaluation = {
  usesWord: true,
  grammarOk: true,
  usageOk: true,
  contextOk: true,
  feedback: "Well used.",
  suggestion: null,
};
const weak: SentenceEvaluation = {
  ...good,
  contextOk: false,
  feedback: "The sentence does not show what the word means.",
  suggestion: "The ephemeral frost vanished by noon.",
};

const draft: DraftedEntry = {
  isEnglishWord: true,
  lemma: "benevolent",
  pronunciation: "/bəˈnɛvələnt/",
  partOfSpeech: "adjective",
  definition: "Well meaning and kindly.",
  etymology: "From Latin bene 'well' and velle 'to wish'.",
  morphemes: [
    { kind: "PREFIX", form: "bene-", meaning: "well, good", origin: "Latin" },
    { kind: "ROOT", form: "vol", meaning: "to wish", origin: "Latin" },
  ],
  relatedForms: ["benevolence (noun)"],
  synonyms: ["kind"],
  antonyms: ["malevolent"],
  examples: ["A benevolent stranger paid for their meal."],
  difficulty: 2,
};

async function signUp(name: string) {
  const { data } = await call(register, {
    body: {
      email: `${name}@example.com`,
      displayName: name,
      password: "correct horse battery",
      inviteCode: "test-invite",
    },
  });
  return data.token as string;
}

const manualWord = {
  lemma: "Ephemeral",
  definition: "Lasting for a very short time.",
  partOfSpeech: "adjective",
  examples: ["Fame proved ephemeral for the young singer."],
};

/** Submit five accepted sentences so the word enters spaced repetition. */
async function completeStudy(token: string, wordId: string) {
  tutor.evaluate.mockResolvedValue(good);
  let last;
  for (let slot = 1; slot <= 3; slot++) {
    last = await call(submitSentence, {
      token,
      params: { id: wordId },
      body: { slot, text: `Sentence number ${slot} about ephemeral things.` },
    });
  }
  return last!;
}

beforeEach(async () => {
  await resetDatabase();
  for (const mock of Object.values(tutor)) mock.mockReset();
  tutor.available.mockReturnValue(true);
  tutor.enrich.mockRejectedValue(new Error("not scripted"));
});

describe("accounts", () => {
  it("registers, signs in and signs out", async () => {
    const token = await signUp("ada");
    expect((await call(me, { token })).data.displayName).toBe("ada");

    const signedIn = await call(login, {
      body: { email: "ADA@example.com", password: "correct horse battery" },
    });
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.get("set-cookie")!;
    expect(cookie).toContain("lexicon_session=");
    expect(cookie).toContain("HttpOnly");
    // Plain HTTP must not get a Secure cookie, or the browser would drop it.
    expect(cookie).not.toContain("Secure");

    const behindTls = await call(login, {
      body: { email: "ada@example.com", password: "correct horse battery" },
      headers: { "x-forwarded-proto": "https" },
    });
    expect(behindTls.headers.get("set-cookie")).toContain("Secure");

    await call(logout, { token, method: "POST" });
    expect((await call(me, { token })).status).toBe(401);
  });

  it("rejects a wrong invite code and a wrong password, and honours an account cap", async () => {
    const wrongCode = await call(register, {
      body: {
        email: "x@example.com",
        displayName: "x",
        password: "correct horse battery",
        inviteCode: "nope",
      },
    });
    expect(wrongCode.status).toBe(403);

    await signUp("ada");
    await signUp("grace");
    const wrongPassword = await call(login, {
      body: { email: "ada@example.com", password: "incorrect" },
    });
    expect(wrongPassword.status).toBe(401);

    // With no cap, a third player is welcome.
    await signUp("edsger");
    expect(await db.user.count()).toBe(3);

    vi.stubEnv("LEXICON_MAX_USERS", "3");
    expect((await call(meta)).data.registrationOpen).toBe(false);
    const third = await call(register, {
      body: {
        email: "third@example.com",
        displayName: "third",
        password: "correct horse battery",
        inviteCode: "test-invite",
      },
    });
    expect(third.status).toBe(403);
    expect(await db.user.count()).toBe(3);
    vi.unstubAllEnvs();
    expect((await call(meta)).data.registrationOpen).toBe(true);
  });

  it("requires a token", async () => {
    expect((await call(listWords)).status).toBe(401);
  });
});

describe("words", () => {
  it("saves a hand-written entry without calling the tutor", async () => {
    const token = await signUp("ada");
    const created = await call(createWord, { token, body: manualWord });
    expect(created.status).toBe(200);
    expect(created.data.lemma).toBe("ephemeral");
    expect(created.data.myProgress.stage).toBe("STUDYING");
    expect(created.data.sentences).toHaveLength(3);
    expect(created.data.myProgress.sentencesRequired).toBe(3);
    expect(tutor.draft).not.toHaveBeenCalled();

    const duplicate = await call(createWord, { token, body: manualWord });
    expect(duplicate.status).toBe(409);
  });

  it("drafts an entry with the tutor and links words that share a morpheme", async () => {
    const token = await signUp("ada");
    tutor.draft.mockResolvedValueOnce(draft);
    const first = await call(createWord, { token, body: { lemma: "benevolent" } });
    expect(first.data.etymology).toContain("Latin");
    expect(first.data.morphemes.map((m: any) => m.form)).toEqual(["bene", "vol"]);

    tutor.draft.mockResolvedValueOnce({
      ...draft,
      lemma: "benefactor",
      morphemes: [{ kind: "PREFIX", form: "bene", meaning: "good", origin: "Latin" }],
    });
    const second = await call(createWord, { token, body: { lemma: "benefactor" } });
    expect(second.data.morphemes[0].relatedWords).toEqual([
      { id: first.data.id, lemma: "benevolent" },
    ]);
  });

  it("refuses a word the tutor does not recognise", async () => {
    const token = await signUp("ada");
    tutor.draft.mockResolvedValueOnce({ ...draft, isEnglishWord: false });
    const res = await call(createWord, { token, body: { lemma: "asdfgh" } });
    expect(res.status).toBe(409);
    expect(await db.word.count()).toBe(0);
  });

  it("validates input", async () => {
    const token = await signUp("ada");
    const res = await call(createWord, { token, body: { lemma: "drop table;" } });
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe("bad_request");
  });

  it("keeps each person's progress separate and lets one introduce a word", async () => {
    const ada = await signUp("ada");
    const grace = await signUp("grace");
    const { data: word } = await call(createWord, { token: ada, body: manualWord });

    const forGrace = await call(getWord, { token: grace, params: { id: word.id } });
    expect(forGrace.data.myProgress).toBeNull();
    expect(forGrace.data.others).toEqual([
      { user: expect.objectContaining({ displayName: "ada" }), stage: "STUDYING" },
    ]);

    const notStarted = await call(listWords, { token: grace, query: "?stage=NOT_STARTED" });
    expect(notStarted.data.words).toHaveLength(1);

    const players = (await call(listUsers, { token: ada })).data.users;
    const graceId = players.find((u: any) => u.displayName === "grace").id;
    const introduced = await call(introduce, {
      token: ada,
      params: { id: word.id },
      body: { userId: graceId },
    });
    expect(introduced.data.others).toEqual([
      { user: { id: graceId, displayName: "grace" }, stage: "STUDYING" },
    ]);
    const after = await call(getWord, { token: grace, params: { id: word.id } });
    expect(after.data.myProgress.introducedBy.displayName).toBe("ada");

    const again = await call(introduce, {
      token: ada,
      params: { id: word.id },
      body: { userId: graceId },
    });
    expect(again.status).toBe(409);
    const unknown = await call(introduce, {
      token: ada,
      params: { id: word.id },
      body: { userId: "nobody" },
    });
    expect(unknown.status).toBe(404);
  });
});

describe("five sentences", () => {
  it("records feedback, allows revision and schedules the word after five", async () => {
    const token = await signUp("ada");
    const { data: word } = await call(createWord, { token, body: manualWord });
    const params = { id: word.id };

    tutor.evaluate.mockResolvedValueOnce(weak);
    const first = await call(submitSentence, {
      token,
      params,
      body: { slot: 1, text: "It was ephemeral." },
    });
    expect(first.data.sentence.verdict).toBe("NEEDS_REVISION");
    expect(first.data.sentence.suggestion).toBeTruthy();
    expect(first.data.xpAwarded).toBe(0);
    expect(first.data.progress.acceptedSentences).toBe(0);

    const done = await completeStudy(token, word.id);
    expect(done.data.progress.stage).toBe("REVIEWING");
    expect(done.data.progress.acceptedSentences).toBe(3);
    expect(done.data.xpAwarded).toBe(24); // sentence 4 + word studied 20
    expect(new Date(done.data.progress.due).getTime()).toBeGreaterThan(Date.now() + 86_000_000);

    const detail = await call(getWord, { token, params });
    expect(detail.data.sentences[0].attempts).toBe(2);

    const resubmit = await call(submitSentence, {
      token,
      params,
      body: { slot: 1, text: "Another ephemeral attempt." },
    });
    expect(resubmit.status).toBe(409);
  });

  it("does not accept a sentence that leaves the word out", async () => {
    const token = await signUp("ada");
    const { data: word } = await call(createWord, { token, body: manualWord });
    tutor.evaluate.mockResolvedValueOnce({ ...good, usesWord: false });
    const res = await call(submitSentence, {
      token,
      params: { id: word.id },
      body: { slot: 1, text: "The frost vanished by noon." },
    });
    expect(res.data.sentence.verdict).toBe("NEEDS_REVISION");
    expect(res.data.sentence.usageOk).toBe(false);
  });
});

describe("reviews", () => {
  async function studiedWord(token: string) {
    const { data: word } = await call(createWord, { token, body: manualWord });
    const { data } = await completeStudy(token, word.id);
    return { wordId: word.id as string, userWordId: data.progress.userWordId as string };
  }

  const makeDue = (userWordId: string) =>
    db.userWord.update({
      where: { id: userWordId },
      data: { due: new Date(Date.now() - 60_000) },
    });

  it("only offers and accepts reviews that are due", async () => {
    const token = await signUp("ada");
    const { userWordId } = await studiedWord(token);

    expect((await call(dueReviews, { token })).data.dueCount).toBe(0);
    const early = await call(submitReview, {
      token,
      body: { userWordId, kind: "DEFINITION_RECALL", rating: 4 },
    });
    expect(early.status).toBe(409);

    await makeDue(userWordId);
    const due = await call(dueReviews, { token });
    expect(due.data.cards).toHaveLength(1);
    // One rep so far, and the example contains the word: test it in context.
    expect(due.data.cards[0].kind).toBe("WORD_FROM_CONTEXT");
    expect(due.data.cards[0].prompt).toBe("Fame proved _____ for the young singer.");
    expect(due.data.cards[0].answer.lemma).toBe("ephemeral");
  });

  it("reschedules further out after a good review and awards XP once", async () => {
    const token = await signUp("ada");
    const { userWordId } = await studiedWord(token);
    await makeDue(userWordId);

    const res = await call(submitReview, {
      token,
      body: { userWordId, kind: "WORD_FROM_CONTEXT", rating: 3 },
    });
    expect(res.status).toBe(200);
    expect(res.data.xpAwarded).toBe(10);
    expect(res.data.progress.reps).toBe(2);
    expect(new Date(res.data.progress.due).getTime()).toBeGreaterThan(Date.now() + 86_000_000);

    const repeat = await call(submitReview, {
      token,
      body: { userWordId, kind: "WORD_FROM_CONTEXT", rating: 3 },
    });
    expect(repeat.status).toBe(409);
  });

  it("gives no XP for a forgotten word and counts the lapse", async () => {
    const token = await signUp("ada");
    const { userWordId } = await studiedWord(token);
    await makeDue(userWordId);
    const res = await call(submitReview, {
      token,
      body: { userWordId, kind: "DEFINITION_RECALL", rating: 1 },
    });
    expect(res.data.xpAwarded).toBe(0);
    expect(res.data.progress.stage).toBe("REVIEWING");
  });

  it("marks a word mastered once its stability is long, and rewards it once", async () => {
    const token = await signUp("ada");
    const { userWordId } = await studiedWord(token);
    await db.userWord.update({
      where: { id: userWordId },
      data: {
        cardState: "REVIEW",
        stability: 30,
        scheduledDays: 30,
        lastReview: new Date(Date.now() - 30 * 86_400_000),
        due: new Date(Date.now() - 60_000),
      },
    });
    const res = await call(submitReview, {
      token,
      body: { userWordId, kind: "DEFINITION_RECALL", rating: 3 },
    });
    expect(res.data.progress.stage).toBe("MASTERED");
    expect(res.data.xpAwarded).toBe(60); // review 10 + mastery 50
    expect(res.data.progress.masteredAt).toBeTruthy();
  });

  it("lets the tutor's verdict set the rating for a sentence review", async () => {
    const token = await signUp("ada");
    const { userWordId } = await studiedWord(token);
    await makeDue(userWordId);

    const missing = await call(submitReview, { token, body: { userWordId, kind: "SENTENCE" } });
    expect(missing.status).toBe(400);

    tutor.evaluate.mockResolvedValueOnce(weak);
    const res = await call(submitReview, {
      token,
      body: { userWordId, kind: "SENTENCE", sentence: "It was ephemeral." },
    });
    expect(res.data.rating).toBe(1);
    expect(res.data.evaluation.verdict).toBe("NEEDS_REVISION");
  });

  it("cannot review someone else's card", async () => {
    const ada = await signUp("ada");
    const grace = await signUp("grace");
    const { userWordId } = await studiedWord(ada);
    await makeDue(userWordId);
    const res = await call(submitReview, {
      token: grace,
      body: { userWordId, kind: "DEFINITION_RECALL", rating: 3 },
    });
    expect(res.status).toBe(404);
  });
});

describe("leaderboard", () => {
  it("ranks both people by this week's XP", async () => {
    const ada = await signUp("ada");
    const grace = await signUp("grace");
    const { data: word } = await call(createWord, { token: ada, body: manualWord });
    await completeStudy(ada, word.id);

    const { data } = await call(leaderboard, { token: grace });
    expect(data.entries.map((e: any) => e.user.displayName)).toEqual(["ada", "grace"]);
    const [first, second] = data.entries;
    expect(first).toMatchObject({
      isMe: false,
      xpTotal: 47, // word added 5 + three sentences 12 + word studied 20 + daily challenge 10
      xpThisWeek: 47,
      streakDays: 1,
      wordsStudied: 1,
      wordsMastered: 0,
    });
    expect(second).toMatchObject({ isMe: true, xpTotal: 0, streakDays: 0 });
  });
});

const dictionary: DictionaryData = {
  format: 1,
  entries: [
    ["lucid", "adjective", "Clearly expressed.", ["clear"], [], ["A lucid account."], 3.0],
    ["candid", "adjective", "Frank and open.", ["frank"], [], ["A candid reply."], 3.4],
    ["stoic", "adjective", "Enduring without complaint.", [], [], [], 2.9],
    ["laconic", "adjective", "Using few words.", [], [], [], 2.5],
    ["sanguine", "adjective", "Optimistic.", [], [], [], 2.6],
    ["run", "verb", "Move swiftly on foot.", [], [], [], 5.5],
    ["obfuscate", "verb", "Make obscure.", [], [], [], 2.2],
    ["ephemeral", "adjective", "Lasting a short time.", [], [], [], 2.9],
    ["ubiquitous", "adjective", "Found everywhere.", [], [], [], 3.4],
    ["perfunctory", "adjective", "Done without care.", [], [], [], 2.4],
  ],
  forms: [["ran", "run"]],
  core: ["lucid", "candid", "stoic", "laconic", "sanguine"],
};

const enriched: EnrichedEntry = {
  pronunciation: "/ˈluːsɪd/",
  etymology: "From Latin lucidus, 'bright'.",
  morphemes: [{ kind: "ROOT", form: "luc", meaning: "light", origin: "Latin" }],
  relatedForms: ["lucidity (noun)"],
  examples: ["Her lucid notes made the method easy to follow."],
  difficulty: 2,
};

const core = { id: "core" };

describe("the core curriculum", () => {
  beforeEach(() => loadDictionary(dictionary));

  it("gives every player the same words in the same order", async () => {
    const ada = await signUp("ada");
    const grace = await signUp("grace");

    // Nobody has begun it yet, so it is not in the collection.
    expect((await call(curriculum, { token: ada, params: core })).data.next.wordId).toBeNull();
    const list = await call(listCurricula, { token: ada });
    expect(list.data.curricula).toHaveLength(1);
    expect(list.data.curricula[0]).toMatchObject({ id: "core", kind: "CORE", total: 5 });

    for (const token of [ada, grace]) {
      const state = await call(curriculum, { token, params: core });
      expect(state.data).toMatchObject({ studied: 0, known: 0, canStartNext: true });
      expect(state.data.next).toMatchObject({ lemma: "lucid", position: 1 });
      expect(state.data.upcoming.map((w: any) => w.lemma)).toEqual(dictionary.core);

      const first = await call(nextWord, { token, params: core, method: "POST" });
      expect(first.data).toMatchObject({ lemma: "lucid", addedBy: null });
      expect(first.data.curricula).toEqual([
        { id: "core", title: "The core curriculum", position: 1 },
      ]);
      expect(first.data.myProgress.stage).toBe("STUDYING");
      const second = await call(nextWord, { token, params: core, method: "POST" });
      expect(second.data.lemma).toBe("candid");
    }
    // The word joined the collection once, from the dictionary.
    expect(await db.word.count()).toBe(2);
  });

  it("has the tutor fill in the entry once, for everyone", async () => {
    const ada = await signUp("ada");
    const grace = await signUp("grace");
    tutor.enrich.mockResolvedValue(enriched);

    const { data } = await call(nextWord, { token: ada, params: core, method: "POST" });
    expect(data.etymology).toBe(enriched.etymology);
    expect(data.pronunciation).toBe(enriched.pronunciation);
    expect(data.morphemes.map((m: any) => m.form)).toEqual(["luc"]);
    expect(data.examples).toEqual(["A lucid account.", enriched.examples[0]]);

    await call(nextWord, { token: grace, params: core, method: "POST" });
    expect(tutor.enrich).toHaveBeenCalledTimes(1);
  });

  it("still begins a word when the tutor cannot fill it in", async () => {
    const token = await signUp("ada");
    const { status, data } = await call(nextWord, { token, params: core, method: "POST" });
    expect(status).toBe(200);
    expect(data.definition).toBe("Clearly expressed.");
    expect(data.etymology).toBeNull();
  });

  it("holds back new words until those in progress are finished", async () => {
    const token = await signUp("ada");
    for (let i = 0; i < 3; i++) await call(nextWord, { token, params: core, method: "POST" });

    const blocked = await call(curriculum, { token, params: core });
    expect(blocked.data.canStartNext).toBe(false);
    expect(blocked.data.inProgress.map((w: any) => w.lemma)).toEqual(["lucid", "candid", "stoic"]);
    expect((await call(nextWord, { token, params: core, method: "POST" })).status).toBe(409);

    await completeStudy(token, blocked.data.inProgress[0].id);
    const freed = await call(curriculum, { token, params: core });
    expect(freed.data).toMatchObject({ studied: 1, canStartNext: true });
    expect(freed.data.next.lemma).toBe("laconic");
    expect(freed.data.players).toEqual([
      { user: expect.objectContaining({ displayName: "ada" }), isMe: true, studied: 1, known: 0 },
    ]);
  });

  it("lets a player pass over a word they already know", async () => {
    const token = await signUp("ada");
    const skipped = await call(skipWord, { token, params: core, body: { lemma: "lucid" } });
    expect(skipped.data).toMatchObject({ known: 1, canStartNext: true });
    expect(skipped.data.next.lemma).toBe("candid");

    // Only the current next word can be passed over.
    const wrong = await call(skipWord, { token, params: core, body: { lemma: "stoic" } });
    expect(wrong.status).toBe(409);

    const mine = await call(listWords, { token, query: "?stage=KNOWN" });
    expect(mine.data.words.map((w: any) => w.lemma)).toEqual(["lucid"]);
    expect((await call(dueReviews, { token })).data.dueCount).toBe(0);
    expect((await call(stats, { token })).data.stages.known).toBe(1);
  });

  it("does not offer a word the player has already begun some other way", async () => {
    const token = await signUp("ada");
    await call(createWord, { token, body: { ...manualWord, lemma: "lucid" } });
    const state = await call(curriculum, { token, params: core });
    expect(state.data.next.lemma).toBe("candid");
    expect(state.data.inProgress.map((w: any) => w.lemma)).toEqual(["lucid"]);
  });

  it("keeps everyone's progress when the dictionary is reloaded in a new order", async () => {
    const token = await signUp("ada");
    const { data: word } = await call(nextWord, { token, params: core, method: "POST" });
    await completeStudy(token, word.id);

    await loadDictionary({ ...dictionary, core: [...dictionary.core].reverse() });
    const state = await call(curriculum, { token, params: core });
    expect(state.data).toMatchObject({ total: 5, studied: 1 });
    expect(state.data.next.lemma).toBe("sanguine");
  });

  it("stops at the end of the list", async () => {
    const token = await signUp("ada");
    for (const lemma of dictionary.core) {
      await call(skipWord, { token, params: core, body: { lemma } });
    }
    const state = await call(curriculum, { token, params: core });
    expect(state.data).toMatchObject({ next: null, canStartNext: false, known: 5 });
    expect((await call(nextWord, { token, params: core, method: "POST" })).status).toBe(409);
  });
});

describe("adding words from the dictionary", () => {
  beforeEach(() => loadDictionary(dictionary));

  it("uses the dictionary entry, finding the dictionary form of the word", async () => {
    const token = await signUp("ada");
    tutor.enrich.mockResolvedValue({ ...enriched, etymology: "From Old English rinnan." });
    const { data } = await call(createWord, { token, body: { lemma: "ran" } });
    expect(data).toMatchObject({
      lemma: "run",
      definition: "Move swiftly on foot.",
      etymology: "From Old English rinnan.",
    });
    expect(data.addedBy.displayName).toBe("ada");
    expect(tutor.draft).not.toHaveBeenCalled();
  });

  it("asks the tutor to draft words the dictionary lacks", async () => {
    const token = await signUp("ada");
    tutor.draft.mockResolvedValueOnce({ ...draft, lemma: "benevolent" });
    const { data } = await call(createWord, { token, body: { lemma: "benevolent" } });
    expect(data.etymology).toContain("Latin");
    expect(tutor.draft).toHaveBeenCalledOnce();
  });
});

describe("curricula from sources", () => {
  beforeEach(() => loadDictionary(dictionary));

  const subtitles = `1
00:00:01,000 --> 00:00:03,500
<i>Lucid dreams are rare.</i>

2
00:00:04,000 --> 00:00:06,000
They obfuscate everything, the cameras are ubiquitous.

3
00:00:07,000 --> 00:00:09,000
Perfunctory checks, ephemeral alliances. We ran.

4
00:00:10,000 --> 00:00:12,000
Ask Sanguine about it.`;

  it("finds words in subtitles and keeps the tutor's choice in the order they appear", async () => {
    const ada = await signUp("ada");
    tutor.choose.mockResolvedValue(["ubiquitous", "ephemeral", "obfuscate", "nonsense"]);
    const { status, data } = await call(createCurriculum, {
      token: ada,
      body: { title: "Night Shift, episode 1", sourceKind: "series", text: subtitles },
    });
    expect(status).toBe(200);
    expect(data).toMatchObject({ kind: "SOURCE", total: 3, sourceKind: "series" });
    expect(data.createdBy.displayName).toBe("ada");
    expect(data.upcoming.map((w: any) => [w.lemma, w.context])).toEqual([
      ["obfuscate", "They obfuscate everything, the cameras are ubiquitous."],
      ["ubiquitous", "They obfuscate everything, the cameras are ubiquitous."],
      ["ephemeral", "Perfunctory checks, ephemeral alliances."],
    ]);

    // The tutor saw uncommon dictionary words only: no names, no common words.
    const offered = tutor.choose.mock.calls[0][0].candidates.map((c) => c.lemma);
    expect(offered.sort()).toEqual(["ephemeral", "lucid", "obfuscate", "perfunctory", "ubiquitous"]);

    // Beginning a word records the line it came from.
    const begun = await call(nextWord, { token: ada, params: { id: data.id }, method: "POST" });
    expect(begun.data.encounters).toEqual([
      expect.objectContaining({
        sourceTitle: "Night Shift, episode 1",
        sourceKind: "series",
        passage: "They obfuscate everything, the cameras are ubiquitous.",
      }),
    ]);
    expect(begun.data.curricula.map((c: any) => c.title)).toEqual(["Night Shift, episode 1"]);
  });

  it("takes the rarest words when the tutor is not configured", async () => {
    const ada = await signUp("ada");
    tutor.available.mockReturnValue(false);
    const { data } = await call(createCurriculum, {
      token: ada,
      body: { title: "Night Shift", sourceKind: "series", text: subtitles, wordCount: 5 },
    });
    // Every uncommon dictionary word, in the order they appear; never the name.
    expect(data.upcoming.map((w: any) => w.lemma)).toEqual([
      "lucid",
      "obfuscate",
      "ubiquitous",
      "perfunctory",
      "ephemeral",
    ]);
    expect(tutor.choose).not.toHaveBeenCalled();
  });

  it("asks the tutor for words when only a title is given", async () => {
    const ada = await signUp("ada");
    tutor.suggest.mockResolvedValue({
      recognised: true,
      words: [
        { word: "obfuscated", context: "The firm hides its accounts." },
        { word: "Laconic", context: "The detective's manner." },
        { word: "flibbertigibbetish", context: "Not in the dictionary." },
        { word: "stoic", context: "The widow at the funeral." },
      ],
    });
    const { data } = await call(createCurriculum, {
      token: ada,
      body: { title: "Bleak House", sourceKind: "book" },
    });
    expect(data.upcoming.map((w: any) => w.lemma)).toEqual(["obfuscate", "laconic", "stoic"]);
    expect(data.upcoming[0].context).toBe("The firm hides its accounts.");
  });

  it("says so when the tutor does not know the work, or is not configured", async () => {
    const ada = await signUp("ada");
    tutor.suggest.mockResolvedValue({ recognised: false, words: [] });
    const unknown = await call(createCurriculum, {
      token: ada,
      body: { title: "My cousin's vlog", sourceKind: "video" },
    });
    expect(unknown.status).toBe(409);

    tutor.available.mockReturnValue(false);
    const noTutor = await call(createCurriculum, {
      token: ada,
      body: { title: "Bleak House", sourceKind: "book" },
    });
    expect(noTutor.status).toBe(503);
    expect(await db.track.count({ where: { kind: "SOURCE" } })).toBe(0);
  });

  it("lets only its creator remove a curriculum, and never the core one", async () => {
    const ada = await signUp("ada");
    const grace = await signUp("grace");
    tutor.choose.mockResolvedValue(["ubiquitous", "ephemeral", "obfuscate"]);
    const { data } = await call(createCurriculum, {
      token: ada,
      body: { title: "Night Shift", sourceKind: "series", text: subtitles },
    });
    const params = { id: data.id };
    expect((await call(deleteCurriculum, { token: grace, params, method: "DELETE" })).status).toBe(403);
    expect((await call(deleteCurriculum, { token: ada, params: core, method: "DELETE" })).status).toBe(403);
    expect((await call(deleteCurriculum, { token: ada, params, method: "DELETE" })).status).toBe(204);
    expect((await call(curriculum, { token: ada, params })).status).toBe(404);
  });
});

describe("fewer sentences per word", () => {
  it("finishes the study of words that already have enough accepted sentences", async () => {
    const token = await signUp("ada");
    const { data: word } = await call(createWord, { token, body: manualWord });
    const userWordId = word.myProgress.userWordId;
    // Accepted under the old five-sentence rule, in slots 1, 2 and 4.
    for (const slot of [1, 2, 4]) {
      await db.sentence.create({
        data: {
          userWordId,
          slot,
          text: `Ephemeral sentence ${slot}.`,
          verdict: "ACCEPTED",
          grammarOk: true,
          usageOk: true,
          contextOk: true,
          feedback: "Good.",
        },
      });
    }
    expect(await promoteCompletedStudies()).toBe(1);
    const after = await db.userWord.findUniqueOrThrow({ where: { id: userWordId } });
    expect(after.stage).toBe("REVIEWING");
    expect(after.due).not.toBeNull();
    expect(await promoteCompletedStudies()).toBe(0);
  });
});

describe("challenges and achievements", () => {
  const find = (list: any[], id: string) => list.find((c) => c.id === id || c.code === id);

  it("tracks progress and pays a challenge once", async () => {
    const token = await signUp("ada");
    const { data: word } = await call(createWord, { token, body: manualWord });

    const before = (await call(challenges, { token })).data.challenges;
    expect(find(before, "daily-sentences")).toMatchObject({ progress: 0, target: 3, completed: false });
    // Alone, there is nobody to share a challenge with.
    expect(find(before, "weekly-together")).toBeUndefined();

    await completeStudy(token, word.id);
    const after = (await call(challenges, { token })).data.challenges;
    expect(find(after, "daily-sentences")).toMatchObject({ progress: 3, completed: true });
    expect(find(after, "weekly-words")).toMatchObject({ progress: 1, target: 3, completed: false });

    const awards = await db.xpEvent.findMany({ where: { reason: "CHALLENGE_COMPLETED" } });
    expect(awards.map((a) => a.amount)).toEqual([10]);
  });

  it("rewards everyone when a shared challenge is met", async () => {
    const ada = await signUp("ada");
    const grace = await signUp("grace");
    const shared = async () =>
      find((await call(challenges, { token: grace })).data.challenges, "weekly-together");
    expect(await shared()).toMatchObject({ scope: "SHARED", target: 6, progress: 0 });

    for (let i = 0; i < 6; i++) {
      const { data: word } = await call(createWord, {
        token: ada,
        body: { ...manualWord, lemma: `word${"abcdef"[i]}` },
      });
      await completeStudy(ada, word.id);
    }
    expect(await shared()).toMatchObject({ progress: 6, completed: true });
    const paid = await db.xpEvent.findMany({
      where: { key: { startsWith: "challenge:weekly-together" } },
    });
    expect(paid).toHaveLength(2);
    const board = (await call(leaderboard, { token: grace })).data.entries;
    expect(board.find((e: any) => e.isMe).xpTotal).toBe(20);
  });

  it("unlocks achievements and reports progress towards the rest", async () => {
    const token = await signUp("ada");
    const { data: word } = await call(createWord, { token, body: manualWord });
    const early = (await call(achievements, { token })).data.achievements;
    expect(find(early, "studied-1")).toMatchObject({ progress: 0, unlockedAt: null });

    await completeStudy(token, word.id);
    const later = (await call(achievements, { token })).data.achievements;
    expect(find(later, "studied-1").unlockedAt).toBeTruthy();
    expect(find(later, "studied-10")).toMatchObject({ progress: 1, target: 10, unlockedAt: null });
  });
});

describe("stats", () => {
  it("summarises growth, recent days and the review forecast", async () => {
    const ada = await signUp("ada");
    const grace = await signUp("grace");
    const { data: word } = await call(createWord, { token: ada, body: manualWord });
    const { data: studied } = await completeStudy(ada, word.id);
    await db.userWord.update({
      where: { id: studied.progress.userWordId },
      data: { due: new Date(Date.now() - 60_000) },
    });
    await call(submitReview, {
      token: ada,
      body: { userWordId: studied.progress.userWordId, kind: "DEFINITION_RECALL", rating: 3 },
    });

    const { data } = await call(stats, { token: ada });
    expect(data.stages).toEqual({ studying: 0, reviewing: 1, mastered: 0, known: 0 });
    expect(data.recallRate).toBe(1);
    expect(data.weeks).toHaveLength(12);
    expect(data.weeks.at(-1)).toMatchObject({ studied: 1, mastered: 0 });
    expect(data.weeks[0].studied).toBe(0);
    expect(data.days).toHaveLength(30);
    expect(data.days.at(-1)).toMatchObject({ reviews: 1, recalled: 1 });
    expect(data.days.at(-1).xp).toBeGreaterThanOrEqual(55);
    expect(data.forecast).toHaveLength(14);
    expect(data.forecast.reduce((sum: number, d: any) => sum + d.due, 0)).toBe(1);
    expect(data.forecast[0].due).toBe(0);

    // Players can look at one another's progress.
    const adaId = data.user.id;
    const seenByGrace = await call(stats, { token: grace, query: `?userId=${adaId}` });
    expect(seenByGrace.data.user.displayName).toBe("ada");
    expect((await call(stats, { token: grace, query: "?userId=nobody" })).status).toBe(404);
  });
});
