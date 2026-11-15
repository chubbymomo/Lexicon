import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { studyWord } from "@/server/services/words";

export const POST = handle(endpoints.studyWord, ({ user, params }) => studyWord(user, params.id));
