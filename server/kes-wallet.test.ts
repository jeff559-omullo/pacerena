import { describe, expect, it } from "vitest";
import { parseDepositConfirmationDetails } from "./kes-wallet";

describe("manual deposit confirmation parsing", () => {
  it("reads the submitted amount, M-Pesa phone and pasted message from the audit payload", () => {
    const parsed = parseDepositConfirmationDetails(JSON.stringify({
      amountKes: 2500,
      phone: "+254712345678",
      message: "Your transfer to ACC 123 was successful.",
    }));

    expect(parsed).toMatchObject({
      amountKes: 2500,
      phone: "+254712345678",
      message: "Your transfer to ACC 123 was successful.",
    });
  });

  it("returns undefined values when the audit record is missing or malformed", () => {
    expect(parseDepositConfirmationDetails(null)).toEqual({ amountKes: undefined, phone: undefined, message: undefined });
    expect(parseDepositConfirmationDetails("not-json")).toEqual({ amountKes: undefined, phone: undefined, message: undefined });
  });
});
