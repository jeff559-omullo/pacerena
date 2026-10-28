export const GAME_LABELS = {
  efootball: "eFootball / PES",
  ea_fc: "EA Sports FC / FIFA",
} as const;

export const PLATFORM_LABELS = {
  android: "Android",
  ios: "iPhone / iPad",
  pc: "PC",
  ps4: "PlayStation 4",
  ps5: "PlayStation 5",
  xbox_one: "Xbox One",
  xbox_series: "Xbox Series X|S",
  switch: "Nintendo Switch",
} as const;

export type GameFamily = keyof typeof GAME_LABELS;
export type Platform = keyof typeof PLATFORM_LABELS;
export type MatchState =
  | "DRAFT"
  | "OPEN"
  | "ACCEPTED"
  | "AWAITING_STAKES"
  | "READY"
  | "IN_PROGRESS"
  | "AWAITING_EVIDENCE"
  | "UNDER_REVIEW"
  | "COMPLETED"
  | "DRAWN"
  | "CANCELLED"
  | "REFUNDED";

export type DisputeStatus = "OPEN" | "INVESTIGATING" | "RESOLVED" | "REJECTED";

export function canTransitionDispute(from: DisputeStatus, to: DisputeStatus): boolean {
  if (from === "RESOLVED" || from === "REJECTED") return false;
  if (to === "INVESTIGATING") return from === "OPEN" || from === "INVESTIGATING";
  return (to === "RESOLVED" || to === "REJECTED") && (from === "OPEN" || from === "INVESTIGATING");
}

export const STAKE_MIN = 10;
export const STAKE_MAX = 5000;
export const STARTER_CREDITS = 1000;
export const EVIDENCE_WINDOW_MS = 5 * 60 * 1000;
export const READY_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_MATCH_MINUTES = 12;

export function validateStakeBounds(stake: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(stake) && Number.isInteger(minimum) && Number.isInteger(maximum) &&
    minimum >= STAKE_MIN && maximum <= STAKE_MAX && minimum <= maximum &&
    stake >= minimum && stake <= maximum;
}

const transitions: Record<MatchState, MatchState[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["AWAITING_STAKES", "CANCELLED"],
  AWAITING_STAKES: ["READY", "CANCELLED", "UNDER_REVIEW"],
  READY: ["IN_PROGRESS", "CANCELLED", "UNDER_REVIEW"],
  IN_PROGRESS: ["AWAITING_EVIDENCE", "CANCELLED", "UNDER_REVIEW"],
  AWAITING_EVIDENCE: ["COMPLETED", "DRAWN", "UNDER_REVIEW", "CANCELLED"],
  UNDER_REVIEW: ["COMPLETED", "DRAWN", "CANCELLED", "REFUNDED"],
  COMPLETED: [],
  DRAWN: [],
  CANCELLED: ["REFUNDED"],
  REFUNDED: [],
};

export function canTransition(from: MatchState, to: MatchState): boolean {
  return transitions[from]?.includes(to) ?? false;
}

/** Conservative demo rule: match the same game family, exact edition, and exact platform. */
export function areCompatible(input: {
  gameA: GameFamily;
  gameB: GameFamily;
  editionA: string;
  editionB: string;
  platformA: Platform;
  platformB: Platform;
}): boolean {
  return input.gameA === input.gameB &&
    input.editionA.trim().toLowerCase() === input.editionB.trim().toLowerCase() &&
    input.platformA === input.platformB;
}

export function normalizeEmail(email: string): string {
  return email.trim().normalize("NFKC").toLowerCase();
}

export function validateScorePair(scoreFor: number, scoreAgainst: number): boolean {
  return Number.isInteger(scoreFor) && Number.isInteger(scoreAgainst) &&
    scoreFor >= 0 && scoreFor <= 99 && scoreAgainst >= 0 && scoreAgainst <= 99;
}
