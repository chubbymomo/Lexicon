import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { submitSentence } from "@/server/services/study";

export const POST = handle(endpoints.submitSentence, ({ user, params, body }) =>
  submitSentence(user, params.id, body),
);
