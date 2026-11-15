import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { stats } from "@/server/services/competition";

export const GET = handle(endpoints.stats, ({ user, query }) => stats(query.userId ?? user.id));
