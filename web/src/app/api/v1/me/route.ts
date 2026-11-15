import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";

export const GET = handle(endpoints.me, async ({ user }) => user);
