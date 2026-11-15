import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { addEncounter } from "@/server/services/words";

export const POST = handle(endpoints.addEncounter, ({ user, params, body }) =>
  addEncounter(user, params.id, body),
);
