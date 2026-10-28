import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import { createHash } from "node:crypto";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { sdk } from "./sdk";

export const PACE_SESSION_COOKIE = "pace_arena_session";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  const cookies = parseCookieHeader(opts.req.headers.cookie ?? "");
  const token = cookies[PACE_SESSION_COOKIE];

  if (token && token.length >= 40 && token.length <= 200) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    user = (await db.getUserByAppSessionHash(tokenHash)) ?? null;
  }

  if (!user) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return { req: opts.req, res: opts.res, user };
}
