import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { createWord, listWords } from "@/server/services/words";

export const GET = handle(endpoints.listWords, ({ user, query }) => listWords(user, query));

export const POST = handle(endpoints.createWord, ({ user, body }) => createWord(user, body));
