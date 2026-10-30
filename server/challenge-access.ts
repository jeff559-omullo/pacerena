export interface ChallengeDetailAccessRecord {
  creatorId: number;
  opponentId: number | null;
  status: string;
  expiresAt: Date;
}

/** Public open fixtures are readable by any signed-in player until expiry.
 * Private invitations and non-open challenges remain restricted to their parties.
 */
export function canViewChallengeDetails(
  challenge: ChallengeDetailAccessRecord,
  viewerId: number,
  now = Date.now(),
): boolean {
  if (challenge.creatorId === viewerId || challenge.opponentId === viewerId) return true;

  return challenge.opponentId === null
    && challenge.status === "open"
    && challenge.expiresAt.getTime() > now;
}
