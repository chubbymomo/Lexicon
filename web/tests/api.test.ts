/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies are checked by assertions */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import type { DraftedEntry, SentenceEvaluation } from "@/server/services/tutor";
import { call, resetDatabase } from "./helpers";

// The tutor is the only external dependency; tests script its answers.
const tutor = vi.hoisted(() => ({
  draft: vi.fn<(lemma: string) => Promise<DraftedEntry>>(),
  evaluate: vi.fn<(input: { sentence: string }) => Promise<SentenceEvaluation>>(),
}));
vi.mock("@/server/services/tutor", async (original) => ({
  ...(await original<typeof import("@/server/services/tutor")>()),
  tutorAvailable: () => true,
  draftEntry: tutor.draft,
  evaluateSentence: tutor.evaluate,
}));

import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { GET as leaderboard } from "@/app/api/v1/leaderboard/route";
import { GET as me } from "@/app/api/v1/me/route";
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
  for (let slot = 1; slot <= 5; slot++) {
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
  tutor.draft.mockReset();
  tutor.evaluate.mockReset();
});

describe("accounts", () => {
  it("registers, signs in and signs out", async () => {
    const token = await signUp("ada");
    expect((await call(me, { token })).data.displayName).toBe("ada");

    const signedIn = await call(login, {
      body: { email: "ADA@example.com", password: "correct horse battery" },
    });
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get("set-cookie")).toContain("lexicon_session=");

    await call(logout, { token, method: "POST" });
    expect((await call(me, { token })).status).toBe(401);
  });

  it("rejects a wrong invite code, a wrong password and a third account", async () => {
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

    const third = await call(register, {
      body: {
        email: "third@example.com",
        displayName: "third",
        password: "correct horse battery",
        inviteCode: "test-invite",
      },
    });
    expect(third.status).toBe(403);
    expect(await db.user.count()).toBe(2);
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
    expect(created.data.sentences).toHaveLength(5);
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
    expect(forGrace.data.partnerStage).toBe("STUDYING");

    const notStarted = await call(listWords, { token: grace, query: "?stage=NOT_STARTED" });
    expect(notStarted.data.words).toHaveLength(1);

    const introduced = await call(introduce, {
      token: ada,
      method: "POST",
      params: { id: word.id },
    });
    expect(introduced.data.partnerStage).toBe("STUDYING");
    const after = await call(getWord, { token: grace, params: { id: word.id } });
    expect(after.data.myProgress.introducedBy.displayName).toBe("ada");

    const again = await call(introduce, { token: ada, method: "POST", params: { id: word.id } });
    expect(again.status).toBe(409);
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
    expect(done.data.progress.acceptedSentences).toBe(5);
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
      xpTotal: 45, // word added 5 + five sentences 20 + word studied 20
      xpThisWeek: 45,
      streakDays: 1,
      wordsStudied: 1,
      wordsMastered: 0,
    });
    expect(second).toMatchObject({ isMe: true, xpTotal: 0, streakDays: 0 });
  });
});
