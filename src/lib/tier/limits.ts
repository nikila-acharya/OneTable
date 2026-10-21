/** AC01 tiers. Member limits per tier (PRD 5.1: Free = 1 member, Household up to 8 [Proposed]). */
export const TIERS = ["free", "household"] as const;
export type Tier = (typeof TIERS)[number];

export const MEMBER_LIMIT: Record<Tier, number> = { free: 1, household: 8 };

export class TierLimitError extends Error {
  readonly code = "upgrade_required" as const;
  constructor(readonly tier: Tier, readonly limit: number) {
    super(`your ${tier} plan includes ${limit} member${limit === 1 ? "" : "s"}; upgrade to add more`);
    this.name = "TierLimitError";
  }
}
