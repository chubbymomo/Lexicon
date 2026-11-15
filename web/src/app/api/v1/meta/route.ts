import { registrationOpen } from "@/server/auth";
import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";
import { tutorAvailable } from "@/server/services/tutor";

export const GET = handle(endpoints.meta, async () => ({
  registrationOpen: await registrationOpen(),
  tutorAvailable: tutorAvailable(),
}));
