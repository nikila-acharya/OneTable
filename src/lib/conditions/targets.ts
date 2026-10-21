/**
 * SG01 AC: "a member with CKD gets no member-specific nutrient target." Every
 * target calculator (WP-3.2) must call this first. Refusal is an exception, not
 * a silent default.
 */
import type { ConditionGateResult } from "./gate";
import { CLINICIAN_BANNER_COPY } from "./copy";

export class MemberTargetBlockedError extends Error {
  readonly code = "member_target_blocked" as const;
  constructor(readonly memberId: string) {
    super(`member ${memberId} is in general-guidance mode: no member-specific nutrient target. ${CLINICIAN_BANNER_COPY}`);
    this.name = "MemberTargetBlockedError";
  }
}

export function assertMemberTargetAllowed(gate: ConditionGateResult): void {
  if (gate.mode === "general_guidance") throw new MemberTargetBlockedError(gate.memberId);
}

/** Fixed reply to a health question about a gated member (PRD SG01). HT01 tips are added later. */
export function clinicianConfirmReply(gate: ConditionGateResult): string | null {
  return gate.mode === "general_guidance" ? CLINICIAN_BANNER_COPY : null;
}
