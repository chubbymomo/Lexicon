import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { submitReview } from "@/server/services/study";

export const POST = handle(endpoints.submitReview, ({ user, body }) => submitReview(user, body));
