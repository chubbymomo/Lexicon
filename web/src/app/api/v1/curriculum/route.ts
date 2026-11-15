import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { curriculum } from "@/server/services/words";

export const GET = handle(endpoints.curriculum, ({ user }) => curriculum(user));
