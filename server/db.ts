import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql, { type PoolOptions } from "mysql2/promise";
import { authSessions, emailAccounts, InsertUser, profiles, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

const TIDB_TLS_CONFIG = {
  minVersion: "TLSv1.2",
  rejectUnauthorized: true,
} as const;

function redactDatabaseUrl(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return databaseUrl.replace(/(:\/\/)([^:@]+):([^@]+)@/, "$1$2:***@");
  }
}

function getMySqlPoolOptions(databaseUrl: string): PoolOptions | null {
  try {
    const parsed = new URL(databaseUrl);
    const sslOverride = parsed.searchParams.get("ssl");
    if (sslOverride && /^(false|0|off|disable|disabled)$/i.test(sslOverride)) {
      throw new Error("DATABASE_URL disables TLS; TiDB Cloud requires encrypted transport.");
    }

    const isTiDBServerlessHost = /tidbcloud\.com|gateway\d*\.|mysql\.|db\./i.test(parsed.hostname);
    if ((isTiDBServerlessHost || parsed.hostname.includes("localhost") === false) && !parsed.searchParams.has("ssl")) {
      parsed.searchParams.set("ssl", JSON.stringify(TIDB_TLS_CONFIG));
    }

    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 4000),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: databaseName,
      ssl: { ...TIDB_TLS_CONFIG },
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    } satisfies PoolOptions;
  } catch (error) {
    console.warn("[Database] Invalid DATABASE_URL:", redactDatabaseUrl(databaseUrl), error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

let _db: ReturnType<typeof drizzle> | null = null;

/** Lazily create the managed MySQL/Drizzle connection. */
export async function getDb() {
  const connectionString = process.env.DATABASE_URL ?? ENV.databaseUrl;
  if (!_db && connectionString) {
    try {
      const poolConfig = getMySqlPoolOptions(connectionString);
      if (!poolConfig) return null;
      const pool = mysql.createPool(poolConfig);
      _db = drizzle({ client: pool }) as unknown as ReturnType<typeof drizzle>;
    } catch (error) {
      console.warn("[Database] Failed to create MySQL pool:", redactDatabaseUrl(connectionString), error instanceof Error ? error.message : "unknown error");
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
