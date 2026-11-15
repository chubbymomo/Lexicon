/**
 * The Lexicon HTTP API contract.
 *
 * Every endpoint is declared once here with its request and response schemas.
 * Route handlers validate against these, and `openapi.ts` turns them into the
 * OpenAPI document that other clients (the Android app) are built against.
 */
import { z } from "zod";

const isoDate = z.string().meta({ format: "date-time", description: "ISO 8601 timestamp (UTC)" });

// --- Shared enums -----------------------------------------------------------

export const LearningStage = z.enum(["STUDYING", "REVIEWING", "MASTERED"]).meta({
  id: "LearningStage",
  description:
    "STUDYING: writing the five sentences. REVIEWING: in spaced repetition. MASTERED: long, stable interval reached.",
});
export const MorphemeKind = z.enum(["PREFIX", "ROOT", "SUFFIX"]).meta({ id: "MorphemeKind" });
export const ReviewKind = z
  .enum(["DEFINITION_RECALL", "WORD_FROM_CONTEXT", "SENTENCE"])
  .meta({ id: "ReviewKind" });
export const SentenceVerdict = z
  .enum(["ACCEPTED", "NEEDS_REVISION"])
  .meta({ id: "SentenceVerdict" });
export const SourceKind = z.enum(["book", "article", "other"]).meta({ id: "SourceKind" });

// --- People -----------------------------------------------------------------

export const PublicUser = z
  .object({ id: z.string(), displayName: z.string() })
  .meta({ id: "PublicUser" });

export const Me = z
  .object({ id: z.string(), displayName: z.string(), email: z.string() })
  .meta({ id: "Me" });

export const AuthResponse = z
  .object({
    token: z.string().meta({
      description: "Send as `Authorization: Bearer <token>` on every later request.",
    }),
    user: Me,
  })
  .meta({ id: "AuthResponse" });

const password = z.string().min(10).max(200);
const clientLabel = z.string().min(1).max(40).default("web").meta({
  description: 'Label for this device\'s session, e.g. "android".',
});

export const RegisterBody = z
  .object({
    email: z.email().max(200),
    displayName: z.string().trim().min(1).max(60),
    password,
    inviteCode: z.string().min(1).max(200),
    client: clientLabel,
  })
  .meta({ id: "RegisterBody" });

export const LoginBody = z
  .object({ email: z.string().max(200), password: z.string().max(200), client: clientLabel })
  .meta({ id: "LoginBody" });

export const Meta = z
  .object({
    registrationOpen: z.boolean().meta({
      description: "False once the server's optional account cap has been reached.",
    }),
    tutorAvailable: z.boolean().meta({
      description: "Whether AI drafting of word entries and sentence evaluation are configured.",
    }),
  })
  .meta({ id: "Meta" });

// --- Words ------------------------------------------------------------------

export const Progress = z
  .object({
    userWordId: z.string(),
    stage: LearningStage,
    acceptedSentences: z.number().int().min(0).max(5),
    due: isoDate.nullable().meta({ description: "Next review time; null until studied." }),
    reps: z.number().int(),
    lapses: z.number().int(),
    stabilityDays: z.number().meta({ description: "FSRS memory stability, in days." }),
    introducedBy: PublicUser.nullable(),
    studiedAt: isoDate.nullable(),
    masteredAt: isoDate.nullable(),
  })
  .meta({ id: "Progress" });

export const WordSummary = z
  .object({
    id: z.string(),
    lemma: z.string(),
    partOfSpeech: z.string().nullable(),
    definition: z.string(),
    difficulty: z.number().int().min(1).max(5),
    addedBy: PublicUser.nullable().meta({
      description: "Who added the word; null for words that ship with the curriculum.",
    }),
    curriculumPosition: z.number().int().nullable().meta({
      description: "Place in the shared curriculum (1-based); null for words a player added.",
    }),
    createdAt: isoDate,
    myProgress: Progress.nullable().meta({ description: "Null if you have not started this word." }),
    others: z
      .array(z.object({ user: PublicUser, stage: LearningStage }))
      .meta({ description: "The other players who have this word, and how far along they are." }),
  })
  .meta({ id: "WordSummary" });

