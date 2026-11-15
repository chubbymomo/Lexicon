import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { introduceWord } from "@/server/services/words";

export const POST = handle(endpoints.introduceWord, ({ user, params, body }) =>
  introduceWord(user, params.id, body.userId),
);
