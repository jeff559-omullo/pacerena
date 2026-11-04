import { describe, expect, it, vi } from "vitest";
import type { Connection } from "mysql2/promise";
import { MIGRATION_LOCK_NAME, withMigrationAdvisoryLock } from "./migrate";

type LockClient = Pick<Connection, "query">;

function mockConnection(acquired: number) {
  const calls: string[] = [];
  const connection = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql.includes("GET_LOCK") ? "acquire" : "release");
      return [sql.includes("GET_LOCK") ? [{ acquired }] : [{ released: 1 }], []];
    }),
  } as unknown as LockClient;
  return { connection, calls };
}

describe("production database migration lock", () => {
  it("runs migrations while holding one named MySQL advisory lock and releases it", async () => {
    const { connection, calls } = mockConnection(1);
    const migration = vi.fn(async () => { calls.push("migration"); });

    await withMigrationAdvisoryLock(connection, migration);

    expect(calls).toEqual(["acquire", "migration", "release"]);
    expect(connection.query).toHaveBeenCalledWith("SELECT GET_LOCK(?, ?) AS acquired", [MIGRATION_LOCK_NAME, 120]);
  });

  it("fails closed when the migration lock cannot be acquired", async () => {
    const { connection, calls } = mockConnection(0);
    const migration = vi.fn(async () => undefined);

    await expect(withMigrationAdvisoryLock(connection, migration)).rejects.toThrow("Timed out waiting for the database migration lock.");
    expect(migration).not.toHaveBeenCalled();
    expect(calls).toEqual(["acquire"]);
  });

  it("releases the lock even when a migration fails", async () => {
    const { connection, calls } = mockConnection(1);

    await expect(withMigrationAdvisoryLock(connection, async () => { throw new Error("migration failure"); })).rejects.toThrow("migration failure");
    expect(calls).toEqual(["acquire", "release"]);
  });
});
