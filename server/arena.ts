import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, inArray, isNull, lte, like, ne, or } from "drizzle-orm";
import { z } from "zod";
import {
  adminAuditLogs,
  challenges,
  disputeAttachments,
  disputes,
  kesWalletAccounts,
  kesWalletTransactions,
  matchCodes,
  matchEvidence,
  matchParticipants,
  matchRecordings,
  matches,
  matchStateEvents,
  notifications,
  platformSettings,
  profiles,
  users,
  walletAccounts,
  walletTransactions,
} from "../drizzle/schema";
import {
  areCompatible,
  canTransition,
  DEFAULT_MATCH_MINUTES,
  EVIDENCE_WINDOW_MS,
  canTransitionDispute,
  GAME_LABELS,
  PLATFORM_LABELS,
  READY_WINDOW_MS,
  STAKE_MAX,
  STAKE_MIN,
  type MatchState,
  validateStakeBounds,
  validateScorePair,
} from "../shared/pace";
import { getDb } from "./db";
import { canViewChallengeDetails } from "./challenge-access";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { storePrivateEvidence } from "./evidence";
import { cleanupExpiredMatchRecordings } from "./match-recordings";
import { ensureKesWalletAccount, getKesWalletConfig, isKesWageringEnabled, shouldForceKesFeatures } from "./kes-wallet";

const gameSchema = z.enum(["efootball", "ea_fc"]);
const platformSchema = z.enum(["android", "ios", "pc", "ps4", "ps5", "xbox_one", "xbox_series", "switch"]);

async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "The Pace Arena database is unavailable." });
  return db;
}
export function challengeCreationAllowed(settingValue: number | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return settingValue === 1 || shouldForceKesFeatures(env);
}

async function getPlatformSettings(executor: any, lock = false) {
  const rows = lock
    ? await executor.select().from(platformSettings).where(eq(platformSettings.id, 1)).for("update").limit(1)
    : await executor.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  return rows[0] ?? {
    id: 0,
    challengeCreationEnabled: 1,
    minimumStake: STAKE_MIN,
    maximumStake: STAKE_MAX,
    defaultMatchMinutes: DEFAULT_MATCH_MINUTES,
    maintenanceNotice: null,
    updatedBy: null,
  };
}
function forbidden(message = "This action is not permitted for this account."): never {
  throw new TRPCError({ code: "FORBIDDEN", message });
}
function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "The requested item is no longer available." });
}
const actionBuckets = new Map<string, { count: number; resetAt: number }>();
function limitUserAction(ctx: { user: { id: number }; req: { ip?: string } }, action: string, limit = 30) {
  const now = Date.now();
  if (actionBuckets.size > 5000) for (const [key, value] of actionBuckets) if (value.resetAt <= now) actionBuckets.delete(key);
  for (const key of [`${action}:user:${ctx.user.id}`, `${action}:ip:${ctx.req.ip ?? "unknown"}`]) {
    const value = actionBuckets.get(key);
    if (!value || value.resetAt <= now) actionBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    else if (++value.count > limit) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests for this action. Wait a minute and try again." });
  }
}
function insertId(result: unknown): number {
  const first = Array.isArray(result) ? result[0] as { insertId?: number | string } : undefined;
  const value = Number(first?.insertId);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Database did not return a new record ID");
  return value;
}
async function notify(tx: any, userId: number, type: string, title: string, body: string, entityType?: string, entityId?: number) {
  await tx.insert(notifications).values({ userId, type, title, body, entityType: entityType ?? null, entityId: entityId ?? null });
}
async function requireEligible(tx: any, userId: number) {
  const rows = await tx.select().from(profiles).where(eq(profiles.userId, userId)).for("update").limit(1);
  const profile = rows[0];
  if (!profile) forbidden("Your account is not eligible to enter a match. Contact support or review the account notice.");
  if (!shouldForceKesFeatures() && profile.eligibility !== "eligible") forbidden("Your account is not eligible to enter a match. Contact support or review the account notice.");
  return profile;
}
async function requireKesEligible(tx: any, userId: number) {
  const profile = await requireEligible(tx, userId);
  if (!shouldForceKesFeatures() && profile.cashWalletStatus !== "verified") forbidden("Your KES wallet must be verified by an administrator before you can wager.");
  const wallet = await ensureKesWalletAccount(tx, userId);
  if (wallet.frozen === 1) forbidden("Your KES wallet is frozen for administrator review; wagering is paused.");
  return profile;
}
async function ensureNoActiveMatch(tx: any, userId: number) {
  const active = await tx.select({ matchId: matches.id }).from(matchParticipants)
    .innerJoin(matches, eq(matches.id, matchParticipants.matchId))
    .where(and(eq(matchParticipants.userId, userId), inArray(matches.status, ["AWAITING_STAKES", "READY", "IN_PROGRESS", "AWAITING_EVIDENCE", "UNDER_REVIEW"])))
    .for("update").limit(1);
  if (active.length) throw new TRPCError({ code: "CONFLICT", message: "You already have a match that has not been completed or reviewed." });
}
async function lockWallet(tx: any, userId: number) {
  const rows = await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).for("update").limit(1);
  const wallet = rows[0];
  if (!wallet) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No demo wallet is available for this account." });
  return wallet;
}
type StakeCurrency = "DEMO" | "KES";
type StakeTransactionType = "stake_reservation" | "stake_release" | "winner_reward" | "draw_refund" | "cancellation_refund" | "stake_consumption";
async function lockWagerWallet(tx: any, userId: number, currency: StakeCurrency) {
  if (currency === "KES") {
    const wallet = await ensureKesWalletAccount(tx, userId);
    return { available: wallet.availableKes, reserved: wallet.reservedKes };
  }
  const wallet = await lockWallet(tx, userId);
  return { available: wallet.availableCredits, reserved: wallet.reservedCredits };
}
async function saveWagerWallet(tx: any, userId: number, currency: StakeCurrency, available: number, reserved: number) {
  if (currency === "KES") {
    await tx.update(kesWalletAccounts).set({ availableKes: available, reservedKes: reserved }).where(eq(kesWalletAccounts.userId, userId));
    return;
  }
  await tx.update(walletAccounts).set({ availableCredits: available, reservedCredits: reserved }).where(eq(walletAccounts.userId, userId));
}
async function recordWagerLedger(tx: any, currency: StakeCurrency, input: {
  userId: number; challengeId?: number | null; matchId?: number | null; transactionType: StakeTransactionType;
  amount: number; availableBefore: number; availableAfter: number; reservedBefore: number; reservedAfter: number;
  idempotencyKey: string; reason: string;
}) {
  if (currency === "KES") {
    const transactionType = input.transactionType === "cancellation_refund" ? "stake_release" : input.transactionType;
    await tx.insert(kesWalletTransactions).values({
      userId: input.userId,
      challengeId: input.challengeId ?? null,
      matchId: input.matchId ?? null,
      transactionType,
      amountKes: input.amount,
      availableBeforeKes: input.availableBefore,
      availableAfterKes: input.availableAfter,
      reservedBeforeKes: input.reservedBefore,
      reservedAfterKes: input.reservedAfter,
      status: input.transactionType === "stake_reservation" ? "reserved" : input.transactionType === "stake_release" || input.transactionType === "cancellation_refund" ? "released" : "completed",
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    });
    return;
  }
  await ledger(tx, {
    userId: input.userId,
    matchId: input.matchId ?? null,
    transactionType: input.transactionType,
    amount: input.amount,
    availableBefore: input.availableBefore,
    availableAfter: input.availableAfter,
    reservedBefore: input.reservedBefore,
    reservedAfter: input.reservedAfter,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
  });
}
async function refundOpenChallenge(tx: any, challenge: typeof challenges.$inferSelect, idempotencyKey: string, reason: string) {
  const currency = challenge.stakeCurrency as StakeCurrency;
  const wallet = await lockWagerWallet(tx, challenge.creatorId, currency);
  if (wallet.reserved < challenge.stake) throw new Error("Reserved challenge stake invariant failed");
  const availableAfter = wallet.available + challenge.stake;
  const reservedAfter = wallet.reserved - challenge.stake;
  await saveWagerWallet(tx, challenge.creatorId, currency, availableAfter, reservedAfter);
  await recordWagerLedger(tx, currency, {
    userId: challenge.creatorId,
    challengeId: challenge.id,
    transactionType: "cancellation_refund",
    amount: challenge.stake,
    availableBefore: wallet.available,
    availableAfter,
    reservedBefore: wallet.reserved,
    reservedAfter,
    idempotencyKey,
    reason,
  });
}
async function transitionMatch(tx: any, current: any, toState: MatchState, patch: Record<string, unknown>, actorUserId: number | null, reason: string) {
  const fromState = current.status as MatchState;
  if (!canTransition(fromState, toState)) throw new TRPCError({ code: "CONFLICT", message: `Match cannot transition from ${fromState} to ${toState}.` });
  await tx.update(matches).set({ ...patch, status: toState }).where(eq(matches.id, current.id));
  await tx.insert(matchStateEvents).values({ matchId: current.id, fromState, toState, actorUserId, reason: reason.slice(0, 1000) });
  return { ...current, ...patch, status: toState };
}
async function ledger(tx: any, input: {
  userId: number; matchId?: number | null; transactionType: "initial_grant" | "stake_reservation" | "stake_release" | "winner_reward" | "draw_refund" | "cancellation_refund" | "stake_consumption" | "admin_adjustment";
  amount: number; availableBefore: number; availableAfter: number; reservedBefore: number; reservedAfter: number; idempotencyKey: string; reason: string;
}) {
  await tx.insert(walletTransactions).values({
    userId: input.userId,
    matchId: input.matchId ?? null,
    transactionType: input.transactionType,
    amount: input.amount,
    availableBefore: input.availableBefore,
    availableAfter: input.availableAfter,
    reservedBefore: input.reservedBefore,
    reservedAfter: input.reservedAfter,
    status: input.transactionType === "stake_reservation" ? "reserved" : input.transactionType === "stake_release" ? "released" : "completed",
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
  });
}
async function getParticipants(tx: any, matchId: number) {
  return tx.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId)).orderBy(matchParticipants.id).for("update");
}
async function refundStakes(tx: any, matchId: number, participants: any[], reason: string) {
  const matchRows = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update").limit(1);
  let match = matchRows[0];
  if (!match) notFound();
  const challengeRows = await tx.select({ stakeCurrency: challenges.stakeCurrency }).from(challenges).where(eq(challenges.id, match.challengeId)).limit(1);
  const currency = (challengeRows[0]?.stakeCurrency ?? "DEMO") as StakeCurrency;
  for (const participant of [...participants].sort((a, b) => a.userId - b.userId)) {
    const wallet = await lockWagerWallet(tx, participant.userId, currency);
    if (wallet.reserved < participant.stake) throw new Error("Reserved stake invariant failed during refund");
    const availableAfter = wallet.available + participant.stake;
    const reservedAfter = wallet.reserved - participant.stake;
    await saveWagerWallet(tx, participant.userId, currency, availableAfter, reservedAfter);
    await recordWagerLedger(tx, currency, {
      userId: participant.userId, matchId, transactionType: "cancellation_refund", amount: participant.stake,
      availableBefore: wallet.available, availableAfter, reservedBefore: wallet.reserved, reservedAfter,
      idempotencyKey: `refund:${matchId}:${participant.userId}`, reason,
    });
  }
  if (match.status !== "CANCELLED") match = await transitionMatch(tx, match, "CANCELLED", { cancellationReason: reason }, null, reason);
  await transitionMatch(tx, match, "REFUNDED", { settledAt: new Date() }, null, reason);
}
async function settleScores(tx: any, matchId: number, participants: any[], winnerUserId: number | null, reason: string, actorUserId: number | null = null) {
  const matchRows = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update").limit(1);
  const match = matchRows[0];
  if (!match) notFound();
  if (["COMPLETED", "DRAWN", "REFUNDED", "CANCELLED"].includes(match.status)) {
    throw new TRPCError({ code: "CONFLICT", message: "This match has already been settled." });
  }
  if (participants.length !== 2) throw new Error("A match must have exactly two participants");
  if (winnerUserId !== null && !participants.some((p: any) => p.userId === winnerUserId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The selected winner is not a participant." });
  }
  const challengeRows = await tx.select({ stakeCurrency: challenges.stakeCurrency }).from(challenges).where(eq(challenges.id, match.challengeId)).limit(1);
  const currency = (challengeRows[0]?.stakeCurrency ?? "DEMO") as StakeCurrency;
  if (currency === "KES" && winnerUserId !== null && !isKesWageringEnabled()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "KES winner settlement is paused by the server configuration. The reserved stakes remain unchanged until it is enabled again." });
  }
  const pool = participants.reduce((sum: number, p: any) => sum + p.stake, 0);
  for (const participant of [...participants].sort((a, b) => a.userId - b.userId)) {
    const wallet = await lockWagerWallet(tx, participant.userId, currency);
    if (wallet.reserved < participant.stake) throw new Error("Reserved stake invariant failed during settlement");
    const isWinner = winnerUserId === participant.userId;
    const isDraw = winnerUserId === null;
    const availableAfter = wallet.available + (isWinner ? pool : isDraw ? participant.stake : 0);
    const reservedAfter = wallet.reserved - participant.stake;
    await saveWagerWallet(tx, participant.userId, currency, availableAfter, reservedAfter);
    const transactionType = isWinner ? "winner_reward" : isDraw ? "draw_refund" : "stake_consumption";
    const amount = isWinner ? pool : participant.stake;
    const currencyLabel = currency === "KES" ? "KES" : "legacy demo-credit";
    await recordWagerLedger(tx, currency, {
      userId: participant.userId, matchId, transactionType, amount,
      availableBefore: wallet.available, availableAfter, reservedBefore: wallet.reserved, reservedAfter,
      idempotencyKey: `settle:${matchId}:${participant.userId}`,
      reason: `${reason} ${isWinner ? `Winner receives the agreed ${currencyLabel} pool.` : isDraw ? "Draw returns each player's own stake." : `Losing reserved ${currencyLabel} stake is consumed.`}`,
    });
  }
  await transitionMatch(tx, match, winnerUserId === null ? "DRAWN" : "COMPLETED", { settledAt: new Date() }, actorUserId, reason);
  for (const participant of participants) {
    const currencyLabel = currency === "KES" ? "KES" : "legacy demo-credit";
    await notify(tx, participant.userId, winnerUserId === null ? "draw_refund" : "match_result", winnerUserId === null ? "Match drawn" : winnerUserId === participant.userId ? "Match won" : "Match complete", winnerUserId === null ? "Your own reserved stake has been returned." : winnerUserId === participant.userId ? `The agreed ${pool} ${currencyLabel} pool has been added to your wallet.` : "The submitted result was resolved. Check your match and ledger details.", "match", matchId);
  }
}

