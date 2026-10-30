import { describe, expect, it } from "vitest";
import { canViewChallengeDetails } from "./challenge-access";

const now = Date.parse("2026-10-30T17:04:00.000Z");

function challenge(overrides: Partial<{
  creatorId: number;
  opponentId: number | null;
  status: string;
  expiresAt: Date;
}> = {}) {
  return {
    creatorId: 10,
    opponentId: null,
    status: "open",
    expiresAt: new Date(now + 60_000),
    ...overrides,
  };
}

describe("challenge detail access", () => {
  it("lets a signed-in nonparticipant view an unexpired public open challenge", () => {
    expect(canViewChallengeDetails(challenge(), 20, now)).toBe(true);
  });

  it("keeps a direct invitation visible only to its creator and selected invitee", () => {
    const invite = challenge({ opponentId: 30 });
    expect(canViewChallengeDetails(invite, 10, now)).toBe(true);
    expect(canViewChallengeDetails(invite, 30, now)).toBe(true);
    expect(canViewChallengeDetails(invite, 20, now)).toBe(false);
  });

  it("hides an expired or closed public challenge from nonparticipants", () => {
    expect(canViewChallengeDetails(challenge({ expiresAt: new Date(now) }), 20, now)).toBe(false);
    expect(canViewChallengeDetails(challenge({ status: "cancelled" }), 20, now)).toBe(false);
    expect(canViewChallengeDetails(challenge({ status: "cancelled" }), 10, now)).toBe(true);
  });

  it("restricts an accepted public challenge to its two participants", () => {
    const accepted = challenge({ opponentId: 20, status: "accepted" });
    expect(canViewChallengeDetails(accepted, 10, now)).toBe(true);
    expect(canViewChallengeDetails(accepted, 20, now)).toBe(true);
    expect(canViewChallengeDetails(accepted, 30, now)).toBe(false);
  });
});
