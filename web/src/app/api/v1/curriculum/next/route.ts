import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { startNextCurriculumWord } from "@/server/services/words";

export const POST = handle(endpoints.startNextCurriculumWord, ({ user }) =>
  startNextCurriculumWord(user),
);
