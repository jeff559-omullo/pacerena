import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { authSessions, emailAccounts, InsertUser, profiles, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

/** Lazily create the managed MySQL/Drizzle connection. */
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error instanceof Error ? error.message : "unknown error");
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const database = await getDb();
  if (!database) throw new Error("Database is not available");
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  values.lastSignedIn = user.lastSignedIn ?? new Date();
  updateSet.lastSignedIn = values.lastSignedIn;
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  await database.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const database = await getDb();
  if (!database) return undefined;
  const result = await database.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserByAppSessionHash(tokenHash: string) {
  const database = await getDb();
  if (!database) return undefined;
  const result = await database
    .select({ user: users })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .innerJoin(emailAccounts, eq(emailAccounts.userId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(and(
      eq(authSessions.tokenHash, tokenHash),
      isNull(authSessions.revokedAt),
      gt(authSessions.expiresAt, new Date()),
      gt(emailAccounts.emailVerifiedAt, new Date(0)),
      ne(profiles.eligibility, "suspended"),
    ))
    .limit(1);
  return result[0]?.user;
}

export async function getEmailAccount(emailNormalized: string) {
  const database = await getDb();
  if (!database) return undefined;
  const result = await database.select().from(emailAccounts).where(eq(emailAccounts.emailNormalized, emailNormalized)).limit(1);
  return result[0];
}

export async function getUserById(userId: number) {
  const database = await getDb();
  if (!database) return undefined;
  const result = await database.select().from(users).where(eq(users.id, userId)).limit(1);
  return result[0];
}
