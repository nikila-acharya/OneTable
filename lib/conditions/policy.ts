/**
 * WP-1.4 — SG01 policy table: what each listed condition does to planning.
 *
 * This is a RULES GATE, NOT AI (PRD 5.2 SG01): pure data, evaluated
 * deterministically. No LLM output ever becomes a rule, target or advice
 * (guardrail SG-G).
 *
 * Decisions (see docs/decisions/114-sg01-condition-gate-contract.md):
 *  - Every listed condition EXCEPT `other` puts the member in
 *    general-guidance mode with the persistent clinician banner. SG01 bullet 1
 *    lists the safety-critical subset; SG-C ("Listed conditions →
 *    general-guidance mode with the clinician banner until a clinician target
 *    exists") reads over the whole PR03 list, and in a safety feature the
 *    superset is the fail-safe choice. Celiac additionally gets the hard
 *    gluten filter; hypertension/high cholesterol additionally get DGA
 *    awareness notes only, no specific targets (SG01 bullet 3, Proposed,
 *    needs RD review).
 *  - `other` is explicitly "not acted on" (PR03) — but an unrecognized slug
 *    still fails safe into general-guidance mode (see gate.ts).
 *  - No member-specific nutrient targets exist in the MVP at all; clinician
 *    targets are the LATER `clinician_target` table. The gate is what enforces
 *    their absence for listed-condition members.
 */

import type { ConditionSlug } from './enum.js';

export interface ConditionPolicy {
  /** General-guidance mode + persistent clinician banner + LLM advice suppressed. */
  readonly generalGuidance: boolean;
  /** Hard gluten filter, treated like an allergen (celiac only). */
  readonly glutenHardFilter: boolean;
  /** General DGA awareness areas — display-only notes, never numeric targets. */
  readonly dgaAwareness: readonly ('sodium' | 'saturated_fat')[];
  /** PRD confidence tag; 'Proposed' rows need RD review (Gate B). */
  readonly confidence: 'Certain' | 'Likely' | 'Proposed';
}

export const CONDITION_POLICIES: Readonly<Record<ConditionSlug, ConditionPolicy>> = {
  type_1_diabetes: { generalGuidance: true, glutenHardFilter: false, dgaAwareness: [], confidence: 'Certain' },
  type_2_diabetes: { generalGuidance: true, glutenHardFilter: false, dgaAwareness: [], confidence: 'Certain' },
  prediabetes: { generalGuidance: true, glutenHardFilter: false, dgaAwareness: [], confidence: 'Likely' },
  hypertension: { generalGuidance: true, glutenHardFilter: false, dgaAwareness: ['sodium'], confidence: 'Proposed' },
  chronic_kidney_disease: { generalGuidance: true, glutenHardFilter: false, dgaAwareness: [], confidence: 'Certain' },
  heart_failure: { generalGuidance: true, glutenHardFilter: false, dgaAwareness: [], confidence: 'Certain' },
  high_cholesterol: { generalGuidance: true, glutenHardFilter: false, dgaAwareness: ['saturated_fat'], confidence: 'Proposed' },
  celiac_disease: { generalGuidance: true, glutenHardFilter: true, dgaAwareness: [], confidence: 'Certain' },
  pregnancy: { generalGuidance: true, glutenHardFilter: false, dgaAwareness: [], confidence: 'Certain' },
  breastfeeding: { generalGuidance: true, glutenHardFilter: false, dgaAwareness: [], confidence: 'Likely' },
  eating_disorder_history: { generalGuidance: true, glutenHardFilter: false, dgaAwareness: [], confidence: 'Certain' },
  food_drug_interactions: { generalGuidance: true, glutenHardFilter: false, dgaAwareness: [], confidence: 'Certain' },
  other: { generalGuidance: false, glutenHardFilter: false, dgaAwareness: [], confidence: 'Certain' },
};
