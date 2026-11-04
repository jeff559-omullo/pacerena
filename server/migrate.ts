import { readFileSync } from "node:fs";
import path from "node:path";
import { createConnection, type Connection } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

export const MIGRATION_LOCK_NAME = "pace_arena_schema_migrations";
const MIGRATION_LOCK_WAIT_SECONDS = 120;
const KES_MIGRATION_TAG = "0006_kes_partner_wallet";
type MigrationLockConnection = Pick<Connection, "query">;

export type Kes0006SchemaState = {
  tables: ReadonlySet<string>;
  columns: ReadonlySet<string>;
  indexes: readonly Kes0006IndexMetadata[];
  foreignKeys: ReadonlySet<string>;
  challengeStatusColumnType: string | null;
};

export type Kes0006IndexMetadata = {
  table: string;
  name: string;
  columns: readonly string[];
  unique: boolean;
};

type Kes0006ForeignKey = {
  edge: string;
  table: string;
  name: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
};

const KES_0006_TABLES = [
  "kes_wallet_accounts",
  "kes_withdrawal_requests",
  "kes_wallet_transactions",
  "partner_credit_events",
] as const;
const KES_0006_COLUMNS = ["challenges.stakeCurrency", "profiles.cashWalletStatus"] as const;
const KES_0006_INDEXES: readonly Kes0006IndexMetadata[] = [
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
const KES_0006_FOREIGN_KEYS: Kes0006ForeignKey[] = [
  { edge: "kes_wallet_accounts.userId->users.id", table: "kes_wallet_accounts", name: "kes_wallet_accounts_userId_users_id_fk", column: "userId", referencedTable: "users", referencedColumn: "id" },
  { edge: "kes_withdrawal_requests.userId->users.id", table: "kes_withdrawal_requests", name: "kes_withdrawal_requests_userId_users_id_fk", column: "userId", referencedTable: "users", referencedColumn: "id" },
  { edge: "kes_withdrawal_requests.processedBy->users.id", table: "kes_withdrawal_requests", name: "kes_withdrawal_requests_processedBy_users_id_fk", column: "processedBy", referencedTable: "users", referencedColumn: "id" },
  { edge: "kes_wallet_transactions.userId->users.id", table: "kes_wallet_transactions", name: "kes_wallet_transactions_userId_users_id_fk", column: "userId", referencedTable: "users", referencedColumn: "id" },
  { edge: "kes_wallet_transactions.challengeId->challenges.id", table: "kes_wallet_transactions", name: "kes_wallet_transactions_challengeId_challenges_id_fk", column: "challengeId", referencedTable: "challenges", referencedColumn: "id" },
  { edge: "kes_wallet_transactions.matchId->matches.id", table: "kes_wallet_transactions", name: "kes_wallet_transactions_matchId_matches_id_fk", column: "matchId", referencedTable: "matches", referencedColumn: "id" },
  { edge: "kes_wallet_transactions.withdrawalRequestId->kes_withdrawal_requests.id", table: "kes_wallet_transactions", name: "kes_wallet_tx_withdrawal_req_fk", column: "withdrawalRequestId", referencedTable: "kes_withdrawal_requests", referencedColumn: "id" },
  { edge: "partner_credit_events.userId->users.id", table: "partner_credit_events", name: "partner_credit_events_user_fk", column: "userId", referencedTable: "users", referencedColumn: "id" },
];
const KES_0006_RECOVERY_FOREIGN_KEYS = KES_0006_FOREIGN_KEYS.slice(-2);
const KES_0006_BASE_FOREIGN_KEYS = KES_0006_FOREIGN_KEYS.slice(0, -2);

function indexMatches(expected: Kes0006IndexMetadata, actual: Kes0006IndexMetadata): boolean {
  return expected.table === actual.table && expected.name === actual.name && expected.unique === actual.unique &&
    expected.columns.length === actual.columns.length && expected.columns.every((column, index) => column === actual.columns[index]);
}

export type Kes0006RecoveryPlan =
  | { kind: "fresh" }
  | { kind: "recover"; missingForeignKeys: Kes0006ForeignKey[] };

/** Recognize only a fresh schema or the specific complete-but-unjournaled 0006 failure. */
export function planKes0006Recovery(state: Kes0006SchemaState): Kes0006RecoveryPlan {
  const hasEvidence =
    KES_0006_TABLES.some(table => state.tables.has(table)) ||
    KES_0006_COLUMNS.some(column => state.columns.has(column)) ||
    KES_0006_INDEXES.some(expected => state.indexes.some(actual => actual.name === expected.name)) ||
    KES_0006_FOREIGN_KEYS.some(foreignKey => state.foreignKeys.has(foreignKey.edge));
  if (!hasEvidence) return { kind: "fresh" };

  const missingTables = KES_0006_TABLES.filter(table => !state.tables.has(table));
  const missingColumns = KES_0006_COLUMNS.filter(column => !state.columns.has(column));
  const missingIndexes = KES_0006_INDEXES.filter(expected => !state.indexes.some(actual => indexMatches(expected, actual)));
  const missingBaseForeignKeys = KES_0006_BASE_FOREIGN_KEYS.filter(foreignKey => !state.foreignKeys.has(foreignKey.edge));
  const hasRejectedChallengeState = state.challengeStatusColumnType?.includes("'rejected'") === true;
  if (missingTables.length || missingColumns.length || missingIndexes.length || missingBaseForeignKeys.length || !hasRejectedChallengeState) {
    throw new Error("The pending KES migration is partially applied outside its verified recovery shape; refusing to replay duplicate DDL.");
  }

  return {
    kind: "recover",
    missingForeignKeys: KES_0006_RECOVERY_FOREIGN_KEYS.filter(foreignKey => !state.foreignKeys.has(foreignKey.edge)),
  };
}

/**
 * Serialize deploy-time migrators across overlapping container instances. MySQL advisory
 * locks are connection-scoped, so the same single connection is used by recovery and Drizzle.
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

async function queryRows<Row>(connection: MigrationLockConnection, query: string): Promise<Row[]> {
  const [rows] = await connection.query(query);
  return rows as unknown as Row[];
}

async function inspectKes0006Schema(connection: MigrationLockConnection): Promise<Kes0006SchemaState> {
  const tableRows = await queryRows<{ TABLE_NAME: string }>(connection,
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('kes_wallet_accounts','kes_withdrawal_requests','kes_wallet_transactions','partner_credit_events')");
  const columnRows = await queryRows<{ TABLE_NAME: string; COLUMN_NAME: string; COLUMN_TYPE: string }>(connection,
    "SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='challenges' AND COLUMN_NAME IN ('stakeCurrency','status')) OR (TABLE_NAME='profiles' AND COLUMN_NAME='cashWalletStatus'))");
  const indexRows = await queryRows<{ TABLE_NAME: string; INDEX_NAME: string; COLUMN_NAME: string | null; SEQ_IN_INDEX: number | string; NON_UNIQUE: number | string }>(connection,
    "SELECT TABLE_NAME,INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX,NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('profiles','kes_wallet_accounts','kes_withdrawal_requests','kes_wallet_transactions','partner_credit_events') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX");
  const foreignKeyRows = await queryRows<{ TABLE_NAME: string; COLUMN_NAME: string; REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string }>(connection,
    "SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('kes_wallet_accounts','kes_withdrawal_requests','kes_wallet_transactions','partner_credit_events') AND REFERENCED_TABLE_NAME IS NOT NULL");
  const challengeStatusColumnType = columnRows.find(row => row.TABLE_NAME === "challenges" && row.COLUMN_NAME === "status")?.COLUMN_TYPE ?? null;
  const groupedIndexes = new Map<string, { table: string; name: string; columns: string[]; nonUnique: number }>();
  for (const row of indexRows) {
    const key = `${row.TABLE_NAME}.${row.INDEX_NAME}`;
    const group = groupedIndexes.get(key) ?? { table: row.TABLE_NAME, name: row.INDEX_NAME, columns: [], nonUnique: Number(row.NON_UNIQUE) };
    group.columns.push(row.COLUMN_NAME ?? "");
    groupedIndexes.set(key, group);
  }
  const indexes: Kes0006IndexMetadata[] = [...groupedIndexes.values()].map(index => ({
    table: index.table,
    name: index.name,
    columns: index.columns,
    unique: index.nonUnique === 0,
  }));

  return {
    tables: new Set(tableRows.map(row => row.TABLE_NAME)),
    columns: new Set(columnRows.map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}`)),
    indexes,
    foreignKeys: new Set(foreignKeyRows.map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}->${row.REFERENCED_TABLE_NAME}.${row.REFERENCED_COLUMN_NAME}`)),
    challengeStatusColumnType,
  };
}

async function recoverInterruptedKes0006(connection: MigrationLockConnection, migrationsFolder: string): Promise<void> {
  const migrationTableRows = await queryRows<{ TABLE_NAME: string }>(connection,
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='__drizzle_migrations' LIMIT 1");
  if (migrationTableRows.length === 0) return;

  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const migrationJournal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string; when: number }> };
  const targetEntry = migrationJournal.entries.find(entry => entry.tag === KES_MIGRATION_TAG);
  const previousEntry = migrationJournal.entries.find(entry => entry.tag === "0005_match_video_recordings");
  if (!targetEntry || !previousEntry) throw new Error("The KES migration recovery metadata is incomplete.");
  const targetMigration = readMigrationFiles({ migrationsFolder }).find(migration => migration.folderMillis === targetEntry.when);
  if (!targetMigration) throw new Error("The pending KES migration SQL is missing from the journaled migration set.");

  const historyRows = await queryRows<{ latest: number | string | null }>(connection,
    "SELECT MAX(`created_at`) AS latest FROM `__drizzle_migrations`");
  const latestMigrationTime = Number(historyRows[0]?.latest ?? 0);
  if (!Number.isFinite(latestMigrationTime)) throw new Error("Could not read the migration journal timestamp.");
  if (latestMigrationTime >= targetEntry.when) return;

  const plan = planKes0006Recovery(await inspectKes0006Schema(connection));
  if (plan.kind === "fresh") return;
  if (latestMigrationTime !== previousEntry.when) {
    throw new Error("Found partial KES schema objects, but migration history is not at 0005; refusing automatic recovery.");
  }

  for (const foreignKey of plan.missingForeignKeys) {
    if (foreignKey.name.length > 64) throw new Error("A recovery foreign-key name exceeds MySQL's 64-character identifier limit.");
    await connection.query(
      `ALTER TABLE \`${foreignKey.table}\` ADD CONSTRAINT \`${foreignKey.name}\` FOREIGN KEY (\`${foreignKey.column}\`) REFERENCES \`${foreignKey.referencedTable}\`(\`${foreignKey.referencedColumn}\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  await connection.query("INSERT INTO `__drizzle_migrations` (`hash`,`created_at`) VALUES (?,?)", [targetMigration.hash, targetMigration.folderMillis]);
  console.info(`[Database] Recovered interrupted ${KES_MIGRATION_TAG} after verifying its existing schema objects.`);
}

export async function runPendingMigrations(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  if (!databaseUrl) throw new Error("DATABASE_URL is required before the production server can become ready.");
  const connection = await createConnection(databaseUrl);
  try {
    await withMigrationAdvisoryLock(connection, async () => {
      const migrationsFolder = path.resolve(process.cwd(), "drizzle");
      await recoverInterruptedKes0006(connection, migrationsFolder);
      const database = drizzle(connection);
      await migrate(database, { migrationsFolder });
    });
  } finally {
    await connection.end();
  }
}
