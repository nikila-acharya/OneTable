/**
 * AC01 tiers, and the household-size cap.
 *
 * Owner decision 2026-11-20 (ADR-117): the app is meant to be free, so the
 * "free single member" split in PRD 5.1 is retired and both tiers carry the
 * same cap of 10 members. The per-tier map is kept rather than collapsed into
 * one constant because the `tier` column, its DB enum, tier/service.ts and the
 * summary API all key off it — deleting the tier concept is a separate call.
 */
export const TIERS = ["free", "household"] as const;
export type Tier = (typeof TIERS)[number];

export const MEMBER_LIMIT: Record<Tier, number> = { free: 10, household: 10 };

export class TierLimitError extends Error {
  readonly code = "upgrade_required" as const;
  constructor(readonly tier: Tier, readonly limit: number) {
    // The previous text ended "upgrade to add more", which is no longer a
    // route to anything: no tier grants more than `limit`. `code` keeps its
    // name because it is a stable API identifier, not user-facing prose.
    super(`a household can have at most ${limit} members`);
    this.name = "TierLimitError";
  }
}