export const arenaRouter = router({
  settings: router({
    rules: protectedProcedure.query(async () => {
      const db = await database();
      const settings = await getPlatformSettings(db);
      const walletConfig = getKesWalletConfig();
      const wageringEnabled = isKesWageringEnabled();
      return {
        challengeCreationEnabled: challengeCreationAllowed(settings.challengeCreationEnabled) && wageringEnabled,
        walletEnabled: Boolean(walletConfig),
        wageringEnabled,
        minimumStake: walletConfig?.minStake ?? STAKE_MIN,
        maximumStake: walletConfig?.maxStake ?? STAKE_MAX,
        defaultMatchMinutes: settings.defaultMatchMinutes,
        maintenanceNotice: settings.maintenanceNotice,
      };
    }),
  }),
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const db = await database();
    const [challengeRows, matchRows, notificationRows, profileRows] = await Promise.all([
      isKesWageringEnabled() ? db.select().from(challenges).where(and(eq(challenges.stakeCurrency, "KES"), eq(challenges.status, "open"), gt(challenges.expiresAt, new Date()), ne(challenges.creatorId, ctx.user.id), or(isNull(challenges.opponentId), eq(challenges.opponentId, ctx.user.id)))).limit(100) : Promise.resolve([]),
      db.select({ match: matches, participant: matchParticipants, challenge: challenges }).from(matchParticipants).innerJoin(matches, eq(matches.id, matchParticipants.matchId)).innerJoin(challenges, eq(challenges.id, matches.challengeId)).where(eq(matchParticipants.userId, ctx.user.id)).orderBy(desc(matches.createdAt)).limit(10),
      db.select().from(notifications).where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt))).orderBy(desc(notifications.createdAt)).limit(5),
      db.select().from(profiles).where(eq(profiles.userId, ctx.user.id)).limit(1),
    ]);
    const profile = profileRows[0];
    const compatible = challengeRows.filter(challenge => challenge.opponentId === ctx.user.id || (!!profile?.preferredGame && !!profile.gameEdition && !!profile.platform && areCompatible({
      gameA: challenge.game,
      gameB: profile.preferredGame,
      editionA: challenge.edition,
      editionB: profile.gameEdition,
      platformA: challenge.platform,
      platformB: profile.platform,
    })));
    return {
      openChallenges: compatible.length,
      incomingInvitations: compatible.filter(challenge => challenge.opponentId === ctx.user.id).length,
      matches: matchRows.map(row => ({ ...row.match, mySide: row.participant.side, myStake: row.participant.stake, stakeCurrency: row.challenge.stakeCurrency })),
      notifications: notificationRows,
      profile: profile ?? null,
    };
  }),
  players: router({
    list: protectedProcedure.input(z.object({ search: z.string().trim().max(24).optional(), game: gameSchema.optional(), platform: platformSchema.optional(), availability: z.enum(["available", "away"]).optional() }).optional()).query(async ({ ctx, input }) => {
      const db = await database();
      const filters = [ne(profiles.userId, ctx.user.id), eq(profiles.eligibility, "eligible" as const)];
      filters.push(eq(profiles.availability, input?.availability ?? "available"));
      if (input?.game) filters.push(eq(profiles.preferredGame, input.game));
      if (input?.platform) filters.push(eq(profiles.platform, input.platform));
      if (input?.search) filters.push(like(profiles.username, `%${input.search}%`));
      const [ownProfile] = await db.select().from(profiles).where(eq(profiles.userId, ctx.user.id)).limit(1);
      const rows = await db.select({ username: profiles.username, avatarColor: profiles.avatarColor, preferredGame: profiles.preferredGame, gameEdition: profiles.gameEdition, platform: profiles.platform, country: profiles.country, generalLocation: profiles.generalLocation, availability: profiles.availability, matchPreferences: profiles.matchPreferences }).from(profiles).where(and(...filters)).orderBy(desc(profiles.updatedAt)).limit(100);
      return rows.filter(row => !ownProfile?.preferredGame || !ownProfile.gameEdition || !ownProfile.platform || !row.preferredGame || !row.gameEdition || !row.platform || areCompatible({ gameA: row.preferredGame, gameB: ownProfile.preferredGame, editionA: row.gameEdition, editionB: ownProfile.gameEdition, platformA: row.platform, platformB: ownProfile.platform }));
    }),
  }),
  profile: router({
    me: protectedProcedure.query(async ({ ctx }) => {
      const db = await database();
      const rows = await db.select({ profile: profiles, user: users }).from(profiles).innerJoin(users, eq(users.id, profiles.userId)).where(eq(profiles.userId, ctx.user.id)).limit(1);
      if (!rows[0]) notFound();
      return { ...rows[0].profile, name: rows[0].user.name, role: rows[0].user.role };
    }),
    update: protectedProcedure.input(z.object({
      username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/).transform(value => value.toLowerCase()),
      preferredGame: gameSchema.nullable(),
      gameEdition: z.string().trim().max(48).nullable(),
      platform: platformSchema.nullable(),
      country: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).transform(value => value.toUpperCase()),
      generalLocation: z.string().trim().max(80).nullable(),
      availability: z.enum(["available", "away"]),
      matchPreferences: z.string().trim().max(500).nullable(),
      avatarColor: z.enum(["#B7F34A", "#69D6C4", "#A78BFA", "#60A5FA", "#F5A35B", "#F472B6"]),
    })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "profile_update", 20);
      const db = await database();
      try {
        await db.transaction(async tx => {
          await tx.update(profiles).set({ ...input, updatedAt: new Date() }).where(eq(profiles.userId, ctx.user.id));
          await tx.update(users).set({ name: input.username }).where(eq(users.id, ctx.user.id));
        });
      } catch (error) {
        if (String(error).includes("Duplicate entry") || String(error).includes("ER_DUP_ENTRY")) throw new TRPCError({ code: "CONFLICT", message: "That username is already taken." });
        throw error;
      }
      return { success: true };
    }),
  }),
  challenges: router({
    list: protectedProcedure.input(z.object({ game: gameSchema.optional(), edition: z.string().max(48).optional(), platform: platformSchema.optional(), stakeMin: z.number().int().min(0).optional(), stakeMax: z.number().int().min(0).optional(), availability: z.enum(["available", "away"]).optional() }).optional()).query(async ({ ctx, input }) => {
      if (!isKesWageringEnabled()) return [];
      const db = await database();
      const rows = await db.select({ challenge: challenges, creator: users, profile: profiles }).from(challenges).innerJoin(users, eq(users.id, challenges.creatorId)).innerJoin(profiles, eq(profiles.userId, challenges.creatorId)).where(and(eq(challenges.stakeCurrency, "KES"), eq(challenges.status, "open"), gt(challenges.expiresAt, new Date()), or(isNull(challenges.opponentId), eq(challenges.opponentId, ctx.user.id)))).orderBy(desc(challenges.createdAt)).limit(100);
      const ownProfileRows = await db.select().from(profiles).where(eq(profiles.userId, ctx.user.id)).limit(1);
      const ownProfile = ownProfileRows[0];
      return rows.filter(row => row.challenge.creatorId !== ctx.user.id &&
        (row.challenge.opponentId === ctx.user.id || row.profile.eligibility === "eligible") &&
        (row.challenge.opponentId === ctx.user.id || (!input?.availability ? row.profile.availability === "available" : row.profile.availability === input.availability)) &&
        (!input?.game || input.game === row.challenge.game) &&
        (!input?.edition || input.edition.toLowerCase() === row.challenge.edition.toLowerCase()) &&
        (!input?.platform || input.platform === row.challenge.platform) &&
        (input?.stakeMin === undefined || row.challenge.stake >= input.stakeMin) &&
        (input?.stakeMax === undefined || row.challenge.stake <= input.stakeMax) &&
        (row.challenge.opponentId === ctx.user.id || (!!ownProfile?.preferredGame && !!ownProfile.gameEdition && !!ownProfile.platform && areCompatible({ gameA: row.challenge.game, gameB: ownProfile.preferredGame, editionA: row.challenge.edition, editionB: ownProfile.gameEdition, platformA: row.challenge.platform, platformB: ownProfile.platform })))
      ).map(row => ({
        id: row.challenge.id,
        isInvitation: row.challenge.opponentId === ctx.user.id,
        game: row.challenge.game,
        edition: row.challenge.edition,
        platform: row.challenge.platform,
        stake: row.challenge.stake,
        matchMinutes: row.challenge.matchMinutes,
        settings: row.challenge.settings,
        description: row.challenge.description,
        status: row.challenge.status,
        expiresAt: row.challenge.expiresAt,
        createdAt: row.challenge.createdAt,
        creator: { username: row.profile.username, avatarColor: row.profile.avatarColor, availability: row.profile.availability },
      }));
    }),
    create: protectedProcedure.input(z.object({
      game: gameSchema,
      edition: z.string().trim().min(2).max(48),
      platform: platformSchema,
      stake: z.number().int(),
      matchMinutes: z.number().int().min(6).max(30).optional(),
      description: z.string().trim().max(500).optional(),
      expiryHours: z.number().int().min(1).max(72),
      settings: z.string().trim().max(500).optional(),
      inviteUsername: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/).transform(value => value.toLowerCase()).optional(),
    })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "challenge_create", 12);
      const walletConfig = getKesWalletConfig();
      if (!walletConfig || !isKesWageringEnabled()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "KES challenges are temporarily unavailable; the wallet and real-wagering settings are not enabled." });
      const db = await database();
      return db.transaction(async tx => {
        const arenaSettings = await getPlatformSettings(tx, true);
        if (!challengeCreationAllowed(arenaSettings.challengeCreationEnabled)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: arenaSettings.maintenanceNotice || "New challenges are temporarily paused by an administrator." });
        if (!validateStakeBounds(input.stake, walletConfig.minStake, walletConfig.maxStake)) throw new TRPCError({ code: "BAD_REQUEST", message: `Stake must be between KES ${walletConfig.minStake} and KES ${walletConfig.maxStake}.` });
        const matchMinutes = input.matchMinutes ?? arenaSettings.defaultMatchMinutes;
        const profile = await requireKesEligible(tx, ctx.user.id);
        await ensureNoActiveMatch(tx, ctx.user.id);
        if (profile.availability !== "available" || !profile.preferredGame || !profile.gameEdition || !profile.platform || !areCompatible({ gameA: input.game, gameB: profile.preferredGame, editionA: input.edition, editionB: profile.gameEdition, platformA: input.platform, platformB: profile.platform })) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Set your profile to Open to challenges and choose the same exact game edition and platform before publishing." });
        }
        let invitee: typeof profiles.$inferSelect | undefined;
        if (input.inviteUsername) {
          if (input.inviteUsername === profile.username) forbidden("You cannot send a challenge to yourself.");
          const [target] = await tx.select().from(profiles).where(eq(profiles.username, input.inviteUsername)).for("update").limit(1);
          if (!target || (!shouldForceKesFeatures() && (target.eligibility !== "eligible" || target.cashWalletStatus !== "verified")) || target.availability !== "available" || !target.preferredGame || !target.gameEdition || !target.platform || !areCompatible({ gameA: input.game, gameB: target.preferredGame, editionA: input.edition, editionB: target.gameEdition, platformA: input.platform, platformB: target.platform })) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "That player is not currently eligible, available, or compatible with the selected game edition and platform." });
          }
          const targetWallet = await ensureKesWalletAccount(tx, target.userId);
          if (targetWallet.frozen === 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "That player's KES wallet is frozen for administrator review." });
          invitee = target;
        }
        const wallet = await ensureKesWalletAccount(tx, ctx.user.id);
        if (wallet.availableKes < input.stake) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your available KES balance is too low for that stake." });
        const now = new Date();
        const id = insertId(await tx.insert(challenges).values({
          creatorId: ctx.user.id,
          opponentId: invitee?.userId ?? null,
          game: input.game,
          edition: input.edition,
          platform: input.platform,
          stake: input.stake,
          stakeCurrency: "KES",
          matchMinutes,
          settings: input.settings ?? null,
          description: input.description ?? null,
          status: "open",
          expiresAt: new Date(now.getTime() + input.expiryHours * 60 * 60_000),
        }));
        const availableAfter = wallet.availableKes - input.stake;
        const reservedAfter = wallet.reservedKes + input.stake;
        await tx.update(kesWalletAccounts).set({ availableKes: availableAfter, reservedKes: reservedAfter }).where(eq(kesWalletAccounts.userId, ctx.user.id));
        await recordWagerLedger(tx, "KES", { userId: ctx.user.id, challengeId: id, transactionType: "stake_reservation", amount: input.stake, availableBefore: wallet.availableKes, availableAfter, reservedBefore: wallet.reservedKes, reservedAfter, idempotencyKey: `challenge:${id}:stake`, reason: `Reserved KES ${input.stake} for challenge #${id}.` });
        if (invitee) await notify(tx, invitee.userId, "challenge_received", "Direct challenge received", `${profile.username} invited you to an exact-edition ${GAME_LABELS[input.game]} match on ${PLATFORM_LABELS[input.platform]}.`, "challenge", id);
        return { id };
      });
    }),
    accept: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "challenge_accept", 12);
      if (!isKesWageringEnabled()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "KES challenges are temporarily unavailable; real wagering is not enabled." });
      const db = await database();
      return db.transaction(async tx => {
        const rows = await tx.select().from(challenges).where(eq(challenges.id, input.id)).for("update").limit(1);
        const challenge = rows[0];
        if (!challenge || challenge.stakeCurrency !== "KES" || challenge.status !== "open" || challenge.expiresAt.getTime() <= Date.now()) notFound();
        if (challenge.creatorId === ctx.user.id) forbidden("You cannot accept your own challenge.");
        if (challenge.opponentId !== null && challenge.opponentId !== ctx.user.id) forbidden("This direct invitation is only visible to its invited player.");
        const creatorProfile = await requireKesEligible(tx, challenge.creatorId);
        const opponentProfile = await requireKesEligible(tx, ctx.user.id);
        if (!creatorProfile || creatorProfile.eligibility !== "eligible" || creatorProfile.availability !== "available") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The challenge creator is not currently eligible and available to play." });
        if (opponentProfile.availability !== "available") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Set your profile availability to open for challenges before accepting." });
        const creatorCompatible = !!creatorProfile.preferredGame && !!creatorProfile.gameEdition && !!creatorProfile.platform && areCompatible({ gameA: challenge.game, gameB: creatorProfile.preferredGame, editionA: challenge.edition, editionB: creatorProfile.gameEdition, platformA: challenge.platform, platformB: creatorProfile.platform });
        const opponentCompatible = !!opponentProfile.preferredGame && !!opponentProfile.gameEdition && !!opponentProfile.platform && areCompatible({ gameA: challenge.game, gameB: opponentProfile.preferredGame, editionA: challenge.edition, editionB: opponentProfile.gameEdition, platformA: challenge.platform, platformB: opponentProfile.platform });
        if (!creatorCompatible || !opponentCompatible) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Both players must have matching game editions and supported platform selections in their profiles." });
        const creatorWallet = await ensureKesWalletAccount(tx, challenge.creatorId);
        if (creatorWallet.reservedKes < challenge.stake) throw new Error("Challenge KES stake reservation is missing");
        const opponentWallet = await ensureKesWalletAccount(tx, ctx.user.id);
        await ensureNoActiveMatch(tx, challenge.creatorId);
        await ensureNoActiveMatch(tx, ctx.user.id);
        if (opponentWallet.availableKes < challenge.stake) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your available KES balance is too low for this stake." });
        const now = new Date();
        await tx.update(kesWalletAccounts).set({ availableKes: opponentWallet.availableKes - challenge.stake, reservedKes: opponentWallet.reservedKes + challenge.stake }).where(eq(kesWalletAccounts.userId, ctx.user.id));
        await recordWagerLedger(tx, "KES", { userId: ctx.user.id, challengeId: challenge.id, transactionType: "stake_reservation", amount: challenge.stake, availableBefore: opponentWallet.availableKes, availableAfter: opponentWallet.availableKes - challenge.stake, reservedBefore: opponentWallet.reservedKes, reservedAfter: opponentWallet.reservedKes + challenge.stake, idempotencyKey: `challenge:${challenge.id}:accept:${ctx.user.id}`, reason: `Reserved KES ${challenge.stake} to accept challenge #${challenge.id}.` });
        await tx.update(challenges).set({ status: "accepted", opponentId: ctx.user.id, acceptedAt: now }).where(eq(challenges.id, challenge.id));
        const matchId = insertId(await tx.insert(matches).values({ challengeId: challenge.id, status: "AWAITING_STAKES", acceptedAt: now, stakesReservedAt: now, readyDeadline: new Date(now.getTime() + READY_WINDOW_MS) }));
        await tx.insert(matchStateEvents).values({ matchId, fromState: "ACCEPTED", toState: "AWAITING_STAKES", actorUserId: ctx.user.id, reason: `Challenge #${challenge.id} accepted; the participants' stakes are reserved.` });
        await tx.insert(matchParticipants).values([
          { matchId, userId: challenge.creatorId, side: "home", stake: challenge.stake },
          { matchId, userId: ctx.user.id, side: "away", stake: challenge.stake },
        ]);
        await notify(tx, challenge.creatorId, "challenge_accepted", "Challenge accepted", `Your ${GAME_LABELS[challenge.game]} challenge is matched. Confirm the terms and get ready.`, "match", matchId);
        await notify(tx, ctx.user.id, "stake_reserved", "Stake reserved", `KES ${challenge.stake} is reserved. Review the terms in your private match room.`, "match", matchId);
        return { matchId };
      });
    }),
    decline: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "challenge_decline", 12);
      const db = await database();
      return db.transaction(async tx => {
        const rows = await tx.select().from(challenges).where(eq(challenges.id, input.id)).for("update").limit(1);
        const challenge = rows[0];
        if (!challenge || challenge.status !== "open") notFound();
        if (challenge.opponentId !== ctx.user.id) forbidden("Only the intended recipient can decline a direct invitation.");
        await refundOpenChallenge(tx, challenge, `challenge:${challenge.id}:decline`, `Direct challenge #${challenge.id} declined by its invited player; creator's reservation returned.`);
        await tx.update(challenges).set({ status: "rejected" }).where(eq(challenges.id, challenge.id));
        await notify(tx, challenge.creatorId, "challenge_rejected", "Direct challenge declined", `Your invitation to challenge #${challenge.id} was declined. Its reserved stake was returned.`, "challenge", challenge.id);
        return { success: true };
      });
    }),
    cancel: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "challenge_cancel", 12);
      const db = await database();
      return db.transaction(async tx => {
        const rows = await tx.select().from(challenges).where(eq(challenges.id, input.id)).for("update").limit(1);
        const challenge = rows[0];
        if (!challenge) notFound();
        if (challenge.creatorId !== ctx.user.id || challenge.status !== "open") forbidden("Only the owner may cancel an open challenge.");
        await refundOpenChallenge(tx, challenge, `challenge:${challenge.id}:cancel`, `Open challenge #${challenge.id} cancelled; creator's reservation released.`);
        await tx.update(challenges).set({ status: "cancelled" }).where(eq(challenges.id, challenge.id));
        await notify(tx, ctx.user.id, "challenge_cancelled", "Challenge cancelled", challenge.stakeCurrency === "KES" ? `Your KES ${challenge.stake} reservation has been returned.` : "Your historical demo reservation has been returned.", "challenge", challenge.id);
        if (challenge.opponentId) await notify(tx, challenge.opponentId, "challenge_cancelled", "Challenge invitation cancelled", `Challenge #${challenge.id} was cancelled by its creator.`, "challenge", challenge.id);
        return { success: true };
      });
    }),
    details: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await database();
      const rows = await db.select({ challenge: challenges, creatorProfile: profiles, creator: users }).from(challenges).innerJoin(profiles, eq(profiles.userId, challenges.creatorId)).innerJoin(users, eq(users.id, challenges.creatorId)).where(eq(challenges.id, input.id)).limit(1);
      const row = rows[0];
      if (!row) notFound();
      if (!canViewChallengeDetails(row.challenge, ctx.user.id)) forbidden();
      const { creatorId, opponentId, ...publicChallenge } = row.challenge;
      const [inviteeProfile] = opponentId ? await db.select({ username: profiles.username }).from(profiles).where(eq(profiles.userId, opponentId)).limit(1) : [];
      return { ...publicChallenge, isOwner: creatorId === ctx.user.id, isDirectInvitation: opponentId !== null, isInvitationForYou: opponentId === ctx.user.id && row.challenge.status === "open", inviteTarget: inviteeProfile?.username ?? null, creator: { username: row.creatorProfile.username, avatarColor: row.creatorProfile.avatarColor, availability: row.creatorProfile.availability } };
    }),
  }),
  matches: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await database();
      const rows = await db.select({ match: matches, participant: matchParticipants, challenge: challenges }).from(matchParticipants).innerJoin(matches, eq(matches.id, matchParticipants.matchId)).innerJoin(challenges, eq(challenges.id, matches.challengeId)).where(eq(matchParticipants.userId, ctx.user.id)).orderBy(desc(matches.createdAt)).limit(100);
      return Promise.all(rows.map(async row => {
        const opponents = await db.select({ username: profiles.username, avatarColor: profiles.avatarColor }).from(matchParticipants).innerJoin(profiles, eq(profiles.userId, matchParticipants.userId)).where(and(eq(matchParticipants.matchId, row.match.id), ne(matchParticipants.userId, ctx.user.id))).limit(1);
        return { ...row.match, game: row.challenge.game, edition: row.challenge.edition, platform: row.challenge.platform, stake: row.challenge.stake, stakeCurrency: row.challenge.stakeCurrency, opponent: opponents[0] ?? null };
      }));
    }),
    details: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await database();
      const matchRows = await db.select({ match: matches, challenge: challenges }).from(matches).innerJoin(challenges, eq(challenges.id, matches.challengeId)).where(eq(matches.id, input.id)).limit(1);
      const data = matchRows[0];
      if (!data) notFound();
      const participants = await db.select({ participant: matchParticipants, username: profiles.username, avatarColor: profiles.avatarColor, platform: profiles.platform, game: profiles.preferredGame, edition: profiles.gameEdition }).from(matchParticipants).innerJoin(profiles, eq(profiles.userId, matchParticipants.userId)).where(eq(matchParticipants.matchId, input.id)).orderBy(matchParticipants.id);
      if (!participants.some(row => row.participant.userId === ctx.user.id) && ctx.user.role !== "admin") forbidden();
      const participantByUser = new Map(participants.map(row => [row.participant.userId, row]));
      const isAdmin = ctx.user.role === "admin";
      const codes = await db.select().from(matchCodes).where(eq(matchCodes.matchId, input.id));
      const evidence = await db.select().from(matchEvidence).where(eq(matchEvidence.matchId, input.id));
      const recordingRows = await db.select({ id: matchRecordings.id, userId: matchRecordings.userId, mimeType: matchRecordings.mimeType, sizeBytes: matchRecordings.sizeBytes, uploadedAt: matchRecordings.uploadedAt, expiresAt: matchRecordings.expiresAt, username: profiles.username, side: matchParticipants.side })
        .from(matchRecordings).innerJoin(profiles, eq(profiles.userId, matchRecordings.userId))
        .innerJoin(matchParticipants, and(eq(matchParticipants.matchId, matchRecordings.matchId), eq(matchParticipants.userId, matchRecordings.userId)))
        .where(eq(matchRecordings.matchId, input.id));
      const activeEvidence = evidence.map(item => {
        const owner = participantByUser.get(item.userId);
        return { id: item.id, side: owner?.participant.side, username: owner?.username ?? "Participant", isMine: item.userId === ctx.user.id, mimeType: item.mimeType, sizeBytes: item.sizeBytes, scoreFor: item.scoreFor, scoreAgainst: item.scoreAgainst, comments: item.comments, submittedAt: item.submittedAt, url: `/api/evidence/${item.id}` };
      });
      const disputeRows = await db.select().from(disputes).where(eq(disputes.matchId, input.id)).orderBy(desc(disputes.createdAt));
      const stateHistory = await db.select().from(matchStateEvents).where(eq(matchStateEvents.matchId, input.id)).orderBy(matchStateEvents.createdAt);
      const disputeIds = disputeRows.map(dispute => dispute.id);
      const privateAttachments = disputeIds.length ? await db.select().from(disputeAttachments).where(inArray(disputeAttachments.disputeId, disputeIds)) : [];
      return {
        ...data.match,
        game: data.challenge.game,
        gameLabel: GAME_LABELS[data.challenge.game],
        edition: data.challenge.edition,
        platform: data.challenge.platform,
        platformLabel: PLATFORM_LABELS[data.challenge.platform],
        stake: data.challenge.stake,
        stakeCurrency: data.challenge.stakeCurrency,
        matchMinutes: data.challenge.matchMinutes,
        settings: data.challenge.settings,
        description: data.challenge.description,
        participants: participants.map(row => ({ side: row.participant.side, stake: row.participant.stake, readyAt: row.participant.readyAt, scoreFor: row.participant.scoreFor, scoreAgainst: row.participant.scoreAgainst, isMe: row.participant.userId === ctx.user.id, ...(isAdmin ? { userId: row.participant.userId } : {}), username: row.username, avatarColor: row.avatarColor, platform: row.platform, game: row.game, edition: row.edition })),
        codes: codes.map(code => ({ id: code.id, side: participantByUser.get(code.userId)?.participant.side, isMine: code.userId === ctx.user.id, code: code.code, updatedAt: code.updatedAt })),
        evidence: activeEvidence,
        recordings: recordingRows.map(recording => ({ id: recording.id, username: recording.username, side: recording.side, mimeType: recording.mimeType, sizeBytes: recording.sizeBytes, uploadedAt: recording.uploadedAt, expiresAt: recording.expiresAt, isMine: recording.userId === ctx.user.id, ...((recording.userId === ctx.user.id || (isAdmin && data.match.status === "UNDER_REVIEW")) ? { url: `/api/match-recordings/${recording.id}` } : {}) })),
        disputes: disputeRows.map(dispute => ({ id: dispute.id, reason: dispute.reason, explanation: dispute.explanation, status: dispute.status, administrativeNotes: dispute.administrativeNotes, resolutionReason: dispute.resolutionReason, resolvedAt: dispute.resolvedAt, createdAt: dispute.createdAt, isMine: dispute.openedBy === ctx.user.id, attachments: privateAttachments.filter(attachment => attachment.disputeId === dispute.id).map(attachment => ({ id: attachment.id, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, createdAt: attachment.createdAt, url: `/api/dispute-evidence/${attachment.id}` })) })),
        stateHistory: stateHistory.map(event => ({ fromState: event.fromState, toState: event.toState, reason: event.reason, createdAt: event.createdAt })),
      };
    }),
    ready: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "match_ready", 20);
      const db = await database();
      return db.transaction(async tx => {
        const matchRows = await tx.select().from(matches).where(eq(matches.id, input.id)).for("update").limit(1);
        const match = matchRows[0];
        if (!match) notFound();
        const readyStates: string[] = ["AWAITING_STAKES", "READY", "IN_PROGRESS"];
        if (!readyStates.includes(match.status)) throw new TRPCError({ code: "CONFLICT", message: "This match is not accepting readiness confirmations." });
        const participants = await getParticipants(tx, input.id);
        const self = participants.find((person: any) => person.userId === ctx.user.id);
        if (!self) forbidden();
        if (self.readyAt) return { success: true, started: match.status === "IN_PROGRESS" };
        await tx.update(matchParticipants).set({ readyAt: new Date() }).where(eq(matchParticipants.id, self.id));
        const nowAll = participants.map((person: any) => person.userId === ctx.user.id ? { ...person, readyAt: new Date() } : person);
        if (nowAll.length === 2 && nowAll.every((person: any) => person.readyAt)) {
          const [challenge] = await tx.select().from(challenges).where(eq(challenges.id, match.challengeId)).limit(1);
          const startedAt = new Date();
          const expectedEndAt = new Date(startedAt.getTime() + (challenge?.matchMinutes ?? 12) * 60_000);
          const readyMatch = await transitionMatch(tx, match, "READY", {}, ctx.user.id, "Both match participants confirmed readiness.");
          await transitionMatch(tx, readyMatch, "IN_PROGRESS", { startedAt, expectedEndAt }, ctx.user.id, "Server match timer started after both readiness confirmations.");
          for (const person of nowAll) await notify(tx, person.userId, "match_started", "Kickoff", "Both players confirmed readiness. Your server-timed match has started.", "match", input.id);
          return { success: true, started: true, expectedEndAt };
        }
        const opponent = participants.find((person: any) => person.userId !== ctx.user.id);
        if (opponent) await notify(tx, opponent.userId, "opponent_ready", "Opponent is ready", "Your opponent has confirmed readiness. Confirm yours in the match room.", "match", input.id);
        return { success: true, started: false };
      });
    }),
    saveCode: protectedProcedure.input(z.object({ id: z.number().int().positive(), code: z.string().trim().min(1).max(160) })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "match_code", 30);
      const db = await database();
      const [match] = await db.select().from(matches).where(eq(matches.id, input.id)).limit(1);
      if (!match || !["AWAITING_STAKES", "READY", "IN_PROGRESS"].includes(match.status)) throw new TRPCError({ code: "CONFLICT", message: "Room codes can only be exchanged before or during an active match." });
      const participants = await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, input.id));
      if (!participants.some(row => row.userId === ctx.user.id)) forbidden();
      await db.insert(matchCodes).values({ matchId: input.id, userId: ctx.user.id, code: input.code }).onDuplicateKeyUpdate({ set: { code: input.code, updatedAt: new Date() } });
      const opponent = participants.find(row => row.userId !== ctx.user.id);
      if (opponent) await db.insert(notifications).values({ userId: opponent.userId, type: "match_code", title: "Match code updated", body: "Your opponent added or changed the private in-game room code.", entityType: "match", entityId: input.id });
      return { success: true };
    }),
    finish: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "match_finish", 12);
      const db = await database();
      return db.transaction(async tx => {
        const rows = await tx.select().from(matches).where(eq(matches.id, input.id)).for("update").limit(1);
        const match = rows[0];
        if (!match || match.status !== "IN_PROGRESS") throw new TRPCError({ code: "CONFLICT", message: "Only an in-progress match can be marked finished." });
        const participants = await getParticipants(tx, input.id);
        if (!participants.some((person: any) => person.userId === ctx.user.id)) forbidden();
        const now = new Date();
        const deadline = new Date(now.getTime() + EVIDENCE_WINDOW_MS);
        await transitionMatch(tx, match, "AWAITING_EVIDENCE", { reportedEndAt: now, evidenceDeadline: deadline }, ctx.user.id, "A participant reported the match finished; the five-minute server evidence window began.");
        await tx.update(matchRecordings).set({ expiresAt: deadline }).where(eq(matchRecordings.matchId, input.id));
        for (const person of participants) await notify(tx, person.userId, "evidence_deadline", "Five-minute evidence window", "Submit your final-score screenshot and reported score before the server deadline.", "match", input.id);
        return { success: true, evidenceDeadline: deadline };
      });
    }),
    submitEvidence: protectedProcedure.input(z.object({
      id: z.number().int().positive(),
      imageBase64: z.string().min(100).max(7_000_000),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      scoreFor: z.number().int().min(0).max(99),
      scoreAgainst: z.number().int().min(0).max(99),
      comments: z.string().trim().max(1000).optional(),
    })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "match_evidence", 10);
      if (!validateScorePair(input.scoreFor, input.scoreAgainst)) throw new TRPCError({ code: "BAD_REQUEST", message: "Scores must be whole numbers between 0 and 99." });
      const db = await database();
      const bytes = Buffer.from(input.imageBase64, "base64");
      if (bytes.length < 64 || bytes.length > 5 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Screenshot must be 64 bytes to 5 MB." });
      const validMagic = input.mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : input.mimeType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
      if (!validMagic) throw new TRPCError({ code: "BAD_REQUEST", message: "The screenshot content does not match its image type." });
      const [initialMatch] = await db.select().from(matches).where(eq(matches.id, input.id)).limit(1);
      if (!initialMatch) notFound();
      const participantRows = await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, input.id));
      if (!participantRows.some(row => row.userId === ctx.user.id)) forbidden();
      if (initialMatch.status !== "AWAITING_EVIDENCE" || !initialMatch.evidenceDeadline || initialMatch.evidenceDeadline.getTime() < Date.now()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The evidence window is closed. The match has been or will be placed in review." });
      const storageKey = await storePrivateEvidence(input.id, bytes, input.mimeType);
      return db.transaction(async tx => {
        const rows = await tx.select().from(matches).where(eq(matches.id, input.id)).for("update").limit(1);
        const match = rows[0];
        if (!match || match.status !== "AWAITING_EVIDENCE" || !match.evidenceDeadline || match.evidenceDeadline.getTime() < Date.now()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The evidence window expired before upload completed." });
        const participants = await getParticipants(tx, input.id);
        if (!participants.some((person: any) => person.userId === ctx.user.id)) forbidden();
        const existing = await tx.select().from(matchEvidence).where(and(eq(matchEvidence.matchId, input.id), eq(matchEvidence.userId, ctx.user.id))).limit(1);
        if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Evidence has already been submitted for this player." });
        await tx.insert(matchEvidence).values({ matchId: input.id, userId: ctx.user.id, storageKey, mimeType: input.mimeType, sizeBytes: bytes.length, scoreFor: input.scoreFor, scoreAgainst: input.scoreAgainst, comments: input.comments ?? null, submittedAt: new Date() });
        await tx.update(matchParticipants).set({ scoreFor: input.scoreFor, scoreAgainst: input.scoreAgainst }).where(and(eq(matchParticipants.matchId, input.id), eq(matchParticipants.userId, ctx.user.id)));
        const allEvidence = await tx.select().from(matchEvidence).where(eq(matchEvidence.matchId, input.id));
        if (allEvidence.length === 2) {
          const [first, second] = allEvidence;
          const reportsAgree = first.scoreFor === second.scoreAgainst && first.scoreAgainst === second.scoreFor;
          if (!reportsAgree) {
            const reason = "Participants submitted conflicting final-score reports. Settlement is frozen for human review.";
            await transitionMatch(tx, match, "UNDER_REVIEW", { disputeReason: reason }, null, reason);
            await tx.update(matchRecordings).set({ expiresAt: null }).where(eq(matchRecordings.matchId, input.id));
            const duplicate = await tx.select().from(disputes).where(and(eq(disputes.matchId, input.id), eq(disputes.status, "OPEN"))).limit(1);
            if (!duplicate.length) await tx.insert(disputes).values({ matchId: input.id, openedBy: ctx.user.id, reason: "conflicting_scores", explanation: reason, status: "OPEN" });
            for (const person of participants) await notify(tx, person.userId, "match_under_review", "Result under review", "Score reports do not agree. Stakes remain reserved while an administrator reviews the match.", "match", input.id);
            return { success: true, status: "UNDER_REVIEW" as const };
          }
          const firstParticipant = participants.find((person: any) => person.userId === first.userId);
          const secondParticipant = participants.find((person: any) => person.userId === second.userId);
          if (!firstParticipant || !secondParticipant) throw new Error("Evidence submitter is not a match participant");
          const winner = first.scoreFor === first.scoreAgainst ? null : first.scoreFor > first.scoreAgainst ? first.userId : second.userId;
          await settleScores(tx, input.id, participants, winner, "Both participant score reports agree; screenshots remain evidence and are not independently authenticated.");
          return { success: true, status: winner === null ? "DRAWN" as const : "COMPLETED" as const };
        }
        const opponent = participants.find((person: any) => person.userId !== ctx.user.id);
        if (opponent) await notify(tx, opponent.userId, "evidence_submitted", "Opponent submitted evidence", "Your opponent submitted a reported score and screenshot. Submit yours before the deadline.", "match", input.id);
        return { success: true, status: "AWAITING_EVIDENCE" as const };
      });
    }),
    openDispute: protectedProcedure.input(z.object({ id: z.number().int().positive(), reason: z.enum(["conflicting_scores", "missing_evidence", "incorrect_screenshot", "disconnect", "wrong_settings", "suspected_cheating", "other"]), explanation: z.string().trim().min(10).max(3000), imageBase64: z.string().min(100).max(7_000_000).optional(), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional() })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "dispute_open", 8);
      const db = await database();
      if (Boolean(input.imageBase64) !== Boolean(input.mimeType)) throw new TRPCError({ code: "BAD_REQUEST", message: "Select both a supported screenshot and its image type." });
      let attachmentBytes: Buffer | null = null;
      if (input.imageBase64 && input.mimeType) {
        attachmentBytes = Buffer.from(input.imageBase64, "base64");
        if (attachmentBytes.length < 64 || attachmentBytes.length > 5 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Dispute screenshot must be 64 bytes to 5 MB." });
        const validMagic = input.mimeType === "image/png" ? attachmentBytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : input.mimeType === "image/jpeg" ? attachmentBytes[0] === 0xff && attachmentBytes[1] === 0xd8 && attachmentBytes[2] === 0xff : attachmentBytes.toString("ascii", 0, 4) === "RIFF" && attachmentBytes.toString("ascii", 8, 12) === "WEBP";
        if (!validMagic) throw new TRPCError({ code: "BAD_REQUEST", message: "The dispute attachment content does not match its image type." });
      }
      return db.transaction(async tx => {
        const rows = await tx.select().from(matches).where(eq(matches.id, input.id)).for("update").limit(1);
        const match = rows[0];
        if (!match) notFound();
        const participants = await getParticipants(tx, input.id);
        if (!participants.some((person: any) => person.userId === ctx.user.id)) forbidden();
        if (["COMPLETED", "DRAWN", "CANCELLED", "REFUNDED"].includes(match.status)) throw new TRPCError({ code: "CONFLICT", message: "This match is already finalized; a new dispute cannot alter a settled ledger." });
        const existing = await tx.select().from(disputes).where(and(eq(disputes.matchId, input.id), inArray(disputes.status, ["OPEN", "INVESTIGATING"]))).limit(1);
        if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "An active dispute already exists for this match." });
        const id = insertId(await tx.insert(disputes).values({ matchId: input.id, openedBy: ctx.user.id, reason: input.reason, explanation: input.explanation, status: "OPEN" }));
        if (match.status !== "UNDER_REVIEW") await transitionMatch(tx, match, "UNDER_REVIEW", { disputeReason: input.explanation.slice(0, 500) }, ctx.user.id, `Participant dispute opened: ${input.reason}.`);
        await tx.update(matchRecordings).set({ expiresAt: null }).where(eq(matchRecordings.matchId, input.id));
        if (attachmentBytes && input.mimeType) {
          const storageKey = await storePrivateEvidence(input.id, attachmentBytes, input.mimeType);
          await tx.insert(disputeAttachments).values({ disputeId: id, userId: ctx.user.id, storageKey, mimeType: input.mimeType, sizeBytes: attachmentBytes.length });
        }
        for (const person of participants) await notify(tx, person.userId, "dispute_updated", "Match under review", "A participant opened a dispute. Stakes remain reserved pending a reasoned decision.", "dispute", id);
        return { id };
      });
    }),
  }),
  notifications: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await database();
      return db.select().from(notifications).where(eq(notifications.userId, ctx.user.id)).orderBy(desc(notifications.createdAt)).limit(100);
    }),
    markRead: protectedProcedure.input(z.object({ id: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
      const db = await database();
      await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, ctx.user.id), input.id ? eq(notifications.id, input.id) : isNull(notifications.readAt)));
      return { success: true };
    }),
  }),
  disputes: router({
    listMine: protectedProcedure.query(async ({ ctx }) => {
      const db = await database();
      const participantMatches = await db.select({ matchId: matchParticipants.matchId }).from(matchParticipants).where(eq(matchParticipants.userId, ctx.user.id));
      const matchIds = participantMatches.map(row => row.matchId);
      if (!matchIds.length) return [];
      return db.select({ id: disputes.id, matchId: disputes.matchId, reason: disputes.reason, explanation: disputes.explanation, status: disputes.status, administrativeNotes: disputes.administrativeNotes, resolutionReason: disputes.resolutionReason, resolvedAt: disputes.resolvedAt, createdAt: disputes.createdAt, updatedAt: disputes.updatedAt }).from(disputes).where(inArray(disputes.matchId, matchIds)).orderBy(desc(disputes.createdAt));
    }),
    detail: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await database();
      const [dispute] = await db.select().from(disputes).where(eq(disputes.id, input.id)).limit(1);
      if (!dispute) notFound();
      const [participant] = await db.select().from(matchParticipants).where(and(eq(matchParticipants.matchId, dispute.matchId), eq(matchParticipants.userId, ctx.user.id))).limit(1);
      if (!participant && ctx.user.role !== "admin") forbidden();
      const attachments = await db.select({ id: disputeAttachments.id, mimeType: disputeAttachments.mimeType, sizeBytes: disputeAttachments.sizeBytes, createdAt: disputeAttachments.createdAt }).from(disputeAttachments).where(eq(disputeAttachments.disputeId, dispute.id));
      return { id: dispute.id, matchId: dispute.matchId, reason: dispute.reason, explanation: dispute.explanation, status: dispute.status, administrativeNotes: dispute.administrativeNotes, resolutionReason: dispute.resolutionReason, resolvedAt: dispute.resolvedAt, createdAt: dispute.createdAt, updatedAt: dispute.updatedAt, attachments: attachments.map(attachment => ({ ...attachment, url: `/api/dispute-evidence/${attachment.id}` })) };
    }),
  }),
  admin: router({
    settings: adminProcedure.query(async () => {
      const db = await database();
      const settings = await getPlatformSettings(db);
      const walletConfig = getKesWalletConfig();
      return {
        challengeCreationEnabled: challengeCreationAllowed(settings.challengeCreationEnabled) && isKesWageringEnabled(),
        walletEnabled: Boolean(walletConfig),
        wageringEnabled: isKesWageringEnabled(),
        minimumStake: walletConfig?.minStake ?? null,
        maximumStake: walletConfig?.maxStake ?? null,
        defaultMatchMinutes: settings.defaultMatchMinutes,
        maintenanceNotice: settings.maintenanceNotice,
      };
    }),
    updateSettings: adminProcedure.input(z.object({
      challengeCreationEnabled: z.boolean(),
      defaultMatchMinutes: z.number().int().min(6).max(30),
      maintenanceNotice: z.string().trim().max(400).nullable(),
      reason: z.string().trim().min(10).max(2000),
    })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "admin_platform_settings", 20);
      const db = await database();
      return db.transaction(async tx => {
        const current = await getPlatformSettings(tx, true);
        const values = {
          challengeCreationEnabled: input.challengeCreationEnabled ? 1 : 0,
          defaultMatchMinutes: input.defaultMatchMinutes,
          maintenanceNotice: input.maintenanceNotice || null,
          updatedBy: ctx.user.id,
        };
        if (current.id === 0) await tx.insert(platformSettings).values({ id: 1, ...values });
        else await tx.update(platformSettings).set(values).where(eq(platformSettings.id, 1));
        await tx.insert(adminAuditLogs).values({
          adminUserId: ctx.user.id,
          action: "update_platform_settings",
          entityType: "platform_settings",
          entityId: 1,
          reason: input.reason,
          details: JSON.stringify({
            from: { challengeCreationEnabled: current.challengeCreationEnabled === 1, defaultMatchMinutes: current.defaultMatchMinutes, maintenanceNotice: current.maintenanceNotice },
            to: { challengeCreationEnabled: input.challengeCreationEnabled, defaultMatchMinutes: input.defaultMatchMinutes, maintenanceNotice: input.maintenanceNotice || null },
          }),
        });
        return { success: true };
      });
    }),
    overview: adminProcedure.query(async () => {
      const db = await database();
      const [underReview, openDisputes, recentAudit, accounts, recentTransactions, historicalDemoTransactions] = await Promise.all([
        db.select().from(matches).where(eq(matches.status, "UNDER_REVIEW")).orderBy(desc(matches.createdAt)).limit(50),
        db.select().from(disputes).where(inArray(disputes.status, ["OPEN", "INVESTIGATING"])).orderBy(desc(disputes.createdAt)).limit(50),
        db.select().from(adminAuditLogs).orderBy(desc(adminAuditLogs.createdAt)).limit(30),
        db.select({ userId: profiles.userId, username: profiles.username, country: profiles.country, availability: profiles.availability, eligibility: profiles.eligibility, cashWalletStatus: profiles.cashWalletStatus, role: users.role, createdAt: profiles.createdAt, availableKes: kesWalletAccounts.availableKes, reservedKes: kesWalletAccounts.reservedKes, frozen: kesWalletAccounts.frozen, freezeReason: kesWalletAccounts.freezeReason }).from(profiles).innerJoin(users, eq(users.id, profiles.userId)).leftJoin(kesWalletAccounts, eq(kesWalletAccounts.userId, profiles.userId)).orderBy(desc(profiles.createdAt)).limit(200),
        db.select({ username: profiles.username, transaction: kesWalletTransactions }).from(kesWalletTransactions).innerJoin(profiles, eq(profiles.userId, kesWalletTransactions.userId)).orderBy(desc(kesWalletTransactions.createdAt)).limit(100),
        db.select({ username: profiles.username, transaction: walletTransactions }).from(walletTransactions).innerJoin(profiles, eq(profiles.userId, walletTransactions.userId)).orderBy(desc(walletTransactions.createdAt)).limit(100),
      ]);
      return { underReview, openDisputes, recentAudit, accounts, recentTransactions, historicalDemoTransactions };
    }),
    disputes: adminProcedure.query(async () => {
      const db = await database();
      return db.select({ dispute: disputes, match: matches }).from(disputes).innerJoin(matches, eq(matches.id, disputes.matchId)).orderBy(desc(disputes.createdAt)).limit(100);
    }),
    resolve: adminProcedure.input(z.object({ disputeId: z.number().int().positive(), decision: z.enum(["player_one_wins", "player_two_wins", "draw", "refund"]), reason: z.string().trim().min(10).max(2000) })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "admin_resolve", 20);
      const db = await database();
      return db.transaction(async tx => {
        const disputeRows = await tx.select().from(disputes).where(eq(disputes.id, input.disputeId)).for("update").limit(1);
        const dispute = disputeRows[0];
        if (!dispute || !canTransitionDispute(dispute.status, "RESOLVED")) throw new TRPCError({ code: "CONFLICT", message: "This dispute is already closed." });
        const matchRows = await tx.select().from(matches).where(eq(matches.id, dispute.matchId)).for("update").limit(1);
        const match = matchRows[0];
        if (!match || match.status !== "UNDER_REVIEW") throw new TRPCError({ code: "CONFLICT", message: "The match is not awaiting a review decision." });
        const participants = await getParticipants(tx, match.id);
        if (input.decision === "refund") {
          await refundStakes(tx, match.id, participants, `Administrative refund: ${input.reason}`);
        } else {
          const winner = input.decision === "draw" ? null : participants[input.decision === "player_one_wins" ? 0 : 1]?.userId;
          if (input.decision !== "draw" && !winner) throw new Error("Administrative winner selection failed");
          await settleScores(tx, match.id, participants, winner ?? null, `Administrative resolution: ${input.reason}`, ctx.user.id);
        }
        await tx.update(disputes).set({ status: "RESOLVED", resolutionReason: input.reason, resolvedBy: ctx.user.id, resolvedAt: new Date() }).where(eq(disputes.id, dispute.id));
        await tx.update(matchRecordings).set({ expiresAt: new Date(Date.now() + EVIDENCE_WINDOW_MS) }).where(eq(matchRecordings.matchId, match.id));
        await tx.insert(adminAuditLogs).values({ adminUserId: ctx.user.id, action: "resolve_dispute", entityType: "dispute", entityId: dispute.id, reason: input.reason, details: JSON.stringify({ decision: input.decision, matchId: match.id }) });
        return { success: true };
      });
    }),
    setDisputeStatus: adminProcedure.input(z.object({ id: z.number().int().positive(), status: z.enum(["INVESTIGATING", "REJECTED"]), reason: z.string().trim().min(10).max(2000) })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "admin_dispute_status", 30);
      const db = await database();
      return db.transaction(async tx => {
        const disputeRows = await tx.select().from(disputes).where(eq(disputes.id, input.id)).for("update").limit(1);
        const dispute = disputeRows[0];
        if (!dispute || !canTransitionDispute(dispute.status, input.status)) throw new TRPCError({ code: "CONFLICT", message: "This dispute is already closed or cannot change to that status." });
        const matchRows = await tx.select().from(matches).where(eq(matches.id, dispute.matchId)).for("update").limit(1);
        const match = matchRows[0];
        if (!match || match.status !== "UNDER_REVIEW") throw new TRPCError({ code: "CONFLICT", message: "The associated match is not awaiting review." });
        const participants = await getParticipants(tx, match.id);
        if (participants.length !== 2) throw new TRPCError({ code: "CONFLICT", message: "The reviewed match does not have two valid participants." });
        if (input.status === "REJECTED") await refundStakes(tx, match.id, participants, `Dispute rejected and match refunded: ${input.reason}`);
        await tx.update(disputes).set({
          status: input.status,
          administrativeNotes: input.reason,
          ...(input.status === "REJECTED" ? { resolutionReason: input.reason, resolvedBy: ctx.user.id, resolvedAt: new Date() } : {}),
        }).where(eq(disputes.id, input.id));
        if (input.status === "REJECTED") await tx.update(matchRecordings).set({ expiresAt: new Date(Date.now() + EVIDENCE_WINDOW_MS) }).where(eq(matchRecordings.matchId, match.id));
        await tx.insert(adminAuditLogs).values({ adminUserId: ctx.user.id, action: input.status === "REJECTED" ? "reject_dispute_refund_match" : "investigate_dispute", entityType: "dispute", entityId: input.id, reason: input.reason, details: JSON.stringify({ matchId: match.id }) });
        for (const person of participants) {
          await notify(tx, person.userId, "dispute_updated", input.status === "REJECTED" ? "Dispute rejected" : "Dispute investigation started", input.reason, "dispute", input.id);
          if (input.status === "REJECTED") await notify(tx, person.userId, "match_cancelled", "Match refunded", "The dispute was rejected with a documented reason; each player's own reserved stake was returned.", "match", match.id);
        }
        return { success: true };
      });
    }),
    setEligibility: adminProcedure.input(z.object({ userId: z.number().int().positive(), status: z.enum(["eligible", "review", "suspended"]), reason: z.string().trim().min(10).max(2000) })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "admin_eligibility", 30);
      const db = await database();
      const [profile] = await db.select().from(profiles).where(eq(profiles.userId, input.userId)).limit(1);
      if (!profile) notFound();
      await db.transaction(async tx => {
        await tx.update(profiles).set({ eligibility: input.status }).where(eq(profiles.userId, input.userId));
        await tx.insert(adminAuditLogs).values({ adminUserId: ctx.user.id, action: "change_account_eligibility", entityType: "user", entityId: input.userId, reason: input.reason, details: JSON.stringify({ from: profile.eligibility, to: input.status }) });
      });
      return { success: true };
    }),
    setRole: adminProcedure.input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "admin"]), reason: z.string().trim().min(10).max(2000) })).mutation(async ({ ctx, input }) => {
      limitUserAction(ctx, "admin_role", 20);
      if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot change your own administrator role." });
      const db = await database();
      return db.transaction(async tx => {
        const targetRows = await tx.select().from(users).where(eq(users.id, input.userId)).for("update").limit(1);
        const target = targetRows[0];
        if (!target) notFound();
        if (target.role === input.role) return { success: true, changed: false };
        if (target.role === "admin" && input.role === "user") {
          const administrators = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin")).orderBy(users.id).for("update");
          if (administrators.length <= 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The final administrator cannot be removed." });
        }
        await tx.update(users).set({ role: input.role }).where(eq(users.id, target.id));
        await tx.insert(adminAuditLogs).values({ adminUserId: ctx.user.id, action: input.role === "admin" ? "grant_administrator_role" : "revoke_administrator_role", entityType: "user", entityId: target.id, reason: input.reason, details: JSON.stringify({ from: target.role, to: input.role }) });
        await notify(tx, target.id, "account_role_changed", "Account role updated", `An administrator changed your Pace Arena role to ${input.role}.`, "user", target.id);
        return { success: true, changed: true };
      });
    }),
    matchLedger: adminProcedure.input(z.object({ matchId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await database();
      const [kes, historicalDemo] = await Promise.all([
        db.select({ username: profiles.username, transaction: kesWalletTransactions }).from(kesWalletTransactions).innerJoin(profiles, eq(profiles.userId, kesWalletTransactions.userId)).where(eq(kesWalletTransactions.matchId, input.matchId)).orderBy(desc(kesWalletTransactions.createdAt)),
        db.select({ username: profiles.username, transaction: walletTransactions }).from(walletTransactions).innerJoin(profiles, eq(profiles.userId, walletTransactions.userId)).where(eq(walletTransactions.matchId, input.matchId)).orderBy(desc(walletTransactions.createdAt)),
      ]);
      return { kes, historicalDemo };
    }),
    audit: adminProcedure.query(async () => {
      const db = await database();
      return db.select().from(adminAuditLogs).orderBy(desc(adminAuditLogs.createdAt)).limit(200);
    }),
  }),
});

