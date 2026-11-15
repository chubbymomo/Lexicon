import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { listUsers } from "@/server/services/words";

export const GET = handle(endpoints.listUsers, () => listUsers());
