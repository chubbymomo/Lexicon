/**
 * Browser client for the Lexicon API. The web app uses exactly the endpoints
 * other clients do; types come straight from the server contract.
 */
import type { z } from "zod";
import type * as c from "@/server/contract";

export type Me = z.output<typeof c.Me>;
export type Meta = z.output<typeof c.Meta>;
export type WordSummary = z.output<typeof c.WordSummary>;
export type WordDetail = z.output<typeof c.WordDetail>;
export type Sentence = z.output<typeof c.Sentence>;
export type SentenceResult = z.output<typeof c.SentenceResult>;
export type ReviewCard = z.output<typeof c.ReviewCard>;
export type DueReviews = z.output<typeof c.DueReviews>;
export type ReviewResult = z.output<typeof c.ReviewResult>;
export type Leaderboard = z.output<typeof c.Leaderboard>;
export type LearningStage = z.output<typeof c.LearningStage>;
export type PublicUser = z.output<typeof c.PublicUser>;
export type CurriculumSummary = z.output<typeof c.CurriculumSummary>;
export type CurriculumDetail = z.output<typeof c.CurriculumDetail>;
export type CurriculumWord = z.output<typeof c.CurriculumWord>;
export type SourceKind = z.output<typeof c.SourceKind>;
export type Challenge = z.output<typeof c.Challenge>;
export type Achievement = z.output<typeof c.Achievement>;
export type Stats = z.output<typeof c.Stats>;

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      // The session travels in an HttpOnly cookie set at sign-in.
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, "network", "Could not reach the server. Check your connection.");
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiFailure(
      response.status,
      data?.error?.code ?? "internal",
      data?.error?.message ?? "Something went wrong",
    );
  }
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
const forUser = (userId?: string) => (userId ? `?userId=${encodeURIComponent(userId)}` : "");

export const api = {
  meta: () => get<Meta>("/meta"),
  me: () => get<Me>("/me"),
  login: (body: z.input<typeof c.LoginBody>) => post<{ user: Me }>("/auth/login", body),
  register: (body: z.input<typeof c.RegisterBody>) => post<{ user: Me }>("/auth/register", body),
  logout: () => post<void>("/auth/logout"),
  listWords: () => get<{ words: WordSummary[] }>("/words"),
  createWord: (body: z.input<typeof c.CreateWordBody>) => post<WordDetail>("/words", body),
  getWord: (id: string) => get<WordDetail>(`/words/${id}`),
  studyWord: (id: string) => post<WordDetail>(`/words/${id}/study`),
  introduceWord: (id: string, userId: string) =>
    post<WordDetail>(`/words/${id}/introduce`, { userId }),
  updateWord: (id: string, body: z.input<typeof c.UpdateWordBody>) =>
    request<WordDetail>("PATCH", `/words/${id}`, body),
  listUsers: () => get<{ users: PublicUser[] }>("/users"),
  curricula: () => get<{ curricula: CurriculumSummary[] }>("/curricula"),
  curriculum: (id: string) => get<CurriculumDetail>(`/curricula/${id}`),
  createCurriculum: (body: z.input<typeof c.CreateCurriculumBody>) =>
    post<CurriculumDetail>("/curricula", body),
  deleteCurriculum: (id: string) => request<void>("DELETE", `/curricula/${id}`),
  startNextWord: (id: string) => post<WordDetail>(`/curricula/${id}/next`),
  skipWord: (id: string, lemma: string) =>
    post<CurriculumDetail>(`/curricula/${id}/skip`, { lemma }),
  challenges: () => get<{ challenges: Challenge[] }>("/challenges"),
  achievements: (userId?: string) =>
    get<{ achievements: Achievement[] }>(`/achievements${forUser(userId)}`),
  stats: (userId?: string) => get<Stats>(`/stats${forUser(userId)}`),
  addEncounter: (id: string, body: z.input<typeof c.EncounterInput>) =>
    post<WordDetail>(`/words/${id}/encounters`, body),
  submitSentence: (id: string, body: z.input<typeof c.SubmitSentenceBody>) =>
    post<SentenceResult>(`/words/${id}/sentences`, body),
  dueReviews: () => get<DueReviews>("/reviews/due"),
  submitReview: (body: z.input<typeof c.SubmitReviewBody>) => post<ReviewResult>("/reviews", body),
  leaderboard: () => get<Leaderboard>("/leaderboard"),
};
