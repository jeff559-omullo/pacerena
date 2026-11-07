import { randomBytes } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  adminAuditLogs,
  kesWalletAccounts,
  kesWalletTransactions,
  kesWithdrawalRequests,
  notifications,
  partnerCreditEvents,
  profiles,
  users,
} from "../drizzle/schema";
import { parsePartnerCreditEvent, verifyPartnerSignature } from "./partner-credit";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";

export interface KesWalletConfig {
  enabled: true;
  partnerSecret: string;
  partnerPurchaseUrl: string | null;
  minDeposit: number;
  maxDeposit: number;
  minStake: number;
  maxStake: number;
  minWithdrawal: number;
  maxWithdrawal: number;
}

export function normalizeKenyanMsisdn(value: string): string | null {
  const digits = value.trim().replace(/[\s()+.-]/g, "");
  const normalized = digits.startsWith("+") ? digits.slice(1) : digits.startsWith("0") ? `254${digits.slice(1)}` : digits;
  return /^254[17]\d{8}$/.test(normalized) ? normalized : null;
}

export function parseConfiguredLimit(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 && n <= 1_000_000_000 ? n : null;
}

export function isValidKesAmount(amount: number, min: number, max: number): boolean {
  return Number.isSafeInteger(amount) && amount >= min && amount <= max;
}

function validatedPartnerUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function shouldForceKesFeatures(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PACE_FORCE_KES === "true" || env.PACE_FORCE_KES_ENABLED === "true" || env.PACE_FORCE_FEATURES === "true";
}

export function getKesWalletConfig(env: NodeJS.ProcessEnv = process.env): KesWalletConfig | null {
  if (shouldForceKesFeatures(env)) {
    const minDeposit = parseConfiguredLimit(env.PACE_KES_MIN_DEPOSIT) ?? 100;
    const maxDeposit = parseConfiguredLimit(env.PACE_KES_MAX_DEPOSIT) ?? 200_000;
    const minStake = parseConfiguredLimit(env.PACE_KES_MIN_STAKE) ?? 10;
    const maxStake = parseConfiguredLimit(env.PACE_KES_MAX_STAKE) ?? 5_000;
    const minWithdrawal = parseConfiguredLimit(env.PACE_KES_MIN_WITHDRAWAL) ?? 100;
    const maxWithdrawal = parseConfiguredLimit(env.PACE_KES_MAX_WITHDRAWAL) ?? 50_000;
    const partnerSecret = env.PACE_PARTNER_CALLBACK_SECRET?.trim() || "force-enabled-kes-secret-32-bytes-long-123456";
    const partnerPurchaseUrl = validatedPartnerUrl(env.PACE_CREDIT_PARTNER_URL) ?? "https://example.com/pay";
    return {
      enabled: true,
      partnerSecret,
      partnerPurchaseUrl,
      minDeposit,
      maxDeposit,
      minStake,
      maxStake,
      minWithdrawal,
      maxWithdrawal,
    };
  }
  if (env.PACE_KES_WALLET_ENABLED !== "true") return null;
  const minDeposit = parseConfiguredLimit(env.PACE_KES_MIN_DEPOSIT);
  const maxDeposit = parseConfiguredLimit(env.PACE_KES_MAX_DEPOSIT);
  const minStake = parseConfiguredLimit(env.PACE_KES_MIN_STAKE);
  const maxStake = parseConfiguredLimit(env.PACE_KES_MAX_STAKE);
  const minWithdrawal = parseConfiguredLimit(env.PACE_KES_MIN_WITHDRAWAL);
  const maxWithdrawal = parseConfiguredLimit(env.PACE_KES_MAX_WITHDRAWAL);
  const partnerSecret = env.PACE_PARTNER_CALLBACK_SECRET?.trim();
  const partnerPurchaseUrl = validatedPartnerUrl(env.PACE_CREDIT_PARTNER_URL);
  if (!partnerSecret || Buffer.byteLength(partnerSecret) < 32 || !partnerPurchaseUrl || !minDeposit || !maxDeposit || minDeposit > maxDeposit || !minStake || !maxStake || minStake > maxStake || maxStake > 5_000 || minStake < 10 || !minWithdrawal || !maxWithdrawal || minWithdrawal > maxWithdrawal) return null;
  return {
    enabled: true,
    partnerSecret,
    partnerPurchaseUrl,
    minDeposit,
    maxDeposit,
    minStake,
    maxStake,
    minWithdrawal,
    maxWithdrawal,
  };
}

