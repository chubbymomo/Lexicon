import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { createCurriculum, listCurricula } from "@/server/services/curricula";

export const GET = handle(endpoints.listCurricula, ({ user }) => listCurricula(user));

export const POST = handle(endpoints.createCurriculum, ({ user, body }) =>
  createCurriculum(user, body),
);
