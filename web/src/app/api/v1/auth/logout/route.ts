import { logout, sessionCookie, tokenFromRequest } from "@/server/auth";
import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";

export const POST = handle(endpoints.logout, async ({ request, setCookie }) => {
  const token = tokenFromRequest(request);
  if (token) await logout(token);
  setCookie(sessionCookie(null, request));
});
