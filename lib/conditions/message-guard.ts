/**
 * WP-1.4 — deterministic message guard for SG01 members (PRD 7.3 checks 1–3).
 *
 * Scope boundary: 7.3 runs the deterministic checks FIRST, then the Safety
 * Guardian's LLM check (WP-4.2, M4). This module is only the deterministic
 * seed that the gate (SG01) needs to honor "no LLM generates advice for these
 * members" and the 6.4 regulatory line. The semantic "is this medical advice"
 * classifier belongs to the Guardian in M4 — this layer catches the
 * unambiguous markers and the fixed-copy substitution path.
 *
 * 7.3 semantics implemented here: "If a check fails, the message is
 * regenerated once with the failure reason. If it fails again, a safe fallback
 * message is shown. Every failure is logged for the eval suite."
 */

import {
  CLINICIAN_BANNER_COPY,
  CLINICIAN_CONFIRM_MESSAGE,
  findBannedTerms,
  under18AdviceViolations,
} from './copy.js';
import type { ConditionGateResult } from './gate.js';

export interface MessageGuardContext {
  /** Gate results for the members referenced by this turn (any household member counts). */
  readonly gates: readonly ConditionGateResult[];
  /** Display names of household members under 18 (7.3 check 2). */
  readonly underageNames?: readonly string[];
}

export interface MessageGuardFinding {
  readonly check: 'banned_copy' | 'under18' | 'gated_advice';
  readonly detail: string;
}

export interface MessageGuardResult {
  readonly allowed: boolean;
  readonly findings: readonly MessageGuardFinding[];
  /** True when at least one referenced member is in general-guidance mode. */
  readonly anyGated: boolean;
}

/**
 * Deterministic clinical/condition-management markers (6.4 disease-management
 * side + SG01). Deliberately narrow: only terms that are member-specific
 * medical guidance, NOT general DGA language (general guidance for sodium,
 * saturated fat, etc. stays allowed in this mode).
 */
export const GATED_ADVICE_MARKERS: readonly string[] = [
  'insulin',
  'glucose',
  'blood sugar',
  'a1c',
  'glycemic index',
  'carb target',
  'carb ratio',
  'bolus',
  'blood pressure target',
  'sodium target',
  'potassium target',
  'fluid restriction',
  'cholesterol target',
  'warfarin',
  'vitamin k target',
  'dose',
  'dosing',
  'safe to eat while pregnant',
  'kidney-safe',
  'renal diet',
  'dialysis',
];

export function findGatedAdviceMarkers(text: string): string[] {
  const lower = text.toLowerCase();
  return GATED_ADVICE_MARKERS.filter((m) => lower.includes(m));
}

/**
 * Run the deterministic part of the 7.3 message guard on one outgoing
 * message. Blocking is all-or-nothing per check: the first two checks always
 * apply; the gated-advice marker check applies only when the turn references
 * a member in general-guidance mode (SG01).
 */
export function guardMessage(
  text: string,
  ctx: MessageGuardContext,
): MessageGuardResult {
  const findings: MessageGuardFinding[] = [];
  const anyGated = ctx.gates.some((g) => g.mode === 'general_guidance');

  for (const term of findBannedTerms(text)) {
    findings.push({ check: 'banned_copy', detail: `banned term: "${term}"` });
  }

  for (const v of under18AdviceViolations(text, ctx.underageNames ?? [])) {
    findings.push({ check: 'under18', detail: v });
  }

  if (anyGated) {
    for (const marker of findGatedAdviceMarkers(text)) {
      findings.push({
        check: 'gated_advice',
        detail: `medical/condition-specific marker "${marker}" in a turn referencing a general-guidance member`,
      });
    }
  }

  return { allowed: findings.length === 0, findings, anyGated };
}

/**
 * Build the fixed SG01 reply: the clinician-confirm message plus any matching
 * HT01 tips appended VERBATIM, each with its source (7.3 check 3, SG-E).
 * The agent never rewrites these strings — callers pass tip text unchanged.
 */
export interface ClinicianTip {
  readonly text: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
}

export function clinicianConfirmReply(tips: readonly ClinicianTip[] = []): string {
  const lines: string[] = [CLINICIAN_CONFIRM_MESSAGE];
  for (const tip of tips) {
    lines.push(`${tip.text} — ${tip.sourceName} (${tip.sourceUrl})`);
  }
  return lines.join('\n');
}

export type GuardDecision =
  | { readonly outcome: 'pass'; readonly text: string }
  | { readonly outcome: 'regenerate'; readonly reason: string }
  | { readonly outcome: 'fallback'; readonly text: string; readonly logged: true };

/**
 * The 7.3 retry sequence as a pure function. `attempt` is 1 for the first
 * guard pass over the draft, 2 after one regeneration. On the second failure
 * (or beyond) the safe fallback is shown: for gated turns the fixed
 * clinician-confirm reply, otherwise the plain banner copy — never the
 * original failing text. Every returned failure carries the reason for the
 * eval log.
 */
export function decideAfterGuard(
  text: string,
  ctx: MessageGuardContext,
  attempt: 1 | 2,
): GuardDecision {
  const result = guardMessage(text, ctx);
  if (result.allowed) return { outcome: 'pass', text };
  const reason = result.findings.map((f) => `${f.check}: ${f.detail}`).join('; ');
  if (attempt === 1) return { outcome: 'regenerate', reason };
  return {
    outcome: 'fallback',
    text: result.anyGated ? clinicianConfirmReply() : CLINICIAN_BANNER_COPY,
    logged: true,
  };
}
