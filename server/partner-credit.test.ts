import { describe, expect, it } from "vitest";
import { parsePartnerCreditEvent, signPartnerRequest, verifyPartnerSignature } from "./partner-credit";

const secret = "a-test-only-partner-key-with-at-least-32-bytes";
const event = {
  eventId: "event_20261103_0000001",
  transactionId: "txn_20261103_0000001",
  walletReference: "PA0123456789ABCDEF0123456789ABCD",
  amountKes: 500,
  currency: "KES",
  status: "paid",
  occurredAt: "2026-11-03T17:00:00.000Z",
};
const payload = Buffer.from(JSON.stringify({ ...event, eventType: "credit" }));

function signed(nowMs = 1_798_726_800_000, body = payload) {
  const timestamp = String(Math.floor(nowMs / 1000));
  return { timestamp, signature: signPartnerRequest(secret, timestamp, body), rawBody: body, nowMs };
}

describe("partner credit callback protocol", () => {
  it("accepts a fresh HMAC over the exact raw body", () => {
    expect(verifyPartnerSignature({ secret, ...signed() })).toBe(true);
  });

  it("rejects a stale timestamp", () => {
    const request = signed(1_798_726_800_000);
    expect(verifyPartnerSignature({ secret, ...request, nowMs: request.nowMs + 10 * 60_000 })).toBe(false);
  });

  it("rejects body changes and malformed signatures", () => {
    const request = signed();
    const changed = Buffer.from(payload.toString("utf8").replace("500", "501"));
    expect(verifyPartnerSignature({ secret, ...request, rawBody: changed })).toBe(false);
    expect(verifyPartnerSignature({ secret, ...request, signature: "sha256=bad" })).toBe(false);
  });

  it("parses only well-formed credits and linked reversals", () => {
    expect(parsePartnerCreditEvent(payload)?.amountKes).toBe(500);
    const reversal = Buffer.from(JSON.stringify({ ...event, eventType: "reversal", transactionId: "txn_reverse_0001", reversesTransactionId: event.transactionId }));
    expect(parsePartnerCreditEvent(reversal)?.eventType).toBe("reversal");
    expect(parsePartnerCreditEvent(Buffer.from("{"))).toBeNull();
    expect(parsePartnerCreditEvent(Buffer.from(JSON.stringify({ ...event, eventType: "credit", currency: "USD" })))).toBeNull();
    expect(parsePartnerCreditEvent(Buffer.from(JSON.stringify({ ...event, eventType: "reversal" })))).toBeNull();
    expect(parsePartnerCreditEvent(Buffer.from(JSON.stringify({ ...event, eventType: "credit", extra: "forbidden" })))).toBeNull();
  });
});