export function isKesWageringEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return shouldForceKesFeatures(env) || (env.PACE_REAL_WAGERING_ENABLED === "true" && getKesWalletConfig(env) !== null);
}

const unavailable = () => new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "The KES wallet is unavailable or has not been configured." });

async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "The Pace Arena database is unavailable." });
  return db;
}

async function eligibleForWithdrawal(tx: any, userId: number) {
  const rows = await tx.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (rows[0]?.cashWalletStatus !== "verified") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Your KES wallet must be verified by an administrator before requesting an M-Pesa withdrawal." });
  }
}

function newWalletReference(): string {
  return `PA${randomBytes(15).toString("hex").toUpperCase()}`;
}

export function parseDepositConfirmationDetails(details: string | null | undefined): { amountKes?: number; phone?: string; message?: string } {
  if (!details) return { amountKes: undefined, phone: undefined, message: undefined };
  try {
    const parsed = JSON.parse(details) as Record<string, unknown>;
    const rawAmount = typeof parsed.amountKes === "number" ? parsed.amountKes : typeof parsed.amountKes === "string" ? Number(parsed.amountKes) : undefined;
    const amountKes = Number.isInteger(rawAmount) && rawAmount! > 0 ? rawAmount as number : undefined;
    const phone = typeof parsed.phone === "string" ? parsed.phone.trim() || undefined : undefined;
    const message = typeof parsed.message === "string" ? parsed.message.trim() || undefined : undefined;
    return { amountKes, phone, message };
  } catch {
    return { amountKes: undefined, phone: undefined, message: undefined };
  }
}

export async function ensureKesWalletAccount(tx: any, userId: number) {
  await tx.insert(kesWalletAccounts).values({ userId, walletReference: newWalletReference() }).onDuplicateKeyUpdate({ set: { userId } });
  let rows = await tx.select().from(kesWalletAccounts).where(eq(kesWalletAccounts.userId, userId)).for("update").limit(1);
  let account = rows[0];
  if (!account) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not load the KES wallet." });
  if (!account.walletReference) {
    await tx.update(kesWalletAccounts).set({ walletReference: newWalletReference() }).where(eq(kesWalletAccounts.userId, userId));
    rows = await tx.select().from(kesWalletAccounts).where(eq(kesWalletAccounts.userId, userId)).for("update").limit(1);
    account = rows[0];
  }
  return account;
}

const idempotencyKey = z.string().trim().min(8).max(128);
const withdrawalForm = z.object({
  amountKes: z.number().int().positive(),
  phone: z.string().trim().min(8).max(24),
  idempotencyKey,
});

