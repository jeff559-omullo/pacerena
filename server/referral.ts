import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  adminAuditLogs,
  notifications,
  profiles,
  referralCommissions,
  referralSettings,
  referralWithdrawals,
  referrals,
  users,
} from "../drizzle/schema";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";

const REFERRAL_WINDOW_DAYS = 30;
const DEFAULT_REFERRAL_SETTINGS = {
  enabled: 1,
  defaultPercentage: 5,
  fixedAmount: 0,
  minimumQualifyingAmount: 100,
  maxCommissionPerTransaction: 500,
  maxLifetimeCommissionPerReferral: 5000,
  approvalDelayHours: 0,
  minWithdrawalAmount: 100,
  rules: JSON.stringify({
    wallet_deposit: { percentage: 5 },
    credit_purchase: { percentage: 5 },
    match_entry: { percentage: 2 },
  }),
};

async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "The Pace Arena database is unavailable." });
  return db;
}

export function normalizeReferralCode(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

export function generateReferralCode(length = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export function getPublicReferralBaseUrl(): string {
  const configured = process.env.PUBLIC_APP_URL ?? process.env.APP_URL ?? process.env.PACE_APP_URL;
  return configured && configured.trim() ? configured.trim() : "https://pacearena.com";
}

export function buildReferralUrl(code: string, baseUrl = getPublicReferralBaseUrl()): string {
  const normalized = normalizeReferralCode(code);
  const url = new URL("/register", baseUrl);
  if (normalized) url.searchParams.set("ref", normalized);
  return url.toString();
}

async function getReferralSettingsTx(tx: any) {
  const rows = await tx.select().from(referralSettings).where(eq(referralSettings.id, 1)).limit(1);
  if (rows[0]) return rows[0];
  await tx.insert(referralSettings).values({ id: 1, ...DEFAULT_REFERRAL_SETTINGS, createdAt: new Date(), updatedAt: new Date() });
  const [fallback] = await tx.select().from(referralSettings).where(eq(referralSettings.id, 1)).limit(1);
  return fallback ?? { ...DEFAULT_REFERRAL_SETTINGS, id: 1 };
}

export async function ensureUserReferralCode(tx: any, userId: number): Promise<string> {
  const [existing] = await tx.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, userId)).limit(1);
  if (existing?.referralCode) return existing.referralCode;

  let code = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    code = generateReferralCode();
    const [duplicate] = await tx.select({ id: users.id }).from(users).where(eq(users.referralCode, code)).limit(1);
    if (!duplicate) break;
  }

  if (!code) code = generateReferralCode();
  await tx.update(users).set({ referralCode: code }).where(eq(users.id, userId));
  return code;
}

export async function resolveReferralCode(tx: any, referralCode: string | null | undefined) {
  const code = normalizeReferralCode(referralCode);
  if (!code) return null;
  const [referrer] = await tx.select().from(users).where(eq(users.referralCode, code)).limit(1);
  return referrer ?? null;
}

