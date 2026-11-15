import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { introduceWord } from "@/server/services/words";

export const POST = handle(endpoints.introduceWord, ({ user, params }) =>
  introduceWord(user, params.id),
);
