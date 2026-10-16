/**
 * WP-1.4 — canonical condition enum slugs (PRD 5.2 PR03).
 *
 * CONTRACT NOTE (see docs/decisions/114-sg01-condition-gate-contract.md):
 * WP-1.3 owns the encrypted `member_health` table and validates writes
 * against its enum in `lib/health/enums.ts` (PR03 AC: "the API rejects any
 * condition value not in the enum"), so both tables MUST hold identical
 * slugs. The canonical spelling is taken FROM THE PRD, not from either
 * branch: SG01 bullet 1 names the condition "food-drug interactions"
 * verbatim -> slug `food_drug_interactions`; PR03 gives the display wording
 * "takes medication with food interactions (e.g. warfarin)" -> the label
 * below. WP-1.3's current WIP (t_c70ea08c, 2026-10-16) mirrors this table as
 * `medication_food_interactions`, which matches neither PRD section; a
 * hotspot comment has asked WP-1.3 to align to the PRD spelling here
 * (WP-1.3's own heartbeat already accepted "WP-1.4 canonical condition
 * slugs" as the source). `tests/enum.test.ts` pins the full list as the
 * interop contract. Post-merge, keep ONE slug table in `main` — this file
 * shrinks to a re-export of `lib/health/enums.ts` plus the WP-1.4-only
 * phrase map below, or vice versa, whichever the lead lands first.
 *
 * No free-text conditions are ever stored (PR03).
 */

export const CONDITION_SLUGS = [
  'type_1_diabetes',
  'type_2_diabetes',
  'prediabetes',
  'hypertension',
  'chronic_kidney_disease',
  'heart_failure',
  'high_cholesterol',
  'celiac_disease',
  'pregnancy',
  'breastfeeding',
  'eating_disorder_history',
  'food_drug_interactions',
  'other',
] as const;

export type ConditionSlug = (typeof CONDITION_SLUGS)[number];

export function isConditionSlug(value: unknown): value is ConditionSlug {
  return typeof value === 'string' && (CONDITION_SLUGS as readonly string[]).includes(value);
}

/** Plain-language display names (UI chips, review cards). NF-5 tone. */
export const CONDITION_LABELS: Record<ConditionSlug, string> = {
  type_1_diabetes: 'Type 1 diabetes',
  type_2_diabetes: 'Type 2 diabetes',
  prediabetes: 'Prediabetes',
  hypertension: 'High blood pressure',
  chronic_kidney_disease: 'Chronic kidney disease',
  heart_failure: 'Heart failure',
  high_cholesterol: 'High cholesterol',
  celiac_disease: 'Celiac disease',
  pregnancy: 'Pregnancy',
  breastfeeding: 'Breastfeeding',
  eating_disorder_history: 'Eating-disorder history',
  food_drug_interactions: 'Takes medication with food interactions',
  other: 'Other (not used for planning)',
};

/**
 * Agent-side mapping aid (Household Setup agent, PR03: "the agent maps it to
 * the list and asks for confirmation"). Deterministic phrase → slug table;
 * anything unmatched goes to `null` and the agent asks instead of guessing.
 */
export const CONDITION_PHRASE_MAP: Readonly<Record<string, ConditionSlug>> = {
  'type 1 diabetes': 'type_1_diabetes',
  't1d': 'type_1_diabetes',
  'type 2 diabetes': 'type_2_diabetes',
  't2d': 'type_2_diabetes',
  'diabetes': 'type_2_diabetes', // ambiguous → agent must confirm which type
  'prediabetes': 'prediabetes',
  'high blood pressure': 'hypertension',
  'hypertension': 'hypertension',
  'kidney disease': 'chronic_kidney_disease',
  'ckd': 'chronic_kidney_disease',
  'heart failure': 'heart_failure',
  'high cholesterol': 'high_cholesterol',
  'hyperlipidemia': 'high_cholesterol',
  'celiac': 'celiac_disease',
  'coeliac': 'celiac_disease',
  'gluten intolerance': 'celiac_disease', // agent must confirm; not the same as NCGS
  'pregnant': 'pregnancy',
  'pregnancy': 'pregnancy',
  'breastfeeding': 'breastfeeding',
  'nursing': 'breastfeeding',
  'eating disorder': 'eating_disorder_history',
  'anorexia': 'eating_disorder_history',
  'bulimia': 'eating_disorder_history',
  'warfarin': 'food_drug_interactions',
  'coumadin': 'food_drug_interactions',
  'methotrexate': 'food_drug_interactions',
};
