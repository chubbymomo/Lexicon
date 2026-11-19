import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { startPlacement } from "@/server/services/placement";

export const POST = handle(endpoints.startPlacement, ({ user, params }) =>
  startPlacement(user, params.id),
);
