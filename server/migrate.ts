import path from "node:path";
import { createConnection, type Connection } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

export const MIGRATION_LOCK_NAME = "pace_arena_schema_migrations";
const MIGRATION_LOCK_WAIT_SECONDS = 120;
type MigrationLockConnection = Pick<Connection, "query">;

/**
 * Serialize deploy-time migrators across overlapping container instances. MySQL advisory
 * locks are connection-scoped, so the same single connection is used by Drizzle's migrator.
 */
export async function withMigrationAdvisoryLock(
  connection: MigrationLockConnection,
  runMigration: () => Promise<void>,
): Promise<void> {
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", [MIGRATION_LOCK_NAME, MIGRATION_LOCK_WAIT_SECONDS]);
  const acquired = (lockRows as Array<{ acquired: number | null }>)[0]?.acquired === 1;
  if (!acquired) throw new Error("Timed out waiting for the database migration lock.");

  try {
    await runMigration();
  } finally {
    await connection.query("SELECT RELEASE_LOCK(?) AS released", [MIGRATION_LOCK_NAME]);
  }
}

export async function runPendingMigrations(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  if (!databaseUrl) throw new Error("DATABASE_URL is required before the production server can become ready.");
  const connection = await createConnection(databaseUrl);
  try {
    await withMigrationAdvisoryLock(connection, async () => {
      const database = drizzle(connection);
      await migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
    });
  } finally {
    await connection.end();
  }
}
