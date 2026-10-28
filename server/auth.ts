import { TRPCError } from "@trpc/server";
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import nodemailer from "nodemailer";
import { z } from "zod";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { authSessions, emailAccounts, profiles, users, walletAccounts, walletTransactions } from "../drizzle/schema";
import { normalizeEmail, STARTER_CREDITS } from "../shared/pace";
import * as dbHelpers from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { PACE_SESSION_COOKIE } from "./_core/context";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const VERIFY_MS = 24 * 60 * 60 * 1000;
const RESET_MS = 30 * 60 * 1000;
const AUTH_RATE_LIMIT = 12;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function keyFor(email: string): string {
  return `email:${digest(email).slice(0, 58)}`;
}
function requireDatabase() {
  return dbHelpers.getDb().then(database => {
    if (!database) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Account service is temporarily unavailable." });
    return database;
  });
}
function rateLimit(ctx: { req: { ip?: string } }, bucket: string) {
  if (rateBuckets.size > 5000) {
    const now = Date.now();
    for (const [entry, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(entry);
  }
  const key = `${bucket}:${ctx.req.ip ?? "unknown"}`;
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  current.count += 1;
  if (current.count > AUTH_RATE_LIMIT) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Wait a minute and try again." });
}
function safeOrigin(ctx: { req: { get(name: string): string | undefined } }) {
  const origin = ctx.req.get("origin") ?? ctx.req.get("referer");
  const forwardedHost = ctx.req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const trustedHost = forwardedHost ?? ctx.req.get("host");
  const forwardedProtocol = ctx.req.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (!origin || !trustedHost) throw new TRPCError({ code: "BAD_REQUEST", message: "The browser origin could not be verified." });
  try {
    const parsed = new URL(origin);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error("invalid");
    if (parsed.host.toLowerCase() !== trustedHost.toLowerCase()) throw new Error("untrusted host");
    if (forwardedProtocol && parsed.protocol !== `${forwardedProtocol}:`) throw new Error("untrusted protocol");
    return parsed.origin;
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The browser origin could not be verified." });
  }
}
function adminEmails(): Set<string> {
  return new Set(ENV.paceAdminEmails.split(",").map(normalizeEmail).filter(Boolean));
}
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
async function verifyPassword(password: string, stored: string) {
  try {
    const [scheme, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
function setSessionCookie(ctx: { req: any; res: any }, token: string) {
  ctx.res.cookie(PACE_SESSION_COOKIE, token, { ...getSessionCookieOptions(ctx.req), maxAge: SESSION_MS });
}
async function createSession(ctx: { req: any; res: any }, userId: number) {
  const database = await requireDatabase();
  const token = randomBytes(32).toString("base64url");
  await database.insert(authSessions).values({
    userId,
    tokenHash: digest(token),
    expiresAt: new Date(Date.now() + SESSION_MS),
    lastUsedAt: new Date(),
  });
  setSessionCookie(ctx, token);
}
async function mailer() {
  if (!ENV.paceSmtpUrl) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Account email is not configured yet. Set the server SMTP connection before registration." });
  const transport = nodemailer.createTransport(ENV.paceSmtpUrl);
  let from = ENV.paceSmtpFrom.trim();
  if (!from) {
    try {
      const parsed = new URL(ENV.paceSmtpUrl);
      const username = decodeURIComponent(parsed.username);
      if (username.includes("@")) from = `Pace Arena <${username}>`;
    } catch { /* provider URL may use non-URL syntax; require the explicit sender below */ }
  }
  if (!from) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Set PACE_SMTP_FROM to an address verified with the SMTP provider." });
  return { transport, from };
}
async function sendLink(email: string, link: string, kind: "verify" | "reset") {
  const { transport, from } = await mailer();
  const subject = kind === "verify" ? "Verify your Pace Arena account" : "Reset your Pace Arena password";
  const action = kind === "verify" ? "Verify your email address" : "Choose a new password";
  const expiry = kind === "verify" ? "24 hours" : "30 minutes";
  await transport.sendMail({
    from,
    to: email,
    subject,
    text: `${action}: ${link}\n\nThis link expires in ${expiry}. If you did not request this, ignore this message. Demo credits have no monetary value.`,
    html: `<p>${action}:</p><p><a href="${link}">${action}</a></p><p>This link expires in ${expiry}. If you did not request this, ignore this message. Demo credits have no monetary value.</p>`,
  });
}
async function safeSendLink(email: string, link: string, kind: "verify" | "reset") {
  try {
    await sendLink(email, link, kind);
  } catch (error) {
    console.error("[Pace Arena mail] Delivery failed:", error instanceof Error ? error.message : "unknown error");
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "We could not deliver account email. Check mail configuration or try again later." });
  }
}
async function grantStarterCredits(tx: any, userId: number) {
  const existing = await tx.select({ userId: walletAccounts.userId }).from(walletAccounts).where(eq(walletAccounts.userId, userId)).for("update").limit(1);
  if (existing.length) return;
  await tx.insert(walletAccounts).values({ userId, availableCredits: STARTER_CREDITS, reservedCredits: 0 });
  await tx.insert(walletTransactions).values({
    userId,
    transactionType: "initial_grant",
    amount: STARTER_CREDITS,
    availableBefore: 0,
    availableAfter: STARTER_CREDITS,
    reservedBefore: 0,
    reservedAfter: 0,
    status: "completed",
    idempotencyKey: `starter:${userId}`,
    reason: "One-time initial demo-credit grant after email verification.",
  });
}
const emailSchema = z.string().trim().email().max(320).transform(normalizeEmail);
const passwordSchema = z.string().min(10, "Use at least 10 characters.").max(128, "Password is too long.");
const usernameSchema = z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers, or underscores.").transform(value => value.toLowerCase());

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),
  register: publicProcedure.input(z.object({ email: emailSchema, password: passwordSchema, username: usernameSchema })).mutation(async ({ ctx, input }) => {
    rateLimit(ctx, "register");
    const origin = safeOrigin(ctx);
    const database = await requireDatabase();
    const email = input.email;
    const token = randomBytes(32).toString("base64url");
    const openId = keyFor(email);
    const isAdmin = adminEmails().has(email);
    try {
      await database.transaction(async tx => {
        const userInsert = await tx.insert(users).values({
          openId,
          name: input.username,
          email,
          loginMethod: "email_password",
          ...(isAdmin ? { role: "admin" as const } : {}),
        });
        const userId = Number((userInsert as unknown as [{ insertId: number }])[0]?.insertId);
        if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Could not create account identity");
        await tx.insert(emailAccounts).values({
          userId,
          emailNormalized: email,
          passwordHash: await hashPassword(input.password),
          verifyTokenHash: digest(token),
          verifyExpiresAt: new Date(Date.now() + VERIFY_MS),
        });
        await tx.insert(profiles).values({ userId, username: input.username, country: "KE", availability: "away", eligibility: "eligible" });
      });
    } catch (error) {
      if (String(error).includes("Duplicate entry") || String(error).includes("ER_DUP_ENTRY")) {
        throw new TRPCError({ code: "CONFLICT", message: "That email or username is already in use." });
      }
      throw error;
    }
    const verificationUrl = new URL("/verify-email", origin);
    verificationUrl.searchParams.set("token", token);
    await safeSendLink(email, verificationUrl.toString(), "verify");
    return { message: "Check your inbox to verify your email. Your demo balance is a one-time 1,000-credit grant." };
  }),
  login: publicProcedure.input(z.object({ email: emailSchema, password: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => {
    rateLimit(ctx, "login");
    const database = await requireDatabase();
    const account = await dbHelpers.getEmailAccount(input.email);
    if (!account) throw new TRPCError({ code: "UNAUTHORIZED", message: "Email or password is incorrect." });
    if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many failed attempts. Try again later." });
    if (!(await verifyPassword(input.password, account.passwordHash))) {
      const failures = account.failedLoginCount + 1;
      await database.update(emailAccounts).set({ failedLoginCount: failures, lockedUntil: failures >= 10 ? new Date(Date.now() + 15 * 60_000) : null }).where(eq(emailAccounts.userId, account.userId));
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Email or password is incorrect." });
    }
    if (!account.emailVerifiedAt) {
      const token = randomBytes(32).toString("base64url");
      await database.update(emailAccounts).set({ verifyTokenHash: digest(token), verifyExpiresAt: new Date(Date.now() + VERIFY_MS) }).where(eq(emailAccounts.userId, account.userId));
      const user = await dbHelpers.getUserById(account.userId);
      if (user) {
        const origin = safeOrigin(ctx);
        const link = new URL("/verify-email", origin);
        link.searchParams.set("token", token);
        await safeSendLink(input.email, link.toString(), "verify");
      }
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Verify your email first. We sent a fresh verification link." });
    }
    await database.update(emailAccounts).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(emailAccounts.userId, account.userId));
    if (adminEmails().has(input.email)) await database.update(users).set({ role: "admin" }).where(eq(users.id, account.userId));
    await createSession(ctx, account.userId);
    const user = await dbHelpers.getUserById(account.userId);
    return user;
  }),
  verifyEmail: publicProcedure.input(z.object({ token: z.string().min(40).max(100) })).mutation(async ({ ctx, input }) => {
    rateLimit(ctx, "verify");
    const database = await requireDatabase();
    const userId = await database.transaction(async tx => {
      const rows = await tx.select().from(emailAccounts).where(and(eq(emailAccounts.verifyTokenHash, digest(input.token)), gt(emailAccounts.verifyExpiresAt, new Date()))).for("update").limit(1);
      const account = rows[0];
      if (!account) throw new TRPCError({ code: "BAD_REQUEST", message: "This verification link is invalid or expired. Request a fresh link by signing in." });
      await tx.update(emailAccounts).set({ emailVerifiedAt: new Date(), verifyTokenHash: null, verifyExpiresAt: null }).where(eq(emailAccounts.userId, account.userId));
      await grantStarterCredits(tx, account.userId);
      return account.userId;
    });
    await createSession(ctx, userId);
    return { success: true };
  }),
  forgotPassword: publicProcedure.input(z.object({ email: emailSchema })).mutation(async ({ ctx, input }) => {
    rateLimit(ctx, "forgot");
    const origin = safeOrigin(ctx);
    const account = await dbHelpers.getEmailAccount(input.email);
    if (account?.emailVerifiedAt) {
      const token = randomBytes(32).toString("base64url");
      const database = await requireDatabase();
      await database.update(emailAccounts).set({ resetTokenHash: digest(token), resetExpiresAt: new Date(Date.now() + RESET_MS) }).where(eq(emailAccounts.userId, account.userId));
      const url = new URL("/reset-password", origin);
      url.searchParams.set("token", token);
      await safeSendLink(input.email, url.toString(), "reset");
    }
    return { message: "If an eligible account exists, password-reset instructions have been sent." };
  }),
  resetPassword: publicProcedure.input(z.object({ token: z.string().min(40).max(100), password: passwordSchema })).mutation(async ({ ctx, input }) => {
    rateLimit(ctx, "reset");
    const database = await requireDatabase();
    await database.transaction(async tx => {
      const rows = await tx.select().from(emailAccounts).where(and(eq(emailAccounts.resetTokenHash, digest(input.token)), gt(emailAccounts.resetExpiresAt, new Date()))).for("update").limit(1);
      const account = rows[0];
      if (!account) throw new TRPCError({ code: "BAD_REQUEST", message: "This reset link is invalid or expired." });
      await tx.update(emailAccounts).set({ passwordHash: await hashPassword(input.password), resetTokenHash: null, resetExpiresAt: null, failedLoginCount: 0, lockedUntil: null }).where(eq(emailAccounts.userId, account.userId));
      await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.userId, account.userId), isNull(authSessions.revokedAt)));
    });
    return { success: true };
  }),
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    const cookieHeader = ctx.req.headers.cookie ?? "";
    const sessionToken = cookieHeader.split(";").map(value => value.trim()).find(value => value.startsWith(`${PACE_SESSION_COOKIE}=`))?.slice(`${PACE_SESSION_COOKIE}=`.length);
    if (sessionToken) {
      const database = await requireDatabase();
      await database.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.tokenHash, digest(decodeURIComponent(sessionToken))), isNull(authSessions.revokedAt)));
    }
    ctx.res.clearCookie(PACE_SESSION_COOKIE, { ...getSessionCookieOptions(ctx.req), maxAge: 0 });
    return { success: true } as const;
  }),
  resendVerification: publicProcedure.input(z.object({ email: emailSchema })).mutation(async ({ ctx, input }) => {
    rateLimit(ctx, "resend");
    const origin = safeOrigin(ctx);
    const account = await dbHelpers.getEmailAccount(input.email);
    if (account && !account.emailVerifiedAt) {
      const token = randomBytes(32).toString("base64url");
      const database = await requireDatabase();
      await database.update(emailAccounts).set({ verifyTokenHash: digest(token), verifyExpiresAt: new Date(Date.now() + VERIFY_MS) }).where(eq(emailAccounts.userId, account.userId));
      const url = new URL("/verify-email", origin);
      url.searchParams.set("token", token);
      await safeSendLink(input.email, url.toString(), "verify");
    }
    return { message: "If the account needs verification, a fresh link has been sent." };
  }),
  session: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDatabase();
    const [profile] = await db.select({ username: profiles.username, avatarColor: profiles.avatarColor, eligibility: profiles.eligibility }).from(profiles).where(eq(profiles.userId, ctx.user.id)).limit(1);
    return { user: ctx.user, profile: profile ?? null };
  }),
});
