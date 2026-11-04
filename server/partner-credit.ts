import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const signaturePattern = /^sha256=([a-f0-9]{64})$/i;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const sharedFields = {
  eventId: z.string().regex(idPattern),
  transactionId: z.string().regex(idPattern),
  walletReference: z.string().regex(/^PA[A-F0-9]{30}$/),
  amountKes: z.number().int().positive().max(1_000_000_000),
  currency: z.literal("KES"),
  status: z.literal("paid"),
  occurredAt: z.string().datetime({ offset: true }).optional(),
};

export const partnerCreditEventSchema = z.discriminatedUnion("eventType", [
  z.object({ ...sharedFields, eventType: z.literal("credit"), reversesTransactionId: z.never().optional() }).strict(),
  z.object({ ...sharedFields, eventType: z.literal("reversal"), reversesTransactionId: z.string().regex(idPattern) }).strict(),
]);

export type PartnerCreditEvent = z.infer<typeof partnerCreditEventSchema>;

export function signPartnerRequest(secret: string, timestamp: string, rawBody: Buffer | string): string {
  return `sha256=${createHmac("sha256", secret).update(timestamp).update(".").update(rawBody).digest("hex")}`;
}

export function verifyPartnerSignature(input: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: Buffer;
  nowMs?: number;
}): boolean {
  const { secret, timestamp, signature, rawBody } = input;
  if (Buffer.byteLength(secret) < 32 || !timestamp || !/^\d{10}$/.test(timestamp) || !signature) return false;
  const match = signaturePattern.exec(signature);
  if (!match) return false;

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) return false;

  const expected = Buffer.from(signPartnerRequest(secret, timestamp, rawBody).slice("sha256=".length), "hex");
  const supplied = Buffer.from(match[1], "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function parsePartnerCreditEvent(rawBody: Buffer): PartnerCreditEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
  const parsed = partnerCreditEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
