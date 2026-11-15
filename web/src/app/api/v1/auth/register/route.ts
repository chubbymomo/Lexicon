import { register, sessionCookie } from "@/server/auth";
import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";

export const POST = handle(endpoints.register, async ({ body, setCookie }) => {
  const { user, token } = await register(body);
  setCookie(sessionCookie(token));
  return { token, user };
});
