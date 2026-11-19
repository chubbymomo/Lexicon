import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { startNext } from "@/server/services/curricula";

export const POST = handle(endpoints.startNextCurriculumWord, ({ user, params }) =>
  startNext(user, params.id),
);