/** Reliable in-process server timer; all decisions re-check server timestamps and never blind-settle. */
export async function processMatchTimeouts() {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const expiredChallenges = await db.select().from(challenges).where(and(eq(challenges.status, "open"), lte(challenges.expiresAt, now))).limit(100);
  for (const challenge of expiredChallenges) {
    try {
      await db.transaction(async tx => {
        const rows = await tx.select().from(challenges).where(eq(challenges.id, challenge.id)).for("update").limit(1);
        const current = rows[0];
        if (!current || current.status !== "open" || current.expiresAt.getTime() > Date.now()) return;
        await refundOpenChallenge(tx, current, `challenge:${current.id}:expire`, `Challenge #${current.id} expired; reservation released.`);
        await tx.update(challenges).set({ status: "expired" }).where(eq(challenges.id, current.id));
        await notify(tx, current.creatorId, "challenge_expired", "Challenge expired", current.stakeCurrency === "KES" ? `KES ${current.stake} was released from your reservation.` : "Your historic demo reservation was released.", "challenge", current.id);
        if (current.opponentId) await notify(tx, current.opponentId, "challenge_expired", "Challenge invitation expired", `Challenge #${current.id} expired before you accepted it.`, "challenge", current.id);
      });
    } catch (error) { console.error("[Pace Arena timeout] Challenge expiry failed:", error instanceof Error ? error.message : "unknown error"); }
  }
  const waiting = await db.select().from(matches).where(and(eq(matches.status, "AWAITING_STAKES"), lte(matches.readyDeadline, now))).limit(100);
  for (const match of waiting) {
    try {
      await db.transaction(async tx => {
        const rows = await tx.select().from(matches).where(eq(matches.id, match.id)).for("update").limit(1);
        const current = rows[0];
        if (!current || current.status !== "AWAITING_STAKES" || !current.readyDeadline || current.readyDeadline.getTime() > Date.now()) return;
        const participants = await getParticipants(tx, current.id);
        await refundStakes(tx, current.id, participants, "Readiness deadline expired; both players' own stakes returned.");
        for (const person of participants) await notify(tx, person.userId, "match_cancelled", "Match cancelled", "The readiness window expired. Both reserved stakes were refunded.", "match", current.id);
      });
    } catch (error) { console.error("[Pace Arena timeout] Readiness expiry failed:", error instanceof Error ? error.message : "unknown error"); }
  }
  const running = await db.select().from(matches).where(and(eq(matches.status, "IN_PROGRESS"), lte(matches.expectedEndAt, now))).limit(100);
  for (const match of running) {
    try {
      await db.transaction(async tx => {
        const rows = await tx.select().from(matches).where(eq(matches.id, match.id)).for("update").limit(1);
        const current = rows[0];
        if (!current || current.status !== "IN_PROGRESS" || !current.expectedEndAt || current.expectedEndAt.getTime() > Date.now()) return;
        const deadline = new Date(Date.now() + EVIDENCE_WINDOW_MS);
        await transitionMatch(tx, current, "AWAITING_EVIDENCE", { reportedEndAt: now, evidenceDeadline: deadline }, null, "The server match timer ended; the five-minute evidence window began.");
        await tx.update(matchRecordings).set({ expiresAt: deadline }).where(eq(matchRecordings.matchId, match.id));
        const participants = await getParticipants(tx, match.id);
        for (const person of participants) await notify(tx, person.userId, "evidence_deadline", "Five-minute evidence window", "The server match timer ended. Submit final-score screenshot evidence before the deadline.", "match", match.id);
      });
    } catch (error) { console.error("[Pace Arena timeout] Match end processing failed:", error instanceof Error ? error.message : "unknown error"); }
  }
  const evidenceApproaching = await db.select().from(matches).where(and(eq(matches.status, "AWAITING_EVIDENCE"), gt(matches.evidenceDeadline, now), lte(matches.evidenceDeadline, new Date(now.getTime() + 60_000)))).limit(100);
  for (const match of evidenceApproaching) {
    try {
      await db.transaction(async tx => {
        const rows = await tx.select().from(matches).where(eq(matches.id, match.id)).for("update").limit(1);
        const current = rows[0];
        if (!current || current.status !== "AWAITING_EVIDENCE" || !current.evidenceDeadline || current.evidenceDeadline.getTime() <= Date.now() || current.evidenceDeadline.getTime() > Date.now() + 60_000) return;
        const participants = await getParticipants(tx, current.id);
        for (const person of participants) {
          const sent = await tx.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, person.userId), eq(notifications.type, "evidence_deadline_approaching"), eq(notifications.entityType, "match"), eq(notifications.entityId, current.id))).limit(1);
          if (!sent.length) await notify(tx, person.userId, "evidence_deadline_approaching", "Evidence deadline in one minute", "Your five-minute evidence window closes shortly. Submit a screenshot and reported score or the match will remain under review.", "match", current.id);
        }
      });
    } catch (error) { console.error("[Pace Arena timeout] Evidence reminder failed:", error instanceof Error ? error.message : "unknown error"); }
  }
  const evidenceExpired = await db.select().from(matches).where(and(eq(matches.status, "AWAITING_EVIDENCE"), lte(matches.evidenceDeadline, now))).limit(100);
  for (const match of evidenceExpired) {
    try {
      await db.transaction(async tx => {
        const rows = await tx.select().from(matches).where(eq(matches.id, match.id)).for("update").limit(1);
        const current = rows[0];
        if (!current || current.status !== "AWAITING_EVIDENCE" || !current.evidenceDeadline || current.evidenceDeadline.getTime() > Date.now()) return;
        const participants = await getParticipants(tx, match.id);
        const evidence = await tx.select().from(matchEvidence).where(eq(matchEvidence.matchId, match.id));
        const reason = evidence.length === 0 ? "Neither participant submitted evidence before the five-minute deadline; no automatic winner is awarded." : "One participant did not submit evidence before the five-minute deadline; preserve submitted evidence for a reasoned review.";
        await transitionMatch(tx, current, "UNDER_REVIEW", { disputeReason: reason }, null, reason);
        await tx.update(matchRecordings).set({ expiresAt: null }).where(eq(matchRecordings.matchId, match.id));
        const existing = await tx.select().from(disputes).where(and(eq(disputes.matchId, match.id), inArray(disputes.status, ["OPEN", "INVESTIGATING"]))).limit(1);
        if (!existing.length) await tx.insert(disputes).values({ matchId: match.id, openedBy: participants[0].userId, reason: "missing_evidence", explanation: reason, status: "OPEN" });
        for (const person of participants) await notify(tx, person.userId, "match_under_review", "Evidence deadline reached", reason, "match", match.id);
      });
    } catch (error) { console.error("[Pace Arena timeout] Evidence deadline processing failed:", error instanceof Error ? error.message : "unknown error"); }
  }
  try {
    await cleanupExpiredMatchRecordings(db, now);
  } catch (error) {
    console.error("[Pace Arena timeout] Recording cleanup failed:", error instanceof Error ? error.message : "unknown error");
  }
}
