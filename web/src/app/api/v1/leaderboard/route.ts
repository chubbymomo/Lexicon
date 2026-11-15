import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { leaderboard } from "@/server/services/progress";

export const GET = handle(endpoints.leaderboard, ({ user }) => leaderboard(user));
