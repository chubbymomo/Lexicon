import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { curriculumDetail, deleteCurriculum } from "@/server/services/curricula";

export const GET = handle(endpoints.getCurriculum, ({ user, params }) =>
  curriculumDetail(user, params.id),
);

export const DELETE = handle(endpoints.deleteCurriculum, ({ user, params }) =>
  deleteCurriculum(user, params.id),
);
