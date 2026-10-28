import { describe, expect, it } from "vitest";
import { areCompatible, canTransition, canTransitionDispute, normalizeEmail, validateScorePair, validateStakeBounds } from "../shared/pace";

describe("Pace Arena shared match rules", () => {
  it("requires the same game family, normalized exact edition and exact platform", () => {
    const base = { gameA: "efootball" as const, gameB: "efootball" as const, editionA: "2026 Mobile", editionB: "2026 Mobile", platformA: "android" as const, platformB: "android" as const };
    expect(areCompatible(base)).toBe(true);
    expect(areCompatible({ ...base, platformB: "ios" })).toBe(false);
    expect(areCompatible({ ...base, editionB: "2025 Mobile" })).toBe(false);
    expect(areCompatible({ ...base, gameB: "ea_fc" })).toBe(false);
    expect(areCompatible({ ...base, editionB: "  2026 mobile " })).toBe(true);
  });

  it("permits intended readiness, evidence, review, settlement, and refund transitions only", () => {
    expect(canTransition("AWAITING_STAKES", "READY")).toBe(true);
    expect(canTransition("READY", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "AWAITING_EVIDENCE")).toBe(true);
    expect(canTransition("AWAITING_EVIDENCE", "UNDER_REVIEW")).toBe(true);
    expect(canTransition("UNDER_REVIEW", "DRAWN")).toBe(true);
    expect(canTransition("CANCELLED", "REFUNDED")).toBe(true);
    expect(canTransition("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("REFUNDED", "COMPLETED")).toBe(false);
    expect(canTransition("OPEN", "COMPLETED")).toBe(false);
  });

  it("keeps resolved and rejected disputes terminal and permits only documented review transitions", () => {
    expect(canTransitionDispute("OPEN", "INVESTIGATING")).toBe(true);
    expect(canTransitionDispute("INVESTIGATING", "INVESTIGATING")).toBe(true);
    expect(canTransitionDispute("OPEN", "RESOLVED")).toBe(true);
    expect(canTransitionDispute("INVESTIGATING", "REJECTED")).toBe(true);
    expect(canTransitionDispute("REJECTED", "INVESTIGATING")).toBe(false);
    expect(canTransitionDispute("REJECTED", "RESOLVED")).toBe(false);
    expect(canTransitionDispute("RESOLVED", "REJECTED")).toBe(false);
  });

  it("accepts only bounded integer score reports", () => {
    expect(validateScorePair(0, 0)).toBe(true);
    expect(validateScorePair(99, 1)).toBe(true);
    expect(validateScorePair(-1, 1)).toBe(false);
    expect(validateScorePair(2, 100)).toBe(false);
    expect(validateScorePair(1.5, 2)).toBe(false);
  });

  it("enforces administrator-configurable stakes within immutable demo-safe hard bounds", () => {
    expect(validateStakeBounds(100, 50, 500)).toBe(true);
    expect(validateStakeBounds(49, 50, 500)).toBe(false);
    expect(validateStakeBounds(501, 50, 500)).toBe(false);
    expect(validateStakeBounds(6000, 10, 6000)).toBe(false);
    expect(validateStakeBounds(100.5, 50, 500)).toBe(false);
    expect(validateStakeBounds(100, 501, 500)).toBe(false);
  });

  it("canonicalizes account emails consistently", () => {
    expect(normalizeEmail("  PLAYER@EXAMPLE.COM ")).toBe("player@example.com");
    expect(normalizeEmail(" ＰＬＡＹＥＲ@example.com ")).toBe("player@example.com");
  });
});
