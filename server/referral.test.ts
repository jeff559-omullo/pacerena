import { describe, expect, it } from "vitest";
import { buildReferralUrl, calculateReferralCommission, normalizeReferralCode } from "./referral";

describe("referral utilities", () => {
  it("normalizes referral codes consistently", () => {
    expect(normalizeReferralCode("  ab-cd123  ")).toBe("ABCD123");
    expect(normalizeReferralCode("bad!code")).toBe("BADCODE");
  });

  it("builds a referral registration URL with the code parameter", () => {
    expect(buildReferralUrl("ABCD123")).toContain("/register");
    expect(buildReferralUrl("ABCD123")).toContain("ref=ABCD123");
  });

  it("calculates commission from qualifying transactions", () => {
    const commission = calculateReferralCommission(500, {
      defaultPercentage: 5,
      fixedAmount: 25,
      maxCommissionPerTransaction: 500,
      minimumQualifyingAmount: 100,
    });
    expect(commission).toBe(50);
  });

  it("zeroes out non-qualifying transactions", () => {
    expect(calculateReferralCommission(99, {
      defaultPercentage: 5,
      fixedAmount: 25,
      maxCommissionPerTransaction: 500,
      minimumQualifyingAmount: 100,
    })).toBe(0);
  });
});
