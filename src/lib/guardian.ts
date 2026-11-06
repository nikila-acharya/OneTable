/**
 * WP-4.2 Guardian: Security gate SG01 (condition gate for CKD, diabetes, etc).
 * Setup agent respects this: CKD → general_guidance mode, no member targets.
 */

import { type Condition, GENERAL_GUIDANCE_CONDITIONS } from "./health/enums";

export type SecurityGateMode = "normal" | "general_guidance" | "restricted";

export interface SecurityGateResult {
  readonly mode: SecurityGateMode;
  readonly allowed: boolean;
  readonly reason: string;
  readonly triggeredConditions: readonly Condition[];
}

/**
 * SG01: Evaluate condition gate for member.
 * If member has CKD, diabetes, heart failure, pregnancy, or similar conditions,
 * switch to general_guidance mode (rules-based, no AI member-level advice).
 */
export function evaluateSG01Gate(conditions: readonly unknown[] | null | undefined): SecurityGateResult {
  const recognized: Condition[] = [];

  for (const c of conditions ?? []) {
    if (typeof c === "string" && (GENERAL_GUIDANCE_CONDITIONS.has(c as Condition))) {
      recognized.push(c as Condition);
    }
  }

  const triggered = recognized.filter(
    (c) => GENERAL_GUIDANCE_CONDITIONS.has(c),
  );

  if (triggered.length > 0) {
    return {
      mode: "general_guidance",
      allowed: true,
      reason: `Member has ${triggered.length} condition(s) requiring general guidance mode`,
      triggeredConditions: triggered,
    };
  }

  return {
    mode: "normal",
    allowed: true,
    reason: "No conditions requiring gating",
    triggeredConditions: [],
  };
}

/**
 * Check if a condition is a critical health condition that gates behavior.
 */
export function isCriticalCondition(condition: unknown): boolean {
  return typeof condition === "string" && GENERAL_GUIDANCE_CONDITIONS.has(condition as Condition);
}
