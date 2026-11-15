import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { challenges } from "@/server/services/competition";

export const GET = handle(endpoints.challenges, ({ user }) => challenges(user));
