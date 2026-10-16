/**
 * WP-1.4 — the SG01 condition gate.
 *
 * Deterministic. No LLM anywhere in this file. The planner engine and the
 * tool layer call `evaluateConditionGate` for every member that takes part in
 * a slot; the result drives (a) the persistent clinician banner, (b) the
 * suppression of member-specific nutrient targets and LLM health advice, and
 * (c) the celiac hard gluten filter.
 *
 * PRD 5.2 SG01 AC: "a member with CKD gets no member-specific nutrient
 * target. Their profile and every plan view show the clinician banner."
 */

import { isConditionSlug, type ConditionSlug } from './enum.js';
import { CONDITION_POLICIES } from './policy.js';
import { CLINICIAN_BANNER_COPY } from './copy.js';

export type GateMode = 'general_guidance' | 'normal';

export interface ConditionGateResult {
  readonly memberId: string;
  readonly mode: GateMode;
  /** True when the persistent clinician banner must show (profile + every plan view). */
  readonly showClinicianBanner: boolean;
  /** Gated slugs found on the member, display order stable (policy table order). */
  readonly triggers: readonly ConditionSlug[];
  /** Celiac → gluten is treated like an allergen: a hard filter (SG01 bullet 3). */
  readonly glutenHardFilter: boolean;
  /** Display-only DGA awareness areas; never numeric targets. */
  readonly dgaAwareness: readonly string[];
  /**
   * Raw values that are not in the PR03 enum. WP-1.3's validation should have
   * rejected them (PR03 AC); if one still reaches the gate we FAIL SAFE into
   * general-guidance mode and surface it for logging.
   */
  readonly unrecognized: readonly string[];
  /** Exact fixed copy when the banner shows; empty string otherwise (single source of truth). */
  readonly bannerCopy: string;
}

/** Slugs in enum order, so `triggers` is deterministic regardless of input order. */
const GATED_SLUG_ORDER = Object.keys(CONDITION_POLICIES) as ConditionSlug[];

export function evaluateConditionGate(
  memberId: string,
  conditions: readonly unknown[] | null | undefined,
): ConditionGateResult {
  const recognized: ConditionSlug[] = [];
  const unrecognized: string[] = [];
  for (const c of conditions ?? []) {
    if (isConditionSlug(c)) recognized.push(c);
    else unrecognized.push(String(c));
  }

  const triggers: ConditionSlug[] = [];
  let glutenHardFilter = false;
  const dgaAwareness = new Set<string>();
  for (const slug of GATED_SLUG_ORDER) {
    if (!recognized.includes(slug)) continue;
    const policy = CONDITION_POLICIES[slug];
    if (policy.generalGuidance) triggers.push(slug);
    if (policy.glutenHardFilter) glutenHardFilter = true;
    for (const area of policy.dgaAwareness) dgaAwareness.add(area);
  }

  // Fail safe: an unrecognized condition string still triggers the gate —
  // better a needless banner than a missed one. ("other" is recognized and
  // deliberately not acted on.)
  const generalGuidance = triggers.length > 0 || unrecognized.length > 0;
  const mode: GateMode = generalGuidance ? 'general_guidance' : 'normal';

  return {
    memberId,
    mode,
    showClinicianBanner: generalGuidance,
    triggers,
    glutenHardFilter,
    dgaAwareness: [...dgaAwareness].sort(),
    unrecognized,
    bannerCopy: generalGuidance ? CLINICIAN_BANNER_COPY : '',
  };
}

/**
 * A member is "gated" for LLM-advice purposes when any household member
 * referenced in a turn is in general-guidance mode. Convenience for the
 * message guard (lib/conditions/message-guard.ts) and the planner.
 */
export function gatedMembers(
  gates: readonly ConditionGateResult[],
): ConditionGateResult[] {
  return gates.filter((g) => g.mode === 'general_guidance');
}

/**
 * SG01: no member-specific nutrient target for gated members until a
 * clinician target exists (the LATER `clinician_target` table; Gate B).
 *
 * The planner passes the target it is about to attach to this member. This
 * throws on violation — the planner must never silently drop a target, it is
 * a bug worth a red CI run (guardrail SG-H: every plan goes through the rule
 * engine).
 */
export class ConditionGateViolation extends Error {
  constructor(
    readonly memberId: string,
    readonly targetKey: string,
    message?: string,
  ) {
    super(
      message ??
        `SG01: member ${memberId} is in general-guidance mode; no member-specific nutrient target may be attached (${targetKey}).`,
    );
    this.name = 'ConditionGateViolation';
  }
}

export function assertNoMemberNutrientTarget(
  gate: ConditionGateResult,
  target: { readonly key: string } | null | undefined,
): void {
  if (gate.mode !== 'general_guidance') return;
  if (target === null || target === undefined) return;
  throw new ConditionGateViolation(gate.memberId, target.key);
}

/**
 * Sanitizing counterpart of the assert, for read paths (e.g.
 * `get_member_summary` projections or plan views) that must return
 * flags-only output rather than crash: strips any member-specific numeric
 * targets for gated members. Write/planning paths use the assert instead.
 */
export function withoutMemberTargets<T extends Record<string, unknown>>(
  gate: ConditionGateResult,
  targets: T | null,
): T | null {
  if (gate.mode !== 'general_guidance') return targets;
  return null;
}