export const Morpheme = z
  .object({
    id: z.string(),
    kind: MorphemeKind,
    form: z.string(),
    meaning: z.string(),
    origin: z.string().nullable(),
    relatedWords: z
      .array(z.object({ id: z.string(), lemma: z.string() }))
      .meta({ description: "Other words in the collection built from this morpheme." }),
  })
  .meta({ id: "Morpheme" });

export const Encounter = z
  .object({
    id: z.string(),
    user: PublicUser,
    sourceTitle: z.string(),
    sourceAuthor: z.string().nullable(),
    sourceKind: SourceKind,
    passage: z.string().nullable(),
    note: z.string().nullable(),
    createdAt: isoDate,
  })
  .meta({ id: "Encounter" });

export const Sentence = z
  .object({
    id: z.string(),
    slot: z.number().int().min(1).max(5),
    text: z.string(),
    verdict: SentenceVerdict,
    grammarOk: z.boolean(),
    usageOk: z.boolean(),
    contextOk: z.boolean(),
    feedback: z.string(),
    suggestion: z.string().nullable(),
    createdAt: isoDate,
  })
  .meta({ id: "Sentence" });

export const SentenceSlot = z
  .object({
    slot: z.number().int().min(1).max(5),
    latest: Sentence.nullable(),
    attempts: z.number().int(),
  })
  .meta({ id: "SentenceSlot" });

export const WordDetail = WordSummary.extend({
  pronunciation: z.string().nullable(),
  etymology: z.string().nullable(),
  relatedForms: z.array(z.string()),
  synonyms: z.array(z.string()),
  antonyms: z.array(z.string()),
  examples: z.array(z.string()),
  morphemes: z.array(Morpheme),
  encounters: z.array(Encounter),
  sentences: z.array(SentenceSlot).meta({
    description: "Your five sentence slots, in order. Empty if you have not started the word.",
  }),
}).meta({ id: "WordDetail" });

const shortList = z.array(z.string().trim().min(1).max(300)).max(12);