export async function attachReferral(tx: any, referredUserId: number, referralCode: string | null | undefined) {
  const code = normalizeReferralCode(referralCode);
  if (!code) return null;

  const referrer = await resolveReferralCode(tx, code);
  if (!referrer) throw new TRPCError({ code: "BAD_REQUEST", message: "This invitation code is invalid or no longer active." });
  if (referrer.id === referredUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot refer yourself." });

  const [existing] = await tx.select().from(referrals).where(eq(referrals.referredUserId, referredUserId)).limit(1);
  if (existing) throw new TRPCError({ code: "CONFLICT", message: "This account is already linked to a referral." });

  const [link] = await tx.select().from(referrals).where(and(eq(referrals.referrerUserId, referrer.id), eq(referrals.referredUserId, referredUserId))).limit(1);
  if (link) {
    return link;
  }

  const result = await tx.insert(referrals).values({
    referrerUserId: referrer.id,
    referredUserId,
    status: "ACTIVE",
    source: "invite",
    expiresAt: new Date(Date.now() + REFERRAL_WINDOW_DAYS * 24 * 60 * 60 * 1000),
  });

  const insertedId = Number((result as any)?.insertId ?? 0);
  await tx.insert(notifications).values({
    userId: referrer.id,
    type: "referral_joined",
    title: "New referral joined",
    body: "A new player joined Pace Arena through your referral link.",
    entityType: "referral",
    entityId: insertedId || referredUserId,
  });

  return { referrerUserId: referrer.id, referredUserId, status: "ACTIVE" };
}

export function calculateReferralCommission(sourceAmountKes: number, settings: { defaultPercentage: number; fixedAmount: number; maxCommissionPerTransaction: number; minimumQualifyingAmount: number }) {
  if (!Number.isFinite(sourceAmountKes) || sourceAmountKes <= 0) return 0;
  if (sourceAmountKes < settings.minimumQualifyingAmount) return 0;
  const percentageAmount = settings.defaultPercentage > 0 ? Math.floor((sourceAmountKes * settings.defaultPercentage) / 100) : 0;
  const commission = percentageAmount + settings.fixedAmount;
  const max = settings.maxCommissionPerTransaction || commission;
  return Math.min(Math.max(commission, 0), max);
}

export async function maybeAwardReferralCommission(tx: any, referredUserId: number, sourceType: string, sourceAmountKes: number, sourceTransactionId: string, reason: string) {
  const settings = await getReferralSettingsTx(tx);
  if (!settings.enabled) return null;
  if (sourceAmountKes < settings.minimumQualifyingAmount) return null;

  const [link] = await tx.select().from(referrals).where(and(eq(referrals.referredUserId, referredUserId), eq(referrals.status, "ACTIVE"))).limit(1);
  if (!link) return null;

  const idempotencyKey = `referral:${sourceType}:${sourceTransactionId}`;
  const [existing] = await tx.select().from(referralCommissions).where(eq(referralCommissions.idempotencyKey, idempotencyKey)).limit(1);
  if (existing) return existing;

  const commissionAmount = calculateReferralCommission(sourceAmountKes, {
    defaultPercentage: Number(settings.defaultPercentage ?? 0),
    fixedAmount: Number(settings.fixedAmount ?? 0),
    maxCommissionPerTransaction: Number(settings.maxCommissionPerTransaction ?? 0),
    minimumQualifyingAmount: Number(settings.minimumQualifyingAmount ?? 0),
  });
  if (!commissionAmount) return null;

  const status = Number(settings.approvalDelayHours ?? 0) > 0 ? "PENDING" : "APPROVED";
  const result = await tx.insert(referralCommissions).values({
    referralId: link.id,
    referrerUserId: link.referrerUserId,
    referredUserId,
    sourceType,
    sourceTransactionId,
    sourceAmountKes,
    percentage: Number(settings.defaultPercentage ?? 0),
    fixedAmount: Number(settings.fixedAmount ?? 0),
    commissionAmountKes: commissionAmount,
    status,
    idempotencyKey,
    reason,
    eligibleAt: new Date(),
    approvedAt: status === "APPROVED" ? new Date() : null,
  });

  const insertedId = Number((result as any)?.insertId ?? 0);
  const [row] = await tx.select().from(referralCommissions).where(eq(referralCommissions.id, insertedId)).limit(1);
  if (row) {
    await tx.insert(notifications).values({
      userId: link.referrerUserId,
      type: "referral_commission",
      title: status === "APPROVED" ? "Referral commission earned" : "Referral commission pending",
      body: `A referral completed a qualifying activity worth KES ${sourceAmountKes}. Commission: KES ${commissionAmount}.`,
      entityType: "referral",
      entityId: row.id,
    });
  }
  return row ?? null;
}

async function getReferralSummaryForUser(db: any, userId: number) {
  const totalReferrals = (await db.select().from(referrals).where(eq(referrals.referrerUserId, userId))) as any[];
  const successfulReferrals = totalReferrals.filter((item: any) => item.status === "ACTIVE").length;
  const pendingReferrals = totalReferrals.filter((item: any) => item.status === "PENDING").length;
  const activeReferrals = successfulReferrals;
  const earningsRows = (await db.select().from(referralCommissions).where(eq(referralCommissions.referrerUserId, userId))) as any[];
  const totals = earningsRows.reduce((acc: any, row: any) => {
    acc.earned += row.commissionAmountKes;
    if (row.status === "APPROVED") acc.available += row.commissionAmountKes;
    if (row.status === "PENDING") acc.pending += row.commissionAmountKes;
    if (row.status === "PAID") acc.paid += row.commissionAmountKes;
    return acc;
  }, { earned: 0, pending: 0, available: 0, paid: 0 });

  return {
    totalReferrals: totalReferrals.length,
    successfulReferrals,
    activeReferrals,
    pendingReferrals,
    totalCommissionsEarned: totals.earned,
    pendingCommissions: totals.pending,
    availableReferralEarnings: totals.available,
    totalCommissionsWithdrawn: totals.paid,
  };
}

const referrerProfiles = profiles;
const referredProfiles = profiles;

export const referralRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    const db = await database();
    const stats = await getReferralSummaryForUser(db, ctx.user.id);
    const [user] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    const code = user?.referralCode ?? (await ensureUserReferralCode(db, ctx.user.id));
    const link = buildReferralUrl(code);
    return { ...stats, referralCode: code, referralUrl: link };
  }),
  link: protectedProcedure.query(async ({ ctx }) => {
    const db = await database();
    const [user] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    const code = user?.referralCode ?? (await ensureUserReferralCode(db, ctx.user.id));
    return {
      code,
      url: buildReferralUrl(code),
      share: {
        whatsapp: `https://wa.me/?text=${encodeURIComponent(`Join Pace Arena and claim your welcome bonus: ${buildReferralUrl(code)}`)}`,
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(buildReferralUrl(code))}`,
        telegram: `https://t.me/share/url?url=${encodeURIComponent(buildReferralUrl(code))}&text=${encodeURIComponent("Join Pace Arena and claim your welcome bonus")}`,
      },
    };
  }),
  history: protectedProcedure.query(async ({ ctx }) => {
    const db = await database();
    const referralsList = await db.select({
      id: referrals.id,
      referrerUserId: referrals.referrerUserId,
      referredUserId: referrals.referredUserId,
      status: referrals.status,
      source: referrals.source,
      createdAt: referrals.createdAt,
      expiresAt: referrals.expiresAt,
      username: referredProfiles.username,
    }).from(referrals).innerJoin(referredProfiles, eq(referredProfiles.userId, referrals.referredUserId)).where(eq(referrals.referrerUserId, ctx.user.id)).orderBy(desc(referrals.createdAt)).limit(100);
    const commissions = await db.select({
      id: referralCommissions.id,
      sourceType: referralCommissions.sourceType,
      sourceAmountKes: referralCommissions.sourceAmountKes,
      commissionAmountKes: referralCommissions.commissionAmountKes,
      percentage: referralCommissions.percentage,
      status: referralCommissions.status,
      createdAt: referralCommissions.createdAt,
    }).from(referralCommissions).where(eq(referralCommissions.referrerUserId, ctx.user.id)).orderBy(desc(referralCommissions.createdAt)).limit(100);
    return { referrals: referralsList, commissions };
  }),
  withdraw: protectedProcedure.input(z.object({ amountKes: z.number().int().positive(), reason: z.string().trim().min(10).max(500).optional() })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const settings = await getReferralSettingsTx(db);
    if (!settings.enabled) throw new TRPCError({ code: "FORBIDDEN", message: "The referral program is disabled." });
    const available = await db.select({ total: sql<number>`COALESCE(SUM(${referralCommissions.commissionAmountKes}), 0)` }).from(referralCommissions).where(and(eq(referralCommissions.referrerUserId, ctx.user.id), eq(referralCommissions.status, "APPROVED"))).limit(1);
    const totalAvailable = Number(available[0]?.total ?? 0);
    if (input.amountKes < Number(settings.minWithdrawalAmount ?? 100)) throw new TRPCError({ code: "BAD_REQUEST", message: `The minimum referral withdrawal is KES ${settings.minWithdrawalAmount}.` });
    if (input.amountKes > totalAvailable) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot withdraw more than your approved referral earnings." });
    const result = await db.insert(referralWithdrawals).values({
      userId: ctx.user.id,
      amountKes: input.amountKes,
      status: "PENDING",
      reason: input.reason ?? "Referral earnings withdrawal request.",
      createdAt: new Date(),
    });
    const insertedId = Number((result as any)?.insertId ?? 0);
    await db.insert(notifications).values({
      userId: ctx.user.id,
      type: "referral_withdrawal",
      title: "Referral withdrawal request submitted",
      body: `Your KES ${input.amountKes} referral withdrawal request is pending review.`,
      entityType: "referral",
      entityId: insertedId,
    });
    return { success: true, id: insertedId };
  }),
  adminSettings: adminProcedure.query(async () => {
    const db = await database();
    return getReferralSettingsTx(db);
  }),
  adminUpdateSettings: adminProcedure.input(z.object({
    enabled: z.boolean(),
    defaultPercentage: z.number().int().min(0).max(100),
    fixedAmount: z.number().int().min(0).max(10000),
    minimumQualifyingAmount: z.number().int().min(0).max(1000000),
    maxCommissionPerTransaction: z.number().int().min(0).max(1000000),
    maxLifetimeCommissionPerReferral: z.number().int().min(0).max(1000000),
    approvalDelayHours: z.number().int().min(0).max(720),
    minWithdrawalAmount: z.number().int().min(0).max(1000000),
    reason: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    const db = await database();
    await db.transaction(async tx => {
      await tx.update(referralSettings).set({
        enabled: input.enabled ? 1 : 0,
        defaultPercentage: input.defaultPercentage,
        fixedAmount: input.fixedAmount,
        minimumQualifyingAmount: input.minimumQualifyingAmount,
        maxCommissionPerTransaction: input.maxCommissionPerTransaction,
        maxLifetimeCommissionPerReferral: input.maxLifetimeCommissionPerReferral,
        approvalDelayHours: input.approvalDelayHours,
        minWithdrawalAmount: input.minWithdrawalAmount,
        updatedAt: new Date(),
      }).where(eq(referralSettings.id, 1));
      await tx.insert(adminAuditLogs).values({
        adminUserId: ctx.user.id,
        action: "update_referral_settings",
        entityType: "referral_settings",
        entityId: 1,
        reason: input.reason,
        details: JSON.stringify(input),
      });
    });
    return { success: true };
  }),
  adminList: adminProcedure.query(async () => {
    const db = await database();
    return db.select({
      id: referrals.id,
      referrerUserId: referrals.referrerUserId,
      referredUserId: referrals.referredUserId,
      source: referrals.source,
      status: referrals.status,
      createdAt: referrals.createdAt,
      referrerUsername: referrerProfiles.username,
      referredUsername: referredProfiles.username,
    })
      .from(referrals)
      .innerJoin(referrerProfiles, eq(referrerProfiles.userId, referrals.referrerUserId))
      .innerJoin(referredProfiles, eq(referredProfiles.userId, referrals.referredUserId))
      .orderBy(desc(referrals.createdAt))
      .limit(200);
  }),
  adminCommissions: adminProcedure.query(async () => {
    const db = await database();
    return db.select({
      id: referralCommissions.id,
      referrerUserId: referralCommissions.referrerUserId,
      referredUserId: referralCommissions.referredUserId,
      sourceType: referralCommissions.sourceType,
      sourceAmountKes: referralCommissions.sourceAmountKes,
      commissionAmountKes: referralCommissions.commissionAmountKes,
      status: referralCommissions.status,
      createdAt: referralCommissions.createdAt,
      percentage: referralCommissions.percentage,
    }).from(referralCommissions).orderBy(desc(referralCommissions.createdAt)).limit(200);
  }),
  adminWithdrawals: adminProcedure.query(async () => {
    const db = await database();
    return db.select({
      id: referralWithdrawals.id,
      userId: referralWithdrawals.userId,
      amountKes: referralWithdrawals.amountKes,
      status: referralWithdrawals.status,
      reason: referralWithdrawals.reason,
      createdAt: referralWithdrawals.createdAt,
      username: profiles.username,
    })
      .from(referralWithdrawals)
      .innerJoin(profiles, eq(profiles.userId, referralWithdrawals.userId))
      .orderBy(desc(referralWithdrawals.createdAt)).limit(200);
  }),
});
