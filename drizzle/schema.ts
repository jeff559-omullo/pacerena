import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

const matchStateValues = ["DRAFT", "OPEN", "ACCEPTED", "AWAITING_STAKES", "READY", "IN_PROGRESS", "AWAITING_EVIDENCE", "UNDER_REVIEW", "COMPLETED", "DRAWN", "CANCELLED", "REFUNDED"] as const;
const longBlob = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "longblob" });

/** OAuth-compatible identity table retained from the managed starter. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const emailAccounts = mysqlTable("email_accounts", {
  userId: int("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  emailNormalized: varchar("emailNormalized", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  verifyTokenHash: varchar("verifyTokenHash", { length: 64 }),
  verifyExpiresAt: timestamp("verifyExpiresAt"),
  resetTokenHash: varchar("resetTokenHash", { length: 64 }),
  resetExpiresAt: timestamp("resetExpiresAt"),
  failedLoginCount: int("failedLoginCount").default(0).notNull(),
  lockedUntil: timestamp("lockedUntil"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const authSessions = mysqlTable("auth_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  revokedAt: timestamp("revokedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastUsedAt: timestamp("lastUsedAt").defaultNow().notNull(),
}, table => ({ userIdx: index("auth_sessions_user_idx").on(table.userId) }));

export const profiles = mysqlTable("profiles", {
  userId: int("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  username: varchar("username", { length: 24 }).notNull().unique(),
  avatarColor: varchar("avatarColor", { length: 16 }).default("#B7F34A").notNull(),
  preferredGame: mysqlEnum("preferredGame", ["efootball", "ea_fc"]),
  gameEdition: varchar("gameEdition", { length: 48 }),
  platform: mysqlEnum("platform", ["android", "ios", "pc", "ps4", "ps5", "xbox_one", "xbox_series", "switch"]),
  country: varchar("country", { length: 2 }).default("KE").notNull(),
  generalLocation: varchar("generalLocation", { length: 80 }),
  availability: mysqlEnum("availability", ["available", "away"]).default("away").notNull(),
  eligibility: mysqlEnum("eligibility", ["eligible", "review", "suspended"]).default("eligible").notNull(),
  cashWalletStatus: mysqlEnum("cashWalletStatus", ["unverified", "pending", "verified", "rejected"]).default("unverified").notNull(),
  matchPreferences: text("matchPreferences"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ cashWalletStatusIdx: index("profile_cash_wallet_status_idx").on(table.cashWalletStatus) }));

export const walletAccounts = mysqlTable("wallet_accounts", {
  userId: int("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  availableCredits: int("availableCredits").default(0).notNull(),
  reservedCredits: int("reservedCredits").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  availableNonnegative: check("wallet_available_nonnegative", sql`${table.availableCredits} >= 0`),
  reservedNonnegative: check("wallet_reserved_nonnegative", sql`${table.reservedCredits} >= 0`),
}));

export const challenges = mysqlTable("challenges", {
  id: int("id").autoincrement().primaryKey(),
  creatorId: int("creatorId").notNull().references(() => users.id),
  opponentId: int("opponentId").references(() => users.id),
  game: mysqlEnum("game", ["efootball", "ea_fc"]).notNull(),
  edition: varchar("edition", { length: 48 }).notNull(),
  platform: mysqlEnum("platform", ["android", "ios", "pc", "ps4", "ps5", "xbox_one", "xbox_series", "switch"]).notNull(),
  stake: int("stake").notNull(),
  stakeCurrency: mysqlEnum("stakeCurrency", ["DEMO", "KES"]).default("DEMO").notNull(),
  matchMinutes: int("matchMinutes").default(12).notNull(),
  settings: text("settings"),
  description: varchar("description", { length: 500 }),
  status: mysqlEnum("status", ["open", "accepted", "rejected", "expired", "cancelled"]).default("open").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  acceptedAt: timestamp("acceptedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  openIdx: index("challenges_open_idx").on(table.status, table.expiresAt),
  stakeRange: check("challenge_stake_range", sql`${table.stake} >= 10 AND ${table.stake} <= 5000`),
  durationRange: check("challenge_duration_range", sql`${table.matchMinutes} >= 6 AND ${table.matchMinutes} <= 30`),
}));

export const matches = mysqlTable("matches", {
  id: int("id").autoincrement().primaryKey(),
  challengeId: int("challengeId").notNull().references(() => challenges.id),
  status: mysqlEnum("status", matchStateValues).default("AWAITING_STAKES").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  acceptedAt: timestamp("acceptedAt").notNull(),
  stakesReservedAt: timestamp("stakesReservedAt"),
  readyDeadline: timestamp("readyDeadline"),
  startedAt: timestamp("startedAt"),
  expectedEndAt: timestamp("expectedEndAt"),
  reportedEndAt: timestamp("reportedEndAt"),
  evidenceDeadline: timestamp("evidenceDeadline"),
  settledAt: timestamp("settledAt"),
  cancellationReason: varchar("cancellationReason", { length: 500 }),
  disputeReason: varchar("disputeReason", { length: 500 }),
}, table => ({ challengeUnique: uniqueIndex("matches_challenge_unique").on(table.challengeId) }));

export const matchStateEvents = mysqlTable("match_state_events", {
  id: int("id").autoincrement().primaryKey(),
  matchId: int("matchId").notNull().references(() => matches.id, { onDelete: "cascade" }),
  fromState: mysqlEnum("fromState", matchStateValues).notNull(),
  toState: mysqlEnum("toState", matchStateValues).notNull(),
  actorUserId: int("actorUserId").references(() => users.id),
  reason: varchar("reason", { length: 1000 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ matchIdx: index("match_state_event_idx").on(table.matchId, table.createdAt) }));

export const matchParticipants = mysqlTable("match_participants", {
  id: int("id").autoincrement().primaryKey(),
  matchId: int("matchId").notNull().references(() => matches.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id),
  side: mysqlEnum("side", ["home", "away"]).notNull(),
  stake: int("stake").notNull(),
  readyAt: timestamp("readyAt"),
  scoreFor: int("scoreFor"),
  scoreAgainst: int("scoreAgainst"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  matchUserUnique: uniqueIndex("match_participant_unique").on(table.matchId, table.userId),
  matchIdx: index("match_participant_match_idx").on(table.matchId),
  stakePositive: check("participant_stake_positive", sql`${table.stake} > 0`),
  scoreForValid: check("participant_score_for_valid", sql`${table.scoreFor} IS NULL OR (${table.scoreFor} >= 0 AND ${table.scoreFor} <= 99)`),
  scoreAgainstValid: check("participant_score_against_valid", sql`${table.scoreAgainst} IS NULL OR (${table.scoreAgainst} >= 0 AND ${table.scoreAgainst} <= 99)`),
}));

export const walletTransactions = mysqlTable("wallet_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  matchId: int("matchId").references(() => matches.id),
  transactionType: mysqlEnum("transactionType", ["initial_grant", "stake_reservation", "stake_release", "winner_reward", "draw_refund", "cancellation_refund", "stake_consumption", "admin_adjustment"]).notNull(),
  amount: int("amount").notNull(),
  availableBefore: int("availableBefore").notNull(),
  availableAfter: int("availableAfter").notNull(),
  reservedBefore: int("reservedBefore").notNull(),
  reservedAfter: int("reservedAfter").notNull(),
  status: mysqlEnum("status", ["completed", "reserved", "released"]).default("completed").notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
  reason: varchar("reason", { length: 1000 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  idempotencyUnique: uniqueIndex("wallet_tx_idempotency_unique").on(table.userId, table.idempotencyKey),
  ownerIdx: index("wallet_tx_owner_idx").on(table.userId, table.createdAt),
  matchIdx: index("wallet_tx_match_idx").on(table.matchId),
  amountNonnegative: check("wallet_tx_amount_nonnegative", sql`${table.amount} >= 0`),
  availableBeforeNonnegative: check("wallet_tx_available_before_nonnegative", sql`${table.availableBefore} >= 0`),
  availableAfterNonnegative: check("wallet_tx_available_after_nonnegative", sql`${table.availableAfter} >= 0`),
  reservedBeforeNonnegative: check("wallet_tx_reserved_before_nonnegative", sql`${table.reservedBefore} >= 0`),
  reservedAfterNonnegative: check("wallet_tx_reserved_after_nonnegative", sql`${table.reservedAfter} >= 0`),
}));

export const kesWalletAccounts = mysqlTable("kes_wallet_accounts", {
  userId: int("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  walletReference: varchar("walletReference", { length: 40 }),
  availableKes: int("availableKes").default(0).notNull(),
  reservedKes: int("reservedKes").default(0).notNull(),
  frozen: int("frozen").default(0).notNull(),
  freezeReason: varchar("freezeReason", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  walletReferenceUnique: uniqueIndex("kes_wallet_reference_unique").on(table.walletReference),
  availableNonnegative: check("kes_wallet_available_nonnegative", sql`${table.availableKes} >= 0`),
  reservedNonnegative: check("kes_wallet_reserved_nonnegative", sql`${table.reservedKes} >= 0`),
  frozenFlag: check("kes_wallet_frozen_flag", sql`${table.frozen} IN (0, 1)`),
}));

export const kesWithdrawalRequests = mysqlTable("kes_withdrawal_requests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
  amountKes: int("amountKes").notNull(),
  phoneE164: varchar("phoneE164", { length: 16 }).notNull(),
  status: mysqlEnum("status", ["pending", "paid", "rejected"]).default("pending").notNull(),
  payoutReceipt: varchar("payoutReceipt", { length: 64 }),
  actualAmountKes: int("actualAmountKes"),
  reviewReason: varchar("reviewReason", { length: 2000 }),
  requestedAt: timestamp("requestedAt").defaultNow().notNull(),
  processedAt: timestamp("processedAt"),
  processedBy: int("processedBy").references(() => users.id),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  userIdempotencyUnique: uniqueIndex("kes_withdrawal_user_idempotency_unique").on(table.userId, table.idempotencyKey),
  ownerIdx: index("kes_withdrawal_owner_idx").on(table.userId, table.requestedAt),
  statusIdx: index("kes_withdrawal_status_idx").on(table.status, table.requestedAt),
  amountPositive: check("kes_withdrawal_amount_positive", sql`${table.amountKes} > 0`),
}));

export const kesWalletTransactions = mysqlTable("kes_wallet_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  challengeId: int("challengeId").references(() => challenges.id),
  matchId: int("matchId").references(() => matches.id),
  withdrawalRequestId: int("withdrawalRequestId").references(() => kesWithdrawalRequests.id),
  transactionType: mysqlEnum("transactionType", ["partner_credit", "partner_reversal", "partner_reversal_review", "withdrawal_reservation", "withdrawal_paid", "withdrawal_release", "stake_reservation", "stake_release", "winner_reward", "draw_refund", "stake_consumption", "admin_adjustment"]).notNull(),
  amountKes: int("amountKes").notNull(),
  availableBeforeKes: int("availableBeforeKes").notNull(),
  availableAfterKes: int("availableAfterKes").notNull(),
  reservedBeforeKes: int("reservedBeforeKes").notNull(),
  reservedAfterKes: int("reservedAfterKes").notNull(),
  status: mysqlEnum("status", ["completed", "reserved", "released", "review"]).default("completed").notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
  reason: varchar("reason", { length: 1000 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  idempotencyUnique: uniqueIndex("kes_wallet_tx_idempotency_unique").on(table.userId, table.idempotencyKey),
  ownerIdx: index("kes_wallet_tx_owner_idx").on(table.userId, table.createdAt),
  challengeIdx: index("kes_wallet_tx_challenge_idx").on(table.challengeId),
  matchIdx: index("kes_wallet_tx_match_idx").on(table.matchId),
  amountPositive: check("kes_wallet_tx_amount_positive", sql`${table.amountKes} > 0`),
  availableBeforeNonnegative: check("kes_wallet_tx_available_before_nonnegative", sql`${table.availableBeforeKes} >= 0`),
  availableAfterNonnegative: check("kes_wallet_tx_available_after_nonnegative", sql`${table.availableAfterKes} >= 0`),
  reservedBeforeNonnegative: check("kes_wallet_tx_reserved_before_nonnegative", sql`${table.reservedBeforeKes} >= 0`),
  reservedAfterNonnegative: check("kes_wallet_tx_reserved_after_nonnegative", sql`${table.reservedAfterKes} >= 0`),
}));

export const partnerCreditEvents = mysqlTable("partner_credit_events", {
  id: int("id").autoincrement().primaryKey(),
  eventId: varchar("eventId", { length: 128 }).notNull(),
  transactionId: varchar("transactionId", { length: 128 }).notNull(),
  eventType: mysqlEnum("eventType", ["credit", "reversal"]).default("credit").notNull(),
  reversesTransactionId: varchar("reversesTransactionId", { length: 128 }),
  userId: int("userId").notNull().references(() => users.id),
  walletReference: varchar("walletReference", { length: 40 }).notNull(),
  amountKes: int("amountKes").notNull(),
  currency: varchar("currency", { length: 3 }).default("KES").notNull(),
  status: mysqlEnum("status", ["credited", "reversed", "held_for_review", "dismissed"]).default("credited").notNull(),
  partnerOccurredAt: timestamp("partnerOccurredAt"),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
}, table => ({
  eventUnique: uniqueIndex("partner_credit_event_unique").on(table.eventId),
  transactionUnique: uniqueIndex("partner_credit_transaction_unique").on(table.transactionId),
  reversalUnique: uniqueIndex("partner_credit_reversal_unique").on(table.reversesTransactionId),
  ownerIdx: index("partner_credit_owner_idx").on(table.userId, table.receivedAt),
  amountPositive: check("partner_credit_amount_positive", sql`${table.amountKes} > 0`),
}));

export const matchCodes = mysqlTable("match_codes", {
  id: int("id").autoincrement().primaryKey(),
  matchId: int("matchId").notNull().references(() => matches.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id),
  code: varchar("code", { length: 160 }).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ ownerUnique: uniqueIndex("match_code_owner_unique").on(table.matchId, table.userId) }));

export const matchEvidence = mysqlTable("match_evidence", {
  id: int("id").autoincrement().primaryKey(),
  matchId: int("matchId").notNull().references(() => matches.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  mimeType: mysqlEnum("mimeType", ["image/jpeg", "image/png", "image/webp"]).notNull(),
  sizeBytes: int("sizeBytes").notNull(),
  scoreFor: int("scoreFor").notNull(),
  scoreAgainst: int("scoreAgainst").notNull(),
  comments: varchar("comments", { length: 1000 }),
  submittedAt: timestamp("submittedAt").defaultNow().notNull(),
}, table => ({
  submitterUnique: uniqueIndex("match_evidence_submitter_unique").on(table.matchId, table.userId),
  matchIdx: index("match_evidence_match_idx").on(table.matchId),
  fileSize: check("match_evidence_file_size", sql`${table.sizeBytes} >= 64 AND ${table.sizeBytes} <= 5242880`),
  scoreForValid: check("match_evidence_score_for_valid", sql`${table.scoreFor} >= 0 AND ${table.scoreFor} <= 99`),
  scoreAgainstValid: check("match_evidence_score_against_valid", sql`${table.scoreAgainst} >= 0 AND ${table.scoreAgainst} <= 99`),
}));

export const matchRecordings = mysqlTable("match_video_recordings", {
  id: int("id").autoincrement().primaryKey(),
  matchId: int("matchId").notNull().references(() => matches.id),
  userId: int("userId").notNull().references(() => users.id),
  mimeType: mysqlEnum("mimeType", ["video/webm", "video/mp4", "video/quicktime"]).notNull(),
  sizeBytes: int("sizeBytes").notNull(),
  encryptedBytes: longBlob("encryptedBytes").notNull(),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt"),
}, table => ({
  submitterUnique: uniqueIndex("match_video_recording_user_unique").on(table.matchId, table.userId),
  matchIdx: index("match_video_recording_match_idx").on(table.matchId),
  expiryIdx: index("match_video_recording_expiry_idx").on(table.expiresAt),
  fileSize: check("match_video_recording_size", sql`${table.sizeBytes} >= 64 AND ${table.sizeBytes} <= 33554432`),
}));

export const disputes = mysqlTable("disputes", {
  id: int("id").autoincrement().primaryKey(),
  matchId: int("matchId").notNull().references(() => matches.id),
  openedBy: int("openedBy").notNull().references(() => users.id),
  reason: mysqlEnum("reason", ["conflicting_scores", "missing_evidence", "incorrect_screenshot", "disconnect", "wrong_settings", "suspected_cheating", "other"]).notNull(),
  explanation: varchar("explanation", { length: 3000 }).notNull(),
  status: mysqlEnum("status", ["OPEN", "INVESTIGATING", "RESOLVED", "REJECTED"]).default("OPEN").notNull(),
  administrativeNotes: text("administrativeNotes"),
  resolutionReason: varchar("resolutionReason", { length: 2000 }),
  resolvedBy: int("resolvedBy").references(() => users.id),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ matchIdx: index("dispute_match_idx").on(table.matchId), statusIdx: index("dispute_status_idx").on(table.status) }));

export const disputeAttachments = mysqlTable("dispute_attachments", {
  id: int("id").autoincrement().primaryKey(),
  disputeId: int("disputeId").notNull().references(() => disputes.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  mimeType: mysqlEnum("mimeType", ["image/jpeg", "image/png", "image/webp"]).notNull(),
  sizeBytes: int("sizeBytes").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ disputeIdx: index("dispute_attachment_idx").on(table.disputeId), fileSize: check("dispute_attachment_file_size", sql`${table.sizeBytes} >= 64 AND ${table.sizeBytes} <= 5242880`) }));

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 48 }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  body: varchar("body", { length: 500 }).notNull(),
  entityType: varchar("entityType", { length: 32 }),
  entityId: int("entityId"),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ ownerIdx: index("notification_owner_idx").on(table.userId, table.createdAt) }));

export const adminAuditLogs = mysqlTable("admin_audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  adminUserId: int("adminUserId").notNull().references(() => users.id),
  action: varchar("action", { length: 80 }).notNull(),
  entityType: varchar("entityType", { length: 48 }).notNull(),
  entityId: int("entityId").notNull(),
  reason: varchar("reason", { length: 2000 }).notNull(),
  details: text("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ entityIdx: index("admin_audit_entity_idx").on(table.entityType, table.entityId) }));

export const platformSettings = mysqlTable("platform_settings", {
  id: int("id").primaryKey(),
  challengeCreationEnabled: int("challengeCreationEnabled").default(1).notNull(),
  minimumStake: int("minimumStake").default(10).notNull(),
  maximumStake: int("maximumStake").default(5000).notNull(),
  defaultMatchMinutes: int("defaultMatchMinutes").default(12).notNull(),
  maintenanceNotice: varchar("maintenanceNotice", { length: 400 }),
  updatedBy: int("updatedBy").references(() => users.id),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  singletonId: check("platform_settings_singleton", sql`${table.id} = 1`),
  creationFlag: check("platform_settings_creation_flag", sql`${table.challengeCreationEnabled} IN (0, 1)`),
  minimumStakeRange: check("platform_settings_min_stake_range", sql`${table.minimumStake} >= 10 AND ${table.minimumStake} <= 5000`),
  maximumStakeRange: check("platform_settings_max_stake_range", sql`${table.maximumStake} >= 10 AND ${table.maximumStake} <= 5000`),
  stakeBoundsOrder: check("platform_settings_stake_order", sql`${table.minimumStake} <= ${table.maximumStake}`),
  matchMinutesRange: check("platform_settings_match_duration", sql`${table.defaultMatchMinutes} >= 6 AND ${table.defaultMatchMinutes} <= 30`),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type Challenge = typeof challenges.$inferSelect;
export type Match = typeof matches.$inferSelect;