export const EncounterInput = z
  .object({
    sourceTitle: z.string().trim().min(1).max(200),
    sourceAuthor: z.string().trim().max(200).optional(),
    sourceKind: SourceKind.default("book"),
    passage: z.string().trim().max(2000).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .meta({ id: "EncounterInput" });

export const MorphemeInput = z
  .object({
    kind: MorphemeKind,
    form: z.string().trim().min(1).max(40),
    meaning: z.string().trim().min(1).max(200),
    origin: z.string().trim().max(60).optional(),
  })
  .meta({ id: "MorphemeInput" });

const wordFields = {
  pronunciation: z.string().trim().max(100).optional(),
  partOfSpeech: z.string().trim().max(40).optional(),
  etymology: z.string().trim().max(2000).optional(),
  relatedForms: shortList.optional(),
  synonyms: shortList.optional(),
  antonyms: shortList.optional(),
  examples: shortList.optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  morphemes: z.array(MorphemeInput).max(8).optional(),
};

export const CreateWordBody = z
  .object({
    lemma: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[\p{L}][\p{L}' -]*$/u, "Use letters, spaces, hyphens and apostrophes only"),
    definition: z.string().trim().min(1).max(1000).optional().meta({
      description:
        "Omit to have the AI tutor draft the whole entry. If given, the entry is saved exactly as sent.",
    }),
    ...wordFields,
    encounter: EncounterInput.optional(),
    study: z.boolean().default(true).meta({ description: "Also add the word to your study list." }),
  })
  .meta({ id: "CreateWordBody" });

export const UpdateWordBody = z
  .object({ definition: z.string().trim().min(1).max(1000).optional(), ...wordFields })
  .meta({ id: "UpdateWordBody" });

export const ListWordsQuery = z.object({
  q: z.string().trim().max(60).optional().meta({ description: "Filter by lemma prefix." }),
  stage: z
    .enum(["STUDYING", "REVIEWING", "MASTERED", "NOT_STARTED"])
    .optional()
    .meta({ description: "Filter by your own stage." }),
});

export const WordList = z.object({ words: z.array(WordSummary) }).meta({ id: "WordList" });

export const IntroduceBody = z
  .object({ userId: z.string().meta({ description: "The player to introduce the word to." }) })
  .meta({ id: "IntroduceBody" });

export const UserList = z.object({ users: z.array(PublicUser) }).meta({ id: "UserList" });

// --- Curriculum -------------------------------------------------------------

export const Curriculum = z
  .object({
    total: z.number().int().meta({ description: "Number of words in the curriculum." }),
    started: z.number().int().meta({ description: "Curriculum words on your list." }),
    studied: z.number().int().meta({ description: "Curriculum words whose study you finished." }),
    inProgress: z.array(WordSummary).meta({
      description: "Curriculum words you have started but not finished studying.",
    }),
    next: WordSummary.nullable().meta({
      description: "The next word in order that you have not started; null at the end.",
    }),
    canStartNext: z.boolean().meta({
      description:
        "False while too many curriculum words are unfinished; finish their five sentences first.",
    }),
    maxInProgress: z.number().int(),
    players: z
      .array(z.object({ user: PublicUser, isMe: z.boolean(), studied: z.number().int() }))
      .meta({ description: "How far every player has come through the same list." }),
  })
  .meta({ id: "Curriculum" });

export const SubmitSentenceBody = z
  .object({
    slot: z.number().int().min(1).max(5),
    text: z.string().trim().min(3).max(600),
  })
  .meta({ id: "SubmitSentenceBody" });

export const SentenceResult = z
  .object({
    sentence: Sentence,
    progress: Progress,
    xpAwarded: z.number().int(),
  })
  .meta({ id: "SentenceResult" });

// --- Reviews ----------------------------------------------------------------

export const ReviewCard = z
  .object({
    userWordId: z.string(),
    wordId: z.string(),
    kind: ReviewKind,
    prompt: z.string().meta({
      description:
        "DEFINITION_RECALL: the word. WORD_FROM_CONTEXT: a sentence with the word blanked out. SENTENCE: an instruction.",
    }),
    due: isoDate,
    answer: z
      .object({
        lemma: z.string(),
        pronunciation: z.string().nullable(),
        partOfSpeech: z.string().nullable(),
        definition: z.string(),
        example: z.string().nullable(),
      })
      .meta({ description: "Reveal after the user has tried to recall." }),
  })
  .meta({ id: "ReviewCard" });

export const DueReviews = z
  .object({ dueCount: z.number().int(), cards: z.array(ReviewCard) })
  .meta({ id: "DueReviews" });

export const DueReviewsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const SubmitReviewBody = z
  .object({
    userWordId: z.string(),
    kind: ReviewKind,
    rating: z.number().int().min(1).max(4).optional().meta({
      description:
        "Self-rating: 1 Again, 2 Hard, 3 Good, 4 Easy. Required unless kind is SENTENCE.",
    }),
    sentence: z.string().trim().min(3).max(600).optional().meta({
      description: "Required when kind is SENTENCE; the tutor's verdict sets the rating.",
    }),
  })
  .meta({ id: "SubmitReviewBody" });

export const ReviewResult = z
  .object({
    rating: z.number().int().min(1).max(4),
    progress: Progress,
    xpAwarded: z.number().int(),
    evaluation: Sentence.omit({ id: true, slot: true, createdAt: true }).nullable(),
  })
  .meta({ id: "ReviewResult" });

// --- Competition ------------------------------------------------------------

export const LeaderboardEntry = z
  .object({
    user: PublicUser,
    isMe: z.boolean(),
    xpTotal: z.number().int(),
    xpThisWeek: z.number().int(),
    streakDays: z.number().int().meta({
      description: "Consecutive days with earned XP, counting today or yesterday as the latest.",
    }),
    wordsStudied: z.number().int(),
    wordsMastered: z.number().int(),
    reviewsCorrect: z.number().int(),
    reviewsDue: z.number().int(),
  })
  .meta({ id: "LeaderboardEntry" });

export const Leaderboard = z
  .object({ weekStartsAt: isoDate, entries: z.array(LeaderboardEntry) })
  .meta({ id: "Leaderboard" });

export const Challenge = z
  .object({
    id: z.string().meta({ description: "Stable identifier of the challenge type." }),
    period: z.enum(["DAILY", "WEEKLY"]),
    scope: z.enum(["PERSONAL", "SHARED"]).meta({
      description: "SHARED challenges count every player's work towards one target.",
    }),
    title: z.string(),
    description: z.string(),
    target: z.number().int(),
    progress: z.number().int().meta({ description: "Capped at `target`." }),
    completed: z.boolean(),
    xp: z.number().int().meta({ description: "XP awarded on completion." }),
    endsAt: isoDate,
  })
  .meta({ id: "Challenge" });

export const ChallengeList = z
  .object({ challenges: z.array(Challenge) })
  .meta({ id: "ChallengeList" });

export const Achievement = z
  .object({
    code: z.string(),
    title: z.string(),
    description: z.string(),
    target: z.number().int(),
    progress: z.number().int().meta({ description: "Capped at `target`." }),
    unlockedAt: isoDate.nullable(),
  })
  .meta({ id: "Achievement" });

export const AchievementList = z
  .object({ achievements: z.array(Achievement) })
  .meta({ id: "AchievementList" });

export const StatsQuery = z.object({
  userId: z.string().optional().meta({ description: "Another player's id; defaults to you." }),
});

export const Stats = z
  .object({
    user: PublicUser,
    stages: z.object({
      studying: z.number().int(),
      reviewing: z.number().int(),
      mastered: z.number().int(),
    }),
    recallRate: z.number().nullable().meta({
      description:
        "Share of reviews in the last 30 days that were recalled (rated Hard or better), 0 to 1. Null with no reviews.",
    }),
    weeks: z
      .array(
        z.object({
          weekStart: z.string().meta({ description: "Monday of the week, YYYY-MM-DD." }),
          studied: z.number().int().meta({ description: "Words studied by the end of the week (cumulative)." }),
          mastered: z.number().int().meta({ description: "Words mastered by the end of the week (cumulative)." }),
        }),
      )
      .meta({ description: "The last 12 weeks, oldest first." }),
    days: z
      .array(
        z.object({
          day: z.string().meta({ description: "YYYY-MM-DD." }),
          reviews: z.number().int(),
          recalled: z.number().int(),
          xp: z.number().int(),
        }),
      )
      .meta({ description: "The last 30 days, oldest first." }),
    forecast: z
      .array(z.object({ day: z.string(), due: z.number().int() }))
      .meta({ description: "Reviews coming due over the next 14 days; overdue cards count today." }),
  })
  .meta({ id: "Stats" });

// --- Errors -----------------------------------------------------------------

export const ErrorBody = z
  .object({
    error: z.object({
      code: z.string().meta({
        description:
          "bad_request, unauthorized, forbidden, not_found, conflict, tutor_unavailable or internal.",
      }),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: "ErrorBody" });

// --- Endpoint registry ------------------------------------------------------

export type Endpoint = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path below /api/v1, with `{param}` placeholders. */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  /** False for the few endpoints usable without a token. */
  auth: boolean;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** Omitted when the endpoint answers 204 No Content. */
  response?: z.ZodType;
};

const endpoint = <const E extends Endpoint>(e: E) => e;

export const endpoints = {
  meta: endpoint({
    method: "GET",
    path: "/meta",
    tag: "Meta",
    summary: "Server capabilities",
    auth: false,
    response: Meta,
  }),
  register: endpoint({
    method: "POST",
    path: "/auth/register",
    tag: "Auth",
    summary: "Create an account",
    description: "Requires the shared invite code. 403 once the server's account cap is reached.",
    auth: false,
    body: RegisterBody,
    response: AuthResponse,
  }),
  login: endpoint({
    method: "POST",
    path: "/auth/login",
    tag: "Auth",
    summary: "Sign in",
    auth: false,
    body: LoginBody,
    response: AuthResponse,
  }),
  logout: endpoint({
    method: "POST",
    path: "/auth/logout",
    tag: "Auth",
    summary: "Revoke the current token",
    auth: true,
  }),
  me: endpoint({
    method: "GET",
    path: "/me",
    tag: "Auth",
    summary: "The signed-in user",
    auth: true,
    response: Me,
  }),
  listUsers: endpoint({
    method: "GET",
    path: "/users",
    tag: "Auth",
    summary: "Every player",
    auth: true,
    response: UserList,
  }),
  listWords: endpoint({
    method: "GET",
    path: "/words",
    tag: "Words",
    summary: "The shared vocabulary collection",
    auth: true,
    query: ListWordsQuery,
    response: WordList,
  }),
  createWord: endpoint({
    method: "POST",
    path: "/words",
    tag: "Words",
    summary: "Add a word to the shared collection",
    description:
      "Send only `lemma` to have the AI tutor draft the entry (503 `tutor_unavailable` if not configured), or include `definition` and any other fields to save your own. 409 if the word already exists.",
    auth: true,
    body: CreateWordBody,
    response: WordDetail,
  }),
  getWord: endpoint({
    method: "GET",
    path: "/words/{id}",
    tag: "Words",
    summary: "A word's study page",
    auth: true,
    response: WordDetail,
  }),
  updateWord: endpoint({
    method: "PATCH",
    path: "/words/{id}",
    tag: "Words",
    summary: "Correct a word's entry",
    description: "Sent list fields replace the stored lists.",
    auth: true,
    body: UpdateWordBody,
    response: WordDetail,
  }),
  addEncounter: endpoint({
    method: "POST",
    path: "/words/{id}/encounters",
    tag: "Words",
    summary: "Record where you met this word while reading",
    auth: true,
    body: EncounterInput,
    response: WordDetail,
  }),
  studyWord: endpoint({
    method: "POST",
    path: "/words/{id}/study",
    tag: "Study",
    summary: "Add a word to your own study list",
    description: "Idempotent.",
    auth: true,
    response: WordDetail,
  }),
  introduceWord: endpoint({
    method: "POST",
    path: "/words/{id}/introduce",
    tag: "Study",
    summary: "Introduce a word to another player",
    description: "Adds it to their study list, credited to you. 409 if they already have it.",
    auth: true,
    body: IntroduceBody,
    response: WordDetail,
  }),
  submitSentence: endpoint({
    method: "POST",
    path: "/words/{id}/sentences",
    tag: "Study",
    summary: "Submit one of your five sentences for evaluation",
    description:
      "The tutor evaluates grammar, usage and context. Resubmit the same slot to revise. When all five slots are accepted the word moves to REVIEWING and its first review is scheduled.",
    auth: true,
    body: SubmitSentenceBody,
    response: SentenceResult,
  }),
  dueReviews: endpoint({
    method: "GET",
    path: "/reviews/due",
    tag: "Reviews",
    summary: "Reviews due now",
    auth: true,
    query: DueReviewsQuery,
    response: DueReviews,
  }),
  submitReview: endpoint({
    method: "POST",
    path: "/reviews",
    tag: "Reviews",
    summary: "Record the outcome of a review",
    description:
      "Schedules the next review with FSRS. 409 if the card is not due yet, so reviewing early earns nothing.",
    auth: true,
    body: SubmitReviewBody,
    response: ReviewResult,
  }),
  curriculum: endpoint({
    method: "GET",
    path: "/curriculum",
    tag: "Curriculum",
    summary: "Your place in the shared curriculum",
    description:
      "The curriculum is a fixed, ordered list of words that every player works through in the same order.",
    auth: true,
    response: Curriculum,
  }),
  startNextCurriculumWord: endpoint({
    method: "POST",
    path: "/curriculum/next",
    tag: "Curriculum",
    summary: "Begin the next curriculum word",
    description:
      "Adds the next word in order to your study list. 409 if `canStartNext` is false or the curriculum is finished.",
    auth: true,
    response: WordDetail,
  }),
  challenges: endpoint({
    method: "GET",
    path: "/challenges",
    tag: "Competition",
    summary: "Today's and this week's challenges",
    auth: true,
    response: ChallengeList,
  }),
  achievements: endpoint({
    method: "GET",
    path: "/achievements",
    tag: "Competition",
    summary: "Milestones reached and still ahead",
    auth: true,
    query: StatsQuery,
    response: AchievementList,
  }),
  stats: endpoint({
    method: "GET",
    path: "/stats",
    tag: "Competition",
    summary: "Progress over time",
    auth: true,
    query: StatsQuery,
    response: Stats,
  }),
  leaderboard: endpoint({
    method: "GET",
    path: "/leaderboard",
    tag: "Competition",
    summary: "Every player's standing",
    auth: true,
    response: Leaderboard,
  }),
} as const;
