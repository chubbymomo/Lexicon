import { login, sessionCookie } from "@/server/auth";
import { endpoints } from "@/server/contract";
import { handle } from "@/server/http";

export const POST = handle(endpoints.login, async ({ body, setCookie }) => {
  const { user, token } = await login(body);
  setCookie(sessionCookie(token));
  return { token, user };
});
