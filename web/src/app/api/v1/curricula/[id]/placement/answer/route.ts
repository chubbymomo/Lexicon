import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { answerPlacement } from "@/server/services/placement";

export const POST = handle(endpoints.answerPlacement, ({ user, params, body }) =>
  answerPlacement(user, params.id, body.questionId, body.choice),
);
