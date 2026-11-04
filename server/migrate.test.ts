import { describe, expect, it, vi } from "vitest";
import type { Connection } from "mysql2/promise";
import { MIGRATION_LOCK_NAME, planKes0006Recovery, withMigrationAdvisoryLock, type Kes0006IndexMetadata, type Kes0006SchemaState } from "./migrate";

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

const baseForeignKeys = [
  "kes_wallet_accounts.userId->users.id",
  "kes_withdrawal_requests.userId->users.id",
  "kes_withdrawal_requests.processedBy->users.id",
  "kes_wallet_transactions.userId->users.id",
  "kes_wallet_transactions.challengeId->challenges.id",
  "kes_wallet_transactions.matchId->matches.id",
];
const repairForeignKeys = [
  "kes_wallet_transactions.withdrawalRequestId->kes_withdrawal_requests.id",
  "partner_credit_events.userId->users.id",
];
const expectedIndexes: Kes0006IndexMetadata[] = [
  { table: "profiles", name: "profile_cash_wallet_status_idx", columns: ["cashWalletStatus"], unique: false },
  { table: "kes_wallet_accounts", name: "kes_wallet_reference_unique", columns: ["walletReference"], unique: true },
  { table: "kes_withdrawal_requests", name: "kes_withdrawal_user_idempotency_unique", columns: ["userId", "idempotencyKey"], unique: true },
  { table: "kes_withdrawal_requests", name: "kes_withdrawal_owner_idx", columns: ["userId", "requestedAt"], unique: false },
  { table: "kes_withdrawal_requests", name: "kes_withdrawal_status_idx", columns: ["status", "requestedAt"], unique: false },
  { table: "kes_wallet_transactions", name: "kes_wallet_tx_idempotency_unique", columns: ["userId", "idempotencyKey"], unique: true },
  { table: "kes_wallet_transactions", name: "kes_wallet_tx_owner_idx", columns: ["userId", "createdAt"], unique: false },
  { table: "kes_wallet_transactions", name: "kes_wallet_tx_challenge_idx", columns: ["challengeId"], unique: false },
  { table: "kes_wallet_transactions", name: "kes_wallet_tx_match_idx", columns: ["matchId"], unique: false },
  { table: "partner_credit_events", name: "partner_credit_event_unique", columns: ["eventId"], unique: true },
  { table: "partner_credit_events", name: "partner_credit_transaction_unique", columns: ["transactionId"], unique: true },
  { table: "partner_credit_events", name: "partner_credit_reversal_unique", columns: ["reversesTransactionId"], unique: true },
  { table: "partner_credit_events", name: "partner_credit_owner_idx", columns: ["userId", "receivedAt"], unique: false },
];

function interruptedKes0006State(): Kes0006SchemaState {
  return {
    tables: new Set(["kes_wallet_accounts", "kes_withdrawal_requests", "kes_wallet_transactions", "partner_credit_events"]),
    columns: new Set(["challenges.stakeCurrency", "profiles.cashWalletStatus"]),
    indexes: expectedIndexes,
    foreignKeys: new Set(baseForeignKeys),
    challengeStatusColumnType: "enum('open','accepted','expired','cancelled','rejected')",
  };
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

describe("interrupted 0006 migration recovery planning", () => {
  it("leaves a fresh schema to the normal Drizzle migrator", () => {
    expect(planKes0006Recovery({ tables: new Set(), columns: new Set(), indexes: [], foreignKeys: new Set(), challengeStatusColumnType: null })).toEqual({ kind: "fresh" });
  });

  it("recognizes the verified 0006 state and returns only the two missing short-name foreign keys", () => {
    const plan = planKes0006Recovery(interruptedKes0006State());
    expect(plan.kind).toBe("recover");
    if (plan.kind === "recover") {
      expect(plan.missingForeignKeys.map(foreignKey => foreignKey.name)).toEqual([
        "kes_wallet_tx_withdrawal_req_fk",
        "partner_credit_events_user_fk",
      ]);
    }
  });

  it("is retry-safe after one missing constraint was added before an interruption", () => {
    const state = interruptedKes0006State();
    state.foreignKeys = new Set([...state.foreignKeys, repairForeignKeys[0]]);
    const plan = planKes0006Recovery(state);
    expect(plan.kind).toBe("recover");
    if (plan.kind === "recover") expect(plan.missingForeignKeys.map(foreignKey => foreignKey.edge)).toEqual([repairForeignKeys[1]]);
  });

  it("records a complete but unjournaled schema without re-adding any constraints", () => {
    const state = interruptedKes0006State();
    state.foreignKeys = new Set([...state.foreignKeys, ...repairForeignKeys]);
    const plan = planKes0006Recovery(state);
    expect(plan.kind).toBe("recover");
    if (plan.kind === "recover") expect(plan.missingForeignKeys).toEqual([]);
  });

  it("refuses to bless a different partially applied schema", () => {
    const state = interruptedKes0006State();
    state.indexes = state.indexes.filter(index => index.name !== "kes_wallet_tx_match_idx");
    expect(() => planKes0006Recovery(state)).toThrow("refusing to replay duplicate DDL");
  });

  it("rejects a same-named index on the wrong table instead of treating it as complete", () => {
    const state = interruptedKes0006State();
    state.indexes = state.indexes.map(index => index.name === "profile_cash_wallet_status_idx" ? { ...index, table: "kes_wallet_accounts" } : index);
    expect(() => planKes0006Recovery(state)).toThrow("refusing to replay duplicate DDL");
  });

  it("rejects a same-named index with the wrong columns or uniqueness", () => {
    const state = interruptedKes0006State();
    state.indexes = state.indexes.map(index => index.name === "kes_wallet_reference_unique" ? { ...index, columns: ["userId"], unique: false } : index);
    expect(() => planKes0006Recovery(state)).toThrow("refusing to replay duplicate DDL");
  });
});
