import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { dueReviews } from "@/server/services/study";

export const GET = handle(endpoints.dueReviews, ({ user, query }) =>
  dueReviews(user, query.limit),
);
