import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { updateWord, wordDetail } from "@/server/services/words";

export const GET = handle(endpoints.getWord, ({ user, params }) => wordDetail(user, params.id));

export const PATCH = handle(endpoints.updateWord, ({ user, params, body }) =>
  updateWord(user, params.id, body),
);
