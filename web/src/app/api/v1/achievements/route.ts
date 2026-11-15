import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { achievements } from "@/server/services/competition";

export const GET = handle(endpoints.achievements, ({ user, query }) =>
  achievements(query.userId ?? user.id),
);