export const kesWalletRouter = router({
  status: protectedProcedure.query(() => {
    const config = getKesWalletConfig();
    return {
      walletEnabled: Boolean(config),
      wageringEnabled: Boolean(config) && isKesWageringEnabled(),
      minDeposit: config?.minDeposit ?? null,
      maxDeposit: config?.maxDeposit ?? null,
      minStake: config?.minStake ?? null,
      maxStake: config?.maxStake ?? null,
      minWithdrawal: config?.minWithdrawal ?? null,
      maxWithdrawal: config?.maxWithdrawal ?? null,
      partnerPurchaseUrl: config?.partnerPurchaseUrl ?? null,
    };
  }),

  summary: protectedProcedure.query(async ({ ctx }) => {
    if (!getKesWalletConfig()) throw unavailable();
    const db = await database();
    const account = await db.transaction(tx => ensureKesWalletAccount(tx, ctx.user.id));
    return {
      userId: account.userId,
      walletReference: account.walletReference!,
      availableKes: account.availableKes,
      reservedKes: account.reservedKes,
      frozen: account.frozen === 1,
      freezeReason: account.freezeReason,
    };
  }),

  history: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional()).query(async ({ ctx, input }) => {
    const db = await database();
    return db.select().from(kesWalletTransactions).where(eq(kesWalletTransactions.userId, ctx.user.id)).orderBy(desc(kesWalletTransactions.createdAt)).limit(input?.limit ?? 50);
  }),

  submitDepositConfirmation: protectedProcedure.input(z.object({
    amountKes: z.number().int().positive().optional(),
    phone: z.string().trim().min(8).max(24).optional(),
    message: z.string().trim().min(10).max(1000),
  })).mutation(async ({ ctx, input }) => {
    const db = await database();
    const adminRows = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
    await db.insert(notifications).values({
      userId: ctx.user.id,
      type: "wallet",
      title: "Deposit confirmation submitted",
      body: `Your partner purchase confirmation was submitted${input.amountKes ? ` for KES ${input.amountKes}` : ""}. Admin review is pending.`,
      entityType: "wallet",
      entityId: null,
    });
    for (const admin of adminRows) {
      await db.insert(notifications).values({
        userId: admin.id,
        type: "deposit_confirmation_review",
        title: "Deposit confirmation needs review",
        body: `Player #${ctx.user.id}${input.amountKes ? ` · KES ${input.amountKes}` : ""}${input.phone ? ` · ${input.phone}` : ""} · ${input.message.slice(0, 120)}${input.message.length > 120 ? "…" : ""}`,
        entityType: "user",
        entityId: ctx.user.id,
      });
    }
    await db.insert(adminAuditLogs).values({
      adminUserId: ctx.user.id,
      action: "submit_partner_deposit_confirmation",
      entityType: "user",
      entityId: ctx.user.id,
      reason: "Customer submitted partner purchase confirmation message.",
      details: JSON.stringify({
        amountKes: input.amountKes ?? null,
        phone: input.phone ?? null,
        message: input.message,
      }),
    });
    return { success: true };
  }),

  depositConfirmationQueue: adminProcedure.query(async () => {
    const db = await database();
    const rows = await db.select({
      id: adminAuditLogs.id,
      userId: adminAuditLogs.entityId,
      username: profiles.username,
      walletReference: kesWalletAccounts.walletReference,
      submittedAt: adminAuditLogs.createdAt,
      details: adminAuditLogs.details,
    }).from(adminAuditLogs)
      .innerJoin(profiles, eq(profiles.userId, adminAuditLogs.entityId))
      .leftJoin(kesWalletAccounts, eq(kesWalletAccounts.userId, adminAuditLogs.entityId))
      .where(eq(adminAuditLogs.action, "submit_partner_deposit_confirmation"))
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(100);

    return rows.map(row => {
      const details = parseDepositConfirmationDetails(row.details);
      return {
        id: row.id,
        userId: row.userId,
        username: row.username,
        walletReference: row.walletReference,
        amountKes: details.amountKes ?? null,
        phone: details.phone ?? null,
        message: details.message ?? "No message included in the confirmation.",
        submittedAt: row.submittedAt,
      };
    });
  }),

  awardDepositConfirmation: adminProcedure.input(z.object({
    userId: z.number().int().positive(),
    amountKes: z.number().int().positive(),
    reason: z.string().trim().min(10).max(2000),
    phone: z.string().trim().max(24).optional(),
    message: z.string().trim().min(10).max(1000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await database();
    return db.transaction(async tx => {
      const wallet = await ensureKesWalletAccount(tx, input.userId);
      const availableAfterKes = wallet.availableKes + input.amountKes;
      const transactionKey = `manual-deposit:${input.userId}:${Date.now()}`;
      const eventId = `manual-deposit:${input.userId}:${Date.now()}:${randomBytes(6).toString("hex")}`;
      await tx.update(kesWalletAccounts).set({ availableKes: availableAfterKes }).where(eq(kesWalletAccounts.userId, input.userId));
      await tx.insert(kesWalletTransactions).values({
        userId: input.userId,
        transactionType: "admin_adjustment",
        amountKes: input.amountKes,
        availableBeforeKes: wallet.availableKes,
        availableAfterKes: availableAfterKes,
        reservedBeforeKes: wallet.reservedKes,
        reservedAfterKes: wallet.reservedKes,
        status: "completed",
        idempotencyKey: transactionKey,
        reason: input.reason,
      });
      await tx.insert(partnerCreditEvents).values({
        eventId,
        transactionId: eventId,
        eventType: "credit",
        userId: input.userId,
        walletReference: wallet.walletReference,
        amountKes: input.amountKes,
        currency: "KES",
        status: "credited",
        partnerOccurredAt: new Date(),
      });
      await tx.insert(adminAuditLogs).values({
        adminUserId: ctx.user.id,
        action: "award_manual_deposit_credit",
        entityType: "user",
        entityId: input.userId,
        reason: input.reason,
        details: JSON.stringify({
          amountKes: input.amountKes,
          phone: input.phone ?? null,
          message: input.message ?? null,
          walletReference: wallet.walletReference,
          eventId,
        }),
      });
      await tx.insert(notifications).values({
        userId: input.userId,
        type: "wallet",
        title: "Deposit confirmed and credited",
        body: `An administrator approved your KES ${input.amountKes} deposit confirmation and added it to your available wallet balance.`,
        entityType: "user",
        entityId: input.userId,
      });
      return { success: true, amountKes: input.amountKes };
    });
  }),

  requestWithdrawal: protectedProcedure.input(withdrawalForm).mutation(async ({ ctx, input }) => {
    const config = getKesWalletConfig();
    if (!config) throw unavailable();
    if (!isValidKesAmount(input.amountKes, config.minWithdrawal, config.maxWithdrawal)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Withdrawal amount is outside the configured KES limits." });
    }
    const phone = normalizeKenyanMsisdn(input.phone);
    if (!phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid Kenyan M-Pesa phone number." });
    const db = await database();
    return db.transaction(async tx => {
      const prior = await tx.select().from(kesWithdrawalRequests).where(and(eq(kesWithdrawalRequests.userId, ctx.user.id), eq(kesWithdrawalRequests.idempotencyKey, input.idempotencyKey))).limit(1);
      if (prior[0]) return { requestId: prior[0].id, status: prior[0].status };
      await eligibleForWithdrawal(tx, ctx.user.id);
      const wallet = await ensureKesWalletAccount(tx, ctx.user.id);
      if (wallet.frozen === 1) throw new TRPCError({ code: "FORBIDDEN", message: "Your KES wallet is frozen for administrator review; withdrawals are paused." });
      if (wallet.availableKes < input.amountKes) throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient available KES balance." });
      const created = await tx.insert(kesWithdrawalRequests).values({ userId: ctx.user.id, idempotencyKey: input.idempotencyKey, amountKes: input.amountKes, phoneE164: `+${phone}`, status: "pending" });
      const requestId = Number((created as any)[0]?.insertId);
      if (!Number.isSafeInteger(requestId) || requestId <= 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the withdrawal request." });
      const availableAfterKes = wallet.availableKes - input.amountKes;
      const reservedAfterKes = wallet.reservedKes + input.amountKes;
      await tx.update(kesWalletAccounts).set({ availableKes: availableAfterKes, reservedKes: reservedAfterKes }).where(eq(kesWalletAccounts.userId, ctx.user.id));
      await tx.insert(kesWalletTransactions).values({
        userId: ctx.user.id,
        withdrawalRequestId: requestId,
        transactionType: "withdrawal_reservation",
        amountKes: input.amountKes,
        availableBeforeKes: wallet.availableKes,
        availableAfterKes,
        reservedBeforeKes: wallet.reservedKes,
        reservedAfterKes,
        status: "reserved",
        idempotencyKey: `withdrawal-reserve:${requestId}`,
        reason: "Manual M-Pesa withdrawal request; funds reserved pending administrator processing.",
      });
      return { requestId, status: "pending" as const };
    });
  }),

  myWithdrawals: protectedProcedure.query(async ({ ctx }) => {
    const db = await database();
    return db.select().from(kesWithdrawalRequests).where(eq(kesWithdrawalRequests.userId, ctx.user.id)).orderBy(desc(kesWithdrawalRequests.requestedAt)).limit(50);
  }),

  withdrawalQueue: adminProcedure.query(async () => {
    const db = await database();
    return db.select({ request: kesWithdrawalRequests, username: profiles.username })
      .from(kesWithdrawalRequests)
      .innerJoin(profiles, eq(profiles.userId, kesWithdrawalRequests.userId))
      .where(eq(kesWithdrawalRequests.status, "pending"))
      .orderBy(desc(kesWithdrawalRequests.requestedAt))
      .limit(100);
  }),

  processWithdrawal: adminProcedure.input(z.object({
    id: z.number().int().positive(),
    action: z.enum(["paid", "rejected"]),
    reason: z.string().trim().min(10).max(2000),
    receipt: z.string().trim().min(3).max(64).optional(),
    actualAmountKes: z.number().int().positive().optional(),
  })).mutation(async ({ ctx, input }) => {
    if (input.action === "paid" && !input.receipt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the M-Pesa receipt/reference after sending the payout." });
    }
    if (input.action === "paid" && !input.actualAmountKes) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Record the actual KES amount sent before marking this request paid." });
    }
    const db = await database();
    return db.transaction(async tx => {
      const rows = await tx.select().from(kesWithdrawalRequests).where(eq(kesWithdrawalRequests.id, input.id)).for("update").limit(1);
      const request = rows[0];
      if (!request || request.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "This withdrawal is no longer pending." });
      if (input.action === "paid" && input.actualAmountKes !== request.amountKes) throw new TRPCError({ code: "BAD_REQUEST", message: "The actual M-Pesa amount must match the reserved withdrawal amount." });
      const walletRows = await tx.select().from(kesWalletAccounts).where(eq(kesWalletAccounts.userId, request.userId)).for("update").limit(1);
      const wallet = walletRows[0];
      if (!wallet || wallet.reservedKes < request.amountKes) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Withdrawal reservation is inconsistent; investigate before processing." });
      const paid = input.action === "paid";
      if (paid && wallet.frozen === 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This wallet is frozen for reversal review. Do not send a payout until an administrator resolves the review." });
      const availableAfterKes = wallet.availableKes + (paid ? 0 : request.amountKes);
      const reservedAfterKes = wallet.reservedKes - request.amountKes;
      await tx.update(kesWalletAccounts).set({ availableKes: availableAfterKes, reservedKes: reservedAfterKes }).where(eq(kesWalletAccounts.userId, request.userId));
      await tx.update(kesWithdrawalRequests).set({
        status: input.action,
        payoutReceipt: paid ? input.receipt : null,
        actualAmountKes: paid ? input.actualAmountKes! : null,
        reviewReason: input.reason,
        processedAt: new Date(),
        processedBy: ctx.user.id,
      }).where(eq(kesWithdrawalRequests.id, request.id));
      await tx.insert(kesWalletTransactions).values({
        userId: request.userId,
        withdrawalRequestId: request.id,
        transactionType: paid ? "withdrawal_paid" : "withdrawal_release",
        amountKes: request.amountKes,
        availableBeforeKes: wallet.availableKes,
        availableAfterKes,
        reservedBeforeKes: wallet.reservedKes,
        reservedAfterKes,
        status: paid ? "completed" : "released",
        idempotencyKey: `withdrawal-${input.action}:${request.id}`,
        reason: input.reason,
      });
      await tx.insert(adminAuditLogs).values({
        adminUserId: ctx.user.id,
        action: paid ? "record_kes_manual_mpesa_payout" : "reject_kes_withdrawal",
        entityType: "kes_withdrawal",
        entityId: request.id,
        reason: input.reason,
        details: JSON.stringify({ receipt: paid ? input.receipt : undefined, amountKes: request.amountKes, actualAmountKes: paid ? input.actualAmountKes : undefined, phoneE164: request.phoneE164 }),
      });
      await tx.insert(notifications).values({
        userId: request.userId,
        type: "wallet",
        title: paid ? "M-Pesa withdrawal recorded" : "Withdrawal request rejected",
        body: paid ? `Your KES ${request.amountKes} withdrawal was recorded with M-Pesa reference ${input.receipt}.` : `Your KES ${request.amountKes} withdrawal was rejected. Reserved funds were returned.`,
        entityType: "kes_withdrawal",
        entityId: request.id,
      });
      return { id: request.id, status: input.action };
    });
  }),

  partnerReversalQueue: adminProcedure.query(async () => {
    const db = await database();
    return db.select({ event: partnerCreditEvents, username: profiles.username, frozen: kesWalletAccounts.frozen, freezeReason: kesWalletAccounts.freezeReason })
      .from(partnerCreditEvents)
      .innerJoin(profiles, eq(profiles.userId, partnerCreditEvents.userId))
      .innerJoin(kesWalletAccounts, eq(kesWalletAccounts.userId, partnerCreditEvents.userId))
      .where(eq(partnerCreditEvents.status, "held_for_review"))
      .orderBy(desc(partnerCreditEvents.receivedAt))
      .limit(100);
  }),

  resolvePartnerReversal: adminProcedure.input(z.object({
    eventId: z.number().int().positive(),
    action: z.enum(["reverse", "dismiss"]),
    reason: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    const db = await database();
    return db.transaction(async tx => {
      const rows = await tx.select().from(partnerCreditEvents).where(eq(partnerCreditEvents.id, input.eventId)).for("update").limit(1);
      const reversal = rows[0];
      if (!reversal || reversal.eventType !== "reversal" || reversal.status !== "held_for_review" || !reversal.reversesTransactionId) {
        throw new TRPCError({ code: "CONFLICT", message: "This partner reversal is no longer awaiting review." });
      }
      const walletRows = await tx.select().from(kesWalletAccounts).where(eq(kesWalletAccounts.userId, reversal.userId)).for("update").limit(1);
      const wallet = walletRows[0];
      if (!wallet) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The affected KES wallet no longer exists." });
      if (input.action === "reverse") {
        if (wallet.reservedKes !== 0 || wallet.availableKes < reversal.amountKes) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The reversal still cannot be applied without a negative or reserved balance. Keep the account frozen and resolve the underlying funds first." });
        }
        const availableAfterKes = wallet.availableKes - reversal.amountKes;
        await tx.update(kesWalletAccounts).set({ availableKes: availableAfterKes }).where(eq(kesWalletAccounts.userId, wallet.userId));
        await tx.update(partnerCreditEvents).set({ status: "reversed" }).where(eq(partnerCreditEvents.transactionId, reversal.reversesTransactionId));
        await tx.update(kesWalletTransactions).set({ reason: `Partner credit reversed by administrator ${ctx.user.id}: ${input.reason}` }).where(and(eq(kesWalletTransactions.userId, wallet.userId), eq(kesWalletTransactions.idempotencyKey, `partner:${reversal.reversesTransactionId}`)));
        await tx.insert(kesWalletTransactions).values({
          userId: wallet.userId,
          transactionType: "partner_reversal",
          amountKes: reversal.amountKes,
          availableBeforeKes: wallet.availableKes,
          availableAfterKes,
          reservedBeforeKes: wallet.reservedKes,
          reservedAfterKes: wallet.reservedKes,
          status: "completed",
          idempotencyKey: `partner-reversal:${reversal.eventId}`,
          reason: input.reason,
        });
        await tx.update(partnerCreditEvents).set({ status: "reversed" }).where(eq(partnerCreditEvents.id, reversal.id));
      } else {
        await tx.update(partnerCreditEvents).set({ status: "dismissed" }).where(eq(partnerCreditEvents.id, reversal.id));
      }
      const remaining = await tx.select({ id: partnerCreditEvents.id }).from(partnerCreditEvents).where(and(eq(partnerCreditEvents.userId, reversal.userId), eq(partnerCreditEvents.status, "held_for_review"))).limit(1);
      if (!remaining.length) await tx.update(kesWalletAccounts).set({ frozen: 0, freezeReason: null }).where(eq(kesWalletAccounts.userId, reversal.userId));
      await tx.insert(adminAuditLogs).values({
        adminUserId: ctx.user.id,
        action: input.action === "reverse" ? "apply_partner_credit_reversal" : "dismiss_partner_credit_reversal",
        entityType: "partner_credit_event",
        entityId: reversal.id,
        reason: input.reason,
        details: JSON.stringify({ amountKes: reversal.amountKes, transactionId: reversal.transactionId, reversesTransactionId: reversal.reversesTransactionId, walletReference: reversal.walletReference }),
      });
      await tx.insert(notifications).values({
        userId: reversal.userId,
        type: "wallet",
        title: input.action === "reverse" ? "Partner credit reversal processed" : "Partner credit reversal dismissed",
        body: input.action === "reverse" ? `A partner-confirmed KES ${reversal.amountKes} reversal was processed with an administrator decision.` : "An administrator reviewed and dismissed a partner credit reversal.",
        entityType: "partner_credit",
        entityId: reversal.id,
      });
      return { success: true, action: input.action };
    });
  }),

  setCashWalletStatus: adminProcedure.input(z.object({
    userId: z.number().int().positive(),
    status: z.enum(["pending", "verified", "rejected"]),
    reason: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    const db = await database();
    return db.transaction(async tx => {
      const rows = await tx.select().from(profiles).where(eq(profiles.userId, input.userId)).for("update").limit(1);
      const profile = rows[0];
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Player profile was not found." });
      const previous = profile.cashWalletStatus;
      await tx.update(profiles).set({ cashWalletStatus: input.status }).where(eq(profiles.userId, input.userId));
      await tx.insert(adminAuditLogs).values({
        adminUserId: ctx.user.id,
        action: "change_kes_wallet_verification",
        entityType: "user",
        entityId: input.userId,
        reason: input.reason,
        details: JSON.stringify({ from: previous, to: input.status }),
      });
      await tx.insert(notifications).values({
        userId: input.userId,
        type: "wallet",
        title: "KES wallet status updated",
        body: `An administrator changed your KES wallet status to ${input.status}.`,
        entityType: "user",
        entityId: input.userId,
      });
      return { success: true, previous, status: input.status };
    });
  }),
});

class PartnerCallbackError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function applyPartnerCredit(event: NonNullable<ReturnType<typeof parsePartnerCreditEvent>>) {
  const config = getKesWalletConfig();
  if (!config || !isValidKesAmount(event.amountKes, config.minDeposit, config.maxDeposit)) {
    throw new PartnerCallbackError(400, "Credit amount is outside configured limits.");
  }
  const db = await database();
  try {
    return await db.transaction(async tx => {
      const priorEvent = await tx.select().from(partnerCreditEvents).where(eq(partnerCreditEvents.eventId, event.eventId)).for("update").limit(1);
      if (priorEvent[0]) {
        const same = priorEvent[0].transactionId === event.transactionId && priorEvent[0].eventType === event.eventType && priorEvent[0].walletReference === event.walletReference && priorEvent[0].amountKes === event.amountKes && priorEvent[0].reversesTransactionId === (event.eventType === "reversal" ? event.reversesTransactionId : null);
        if (!same) throw new PartnerCallbackError(409, "Event ID was previously used for different event data.");
        return { duplicate: true, reviewRequired: priorEvent[0].status === "held_for_review" };
      }
      const priorTransaction = await tx.select().from(partnerCreditEvents).where(eq(partnerCreditEvents.transactionId, event.transactionId)).for("update").limit(1);
      if (priorTransaction[0]) throw new PartnerCallbackError(409, "Transaction ID has already been used.");
      const wallets = await tx.select().from(kesWalletAccounts).where(eq(kesWalletAccounts.walletReference, event.walletReference)).for("update").limit(1);
      const wallet = wallets[0];
      if (!wallet) throw new PartnerCallbackError(404, "Wallet reference was not found.");
      const partnerOccurredAt = event.occurredAt ? new Date(event.occurredAt) : null;
      if (event.eventType === "credit") {
        const availableAfterKes = wallet.availableKes + event.amountKes;
        if (!Number.isSafeInteger(availableAfterKes) || availableAfterKes > 2_147_483_647) throw new PartnerCallbackError(409, "Wallet balance would exceed the supported range.");
        const inserted = await tx.insert(partnerCreditEvents).values({ eventId: event.eventId, transactionId: event.transactionId, eventType: "credit", userId: wallet.userId, walletReference: event.walletReference, amountKes: event.amountKes, currency: event.currency, status: "credited", partnerOccurredAt });
        const eventRecordId = Number((inserted as any)[0]?.insertId ?? 0);
        await tx.update(kesWalletAccounts).set({ availableKes: availableAfterKes }).where(eq(kesWalletAccounts.userId, wallet.userId));
        await tx.insert(kesWalletTransactions).values({ userId: wallet.userId, transactionType: "partner_credit", amountKes: event.amountKes, availableBeforeKes: wallet.availableKes, availableAfterKes, reservedBeforeKes: wallet.reservedKes, reservedAfterKes: wallet.reservedKes, status: "completed", idempotencyKey: `partner:${event.eventId}`, reason: `Partner-confirmed KES credit; transaction ${event.transactionId}.` });
        await tx.insert(notifications).values({ userId: wallet.userId, type: "wallet", title: "KES credits received", body: `KES ${event.amountKes} was added from partner transaction ${event.transactionId}.`, entityType: "partner_credit", entityId: eventRecordId || null });
        return { duplicate: false, reviewRequired: false };
      }

      const originalRows = await tx.select().from(partnerCreditEvents).where(eq(partnerCreditEvents.transactionId, event.reversesTransactionId)).for("update").limit(1);
      const original = originalRows[0];
      if (!original || original.eventType !== "credit" || original.status !== "credited" || original.walletReference !== event.walletReference || original.amountKes !== event.amountKes) {
        throw new PartnerCallbackError(409, "Reversal must reference one unreversed matching partner credit.");
      }
      const needsReview = wallet.frozen === 1 || wallet.reservedKes > 0 || wallet.availableKes < event.amountKes;
      const inserted = await tx.insert(partnerCreditEvents).values({ eventId: event.eventId, transactionId: event.transactionId, eventType: "reversal", reversesTransactionId: event.reversesTransactionId, userId: wallet.userId, walletReference: event.walletReference, amountKes: event.amountKes, currency: event.currency, status: needsReview ? "held_for_review" : "reversed", partnerOccurredAt });
      const eventRecordId = Number((inserted as any)[0]?.insertId ?? 0);
      if (needsReview) {
        const reason = `Partner reversal ${event.eventId} requires review; no negative balance was created.`;
        await tx.update(kesWalletAccounts).set({ frozen: 1, freezeReason: wallet.freezeReason ?? reason }).where(eq(kesWalletAccounts.userId, wallet.userId));
        await tx.insert(kesWalletTransactions).values({ userId: wallet.userId, transactionType: "partner_reversal_review", amountKes: event.amountKes, availableBeforeKes: wallet.availableKes, availableAfterKes: wallet.availableKes, reservedBeforeKes: wallet.reservedKes, reservedAfterKes: wallet.reservedKes, status: "review", idempotencyKey: `partner-reversal-review:${event.eventId}`, reason });
        await tx.insert(notifications).values({ userId: wallet.userId, type: "wallet", title: "KES wallet under review", body: "A partner-confirmed reversal needs administrator review. KES wagering and withdrawals are paused while it is investigated.", entityType: "partner_credit", entityId: eventRecordId || null });
        const admins = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
        for (const admin of admins) await tx.insert(notifications).values({ userId: admin.id, type: "partner_reversal_review", title: "Partner credit reversal needs review", body: `Player #${wallet.userId} · KES ${event.amountKes} · event ${event.eventId}.`, entityType: "partner_credit", entityId: eventRecordId || null });
        return { duplicate: false, reviewRequired: true };
      }
      const availableAfterKes = wallet.availableKes - event.amountKes;
      await tx.update(kesWalletAccounts).set({ availableKes: availableAfterKes }).where(eq(kesWalletAccounts.userId, wallet.userId));
      await tx.update(partnerCreditEvents).set({ status: "reversed" }).where(eq(partnerCreditEvents.transactionId, original.transactionId));
      await tx.insert(kesWalletTransactions).values({ userId: wallet.userId, transactionType: "partner_reversal", amountKes: event.amountKes, availableBeforeKes: wallet.availableKes, availableAfterKes, reservedBeforeKes: wallet.reservedKes, reservedAfterKes: wallet.reservedKes, status: "completed", idempotencyKey: `partner-reversal:${event.eventId}`, reason: `Partner-confirmed reversal of transaction ${original.transactionId}.` });
      await tx.insert(notifications).values({ userId: wallet.userId, type: "wallet", title: "Partner credit reversed", body: `A partner-confirmed KES ${event.amountKes} credit reversal was applied.`, entityType: "partner_credit", entityId: eventRecordId || null });
      return { duplicate: false, reviewRequired: false };
    });
  } catch (error) {
    if (error instanceof PartnerCallbackError) throw error;
    // A simultaneous redelivery can lose the unique-index race after both requests checked.
    const committed = await db.select().from(partnerCreditEvents).where(eq(partnerCreditEvents.eventId, event.eventId)).limit(1);
    if (committed.length) {
      const record = committed[0];
      const same = record.transactionId === event.transactionId && record.eventType === event.eventType && record.walletReference === event.walletReference && record.amountKes === event.amountKes && record.reversesTransactionId === (event.eventType === "reversal" ? event.reversesTransactionId : null);
      if (!same) throw new PartnerCallbackError(409, "Event ID was previously used for different event data.");
      return { duplicate: true, reviewRequired: record.status === "held_for_review" };
    }
    const transaction = await db.select({ id: partnerCreditEvents.id }).from(partnerCreditEvents).where(eq(partnerCreditEvents.transactionId, event.transactionId)).limit(1);
    if (transaction.length) throw new PartnerCallbackError(409, "Transaction ID has already been used.");
    if (event.eventType === "reversal") {
      const reversal = await db.select({ id: partnerCreditEvents.id }).from(partnerCreditEvents).where(eq(partnerCreditEvents.reversesTransactionId, event.reversesTransactionId)).limit(1);
      if (reversal.length) throw new PartnerCallbackError(409, "The referenced credit already has a reversal event.");
    }
    throw error;
  }
}

export function registerPartnerCreditRoute(app: Express): void {
  app.post("/api/partner/v1/credit-events", express.raw({ type: "application/json", limit: "16kb" }), async (req: Request, res: Response) => {
    const config = getKesWalletConfig();
    if (!config) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }
    if (!Buffer.isBuffer(req.body)) {
      res.status(415).json({ ok: false, error: "expected_application_json" });
      return;
    }
    if (!verifyPartnerSignature({
      secret: config.partnerSecret,
      timestamp: req.get("x-pace-timestamp"),
      signature: req.get("x-pace-signature"),
      rawBody: req.body,
    })) {
      res.status(401).json({ ok: false, error: "invalid_signature" });
      return;
    }
    const event = parsePartnerCreditEvent(req.body);
    if (!event) {
      res.status(400).json({ ok: false, error: "invalid_event" });
      return;
    }
    try {
      const result = await applyPartnerCredit(event);
      res.status(200).json({ ok: true, duplicate: result.duplicate, ...(result.reviewRequired ? { reviewRequired: true } : {}) });
    } catch (error) {
      if (error instanceof PartnerCallbackError) {
        res.status(error.status).json({ ok: false, error: error.message });
        return;
      }
      console.error("[Pace Arena partner callback] Credit could not be committed:", error instanceof Error ? error.message : "unknown error");
      res.status(503).json({ ok: false, error: "credit_not_committed_retry_same_event" });
    }
  });
}
