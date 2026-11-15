import { MAX_USERS } from "@/server/auth";
import { endpoints } from "@/server/contract";
import { db } from "@/server/db";
import { handle } from "@/server/http";
import { tutorAvailable } from "@/server/services/tutor";

export const GET = handle(endpoints.meta, async () => ({
  registrationOpen: (await db.user.count()) < MAX_USERS,
  tutorAvailable: tutorAvailable(),
}));
