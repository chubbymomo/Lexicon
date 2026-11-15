import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db";
import { conflict, forbidden, unauthorized } from "./errors";
import type { User } from "@/generated/prisma/client";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = "lexicon_session";
/** Optional cap on accounts (`LEXICON_MAX_USERS`); unlimited when unset. */
export function maxUsers(): number | null {
  const cap = Number(process.env.LEXICON_MAX_USERS);
  return Number.isInteger(cap) && cap > 0 ? cap : null;
}

export async function registrationOpen(): Promise<boolean> {
  const cap = maxUsers();
  return cap === null || (await db.user.count()) < cap;
}
const SESSION_DAYS = 180;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();
const hashToken = (token: string) => sha256(token).toString("hex");

async function createSession(userId: string, client: string): Promise<string> {
  const token = `lex_${randomBytes(32).toString("base64url")}`;
  await db.session.create({
    data: {
      userId,
      client,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
    },
  });
  return token;
}

export async function register(input: {
  email: string;
  displayName: string;
  password: string;
  inviteCode: string;
  client: string;
}): Promise<{ user: User; token: string }> {
  const expected = process.env.LEXICON_INVITE_CODE;
  if (!expected || !timingSafeEqual(sha256(input.inviteCode), sha256(expected))) {
    throw forbidden("That invite code is not right");
  }
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  const user = await db.$transaction(async (tx) => {
    // Serialize sign-ups so two concurrent requests cannot exceed the cap.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7310001)`;
    const cap = maxUsers();
    if (cap !== null && (await tx.user.count()) >= cap) {
      throw forbidden("Every account has already been created");
    }
    if (await tx.user.findUnique({ where: { email } })) {
      throw conflict("An account with that email already exists");
    }
    return tx.user.create({
      data: { email, displayName: input.displayName.trim(), passwordHash },
    });
  });
  return { user, token: await createSession(user.id, input.client) };
}

export async function login(input: {
  email: string;
  password: string;
  client: string;
}): Promise<{ user: User; token: string }> {
  const user = await db.user.findUnique({
    where: { email: input.email.trim().toLowerCase() },
  });
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw unauthorized("Email or password is incorrect");
  }
  return { user, token: await createSession(user.id, input.client) };
}

export async function logout(token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Read the token from `Authorization: Bearer` (mobile) or the session cookie (web). */
export function tokenFromRequest(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim() || null;
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("=")) || null;
  }
  return null;
}

export async function userFromRequest(request: Request): Promise<User> {
  const token = tokenFromRequest(request);
  if (!token) throw unauthorized();
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) throw unauthorized("Session expired");
  // Touch at most once an hour to avoid a write on every request.
  if (Date.now() - session.lastUsedAt.getTime() > 3_600_000) {
    await db.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  }
  return session.user;
}

export function sessionCookie(token: string | null): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const base = `${SESSION_COOKIE}=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; SameSite=Lax${secure}`;
  return token ? `${base}; Max-Age=${SESSION_DAYS * 86_400}` : `${base}; Max-Age=0`;
}
