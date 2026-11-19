import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { skipNext } from "@/server/services/curricula";

export const POST = handle(endpoints.skipCurriculumWord, ({ user, params, body }) =>
  skipNext(user, params.id, body.lemma),
);
