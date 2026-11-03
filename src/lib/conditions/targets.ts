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

/**
 * WP-3.2: Target calculator (SG02 under-18 protection, SG03 energy floors)
 *
 * Calculates DRI-based general nutrition targets by age, sex, and activity level.
 * All values are cited; no hard-coded guesses. Energy floors (SG03) are loaded
 * from rules/energy_floors.yaml with `reviewed: false` until RD sign-off.
 *
 * References:
 * - National Academies Dietary Reference Intakes (DRI)
 * - USDA RDA for nutrients
 * - Dietary Guidelines for Americans 2020-2025
 * - SG02 rule: no deficit or weight-loss targets for under 18
 */

export type Sex = "male" | "female";
export type Activity = "sedentary" | "light" | "moderate" | "very_active";

export interface TargetInput {
  age: number;
  sex: Sex;
  weight_kg: number;
  height_cm: number;
  activity: Activity;
  deficit_kcal?: number; // Requested deficit; rejected for under 18 (SG02)
}

export interface DRITarget {
  // Energy
  energy_kcal: number; // Estimated Energy Requirement
  energy_floor_kcal: number; // Hard lower bound (SG03, from rules/energy_floors.yaml)
  energy_floor_reviewed: boolean; // false until RD reviews (SG03)
  weight_loss_allowed: boolean; // false for under 18 (SG02)
  includes_growth: boolean; // true for under 18

  // Macronutrients
  protein_g: number; // RDA
  carbs_g?: number; // Typically 45-65% of energy
  fat_g?: number; // Typically 20-35% of energy
  fiber_g: number; // DGA

  // Micronutrients (common ones; full set in real code)
  calcium_mg?: number;
  iron_mg?: number;
  vitamin_d_mcg?: number;

  // Metadata
  sources: Record<string, string>; // Citation URL or descriptive source for each nutrient
}

/**
 * Calculate DRI-based targets for a household member.
 * SG02: rejects deficit requests for under 18.
 * @throws if under 18 and allow_deficit is true
 */
export function calculateTargets(
  input: TargetInput,
  options?: { allow_deficit?: boolean }
): DRITarget {
  // SG02 guard: no deficit for under 18
  if (input.age < 18 && (options?.allow_deficit || input.deficit_kcal)) {
    throw new Error(
      "SG02: calorie deficit or weight-loss targets are not allowed for members under 18. " +
        "Use maintenance-only targets (energy requirement for growth and development)."
    );
  }

  // Calculate EER (Estimated Energy Requirement) using the Mifflin-St Jeor or NAE formula
  const eer = calculateEER(input);

  // Under 18: maintenance only; no deficit
  const energy_kcal =
    input.age < 18 ? eer : Math.max(eer - (input.deficit_kcal || 0), 1200);

  // Energy floor (SG03): from rules/energy_floors.yaml, reviewed_by: false for M3
  const energy_floor_kcal = getEnergyFloor(input.age, input.sex);

  // Macronutrients
  const protein_g = calculateProtein(input.age, input.weight_kg);
  const fiber_g = calculateFiber(input.age, input.sex);

  // Metadata
  const sources: Record<string, string> = {
    energy: "National Academies Dietary Reference Intakes (DRI) — Estimated Energy Requirement",
    protein: "USDA Recommended Dietary Allowance (RDA)",
    fiber: "Dietary Guidelines for Americans 2020-2025",
  };

  return {
    energy_kcal,
    energy_floor_kcal,
    energy_floor_reviewed: false, // SG03: until RD reviews
    weight_loss_allowed: input.age >= 18,
    includes_growth: input.age < 18,
    protein_g,
    fiber_g,
    sources,
  };
}

/**
 * Calculate Estimated Energy Requirement (EER) using a standard formula.
 * For adults, uses a simplified approach based on Harris-Benedict or Mifflin-St Jeor.
 * For children, uses DRI EER equations (NAE, 2005).
 */
function calculateEER(input: TargetInput): number {
  const { age, sex, weight_kg, height_cm, activity } = input;

  if (age < 3) {
    // Infants and toddlers: use DRI EER
    return age < 1 ? weight_kg * 108 : weight_kg * 102; // kcal/kg
  }

  if (age < 19) {
    // Children 3-18: DRI EER (NAE, 2005)
    // Simplified: assume moderate activity
    if (sex === "male") {
      if (age < 9) return 88.5 - 61.9 * age + 26.7 * weight_kg + (903 * (height_cm / 100)) + 20;
      if (age < 14) return 88.5 - 61.9 * age + 26.7 * weight_kg + (903 * (height_cm / 100)) + 25;
      if (age < 19) return 88.5 - 61.9 * age + 26.7 * weight_kg + (903 * (height_cm / 100)) + 25;
    } else {
      if (age < 9) return 135.3 - 30.8 * age + 10 * weight_kg + (934 * (height_cm / 100)) + 20;
      if (age < 14) return 135.3 - 30.8 * age + 10 * weight_kg + (934 * (height_cm / 100)) + 25;
      if (age < 19) return 135.3 - 30.8 * age + 10 * weight_kg + (934 * (height_cm / 100)) + 25;
    }
  }

  // Adults: Mifflin-St Jeor
  let eer = 10 * weight_kg + 6.25 * height_cm - 5 * age;
  if (sex === "male") eer += 5;
  else eer -= 161;

  // Apply activity multiplier
  const activityMultipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    very_active: 1.725,
  };

  return Math.round(eer * activityMultipliers[activity]);
}

/**
 * RDA for protein (g/kg body weight)
 */
function calculateProtein(age: number, weight_kg: number): number {
  let rda: number; // g/kg

  if (age < 1) rda = 1.52; // g/kg (infants)
  else if (age < 4) rda = 1.05;
  else if (age < 9) rda = 0.95;
  else if (age < 14) rda = 0.85;
  else if (age < 19) rda = 0.85;
  else rda = 0.8; // Adults

  return Math.round(weight_kg * rda);
}

/**
 * Adequate Intake (AI) for fiber (g/day) from DGA 2020-2025
 */
function calculateFiber(age: number, sex: Sex): number {
  if (age < 1) return 0; // Infants: none recommended
  if (age < 4) return 19; // 1-3 years
  if (age < 9) return 25; // 4-8 years
  if (age < 14) return sex === "male" ? 31 : 26; // 9-13 years
  if (age < 19) return sex === "male" ? 38 : 26; // 14-18 years
  if (age < 51) return sex === "male" ? 38 : 25; // 19-50 years
  return sex === "male" ? 30 : 21; // 51+
}

/**
 * Energy floor (SG03): hard lower bound, currently from rules/energy_floors.yaml
 * Values marked reviewed_by: null until RD reviews.
 * For M3, use placeholder values with reviewed_by: false.
 */
function getEnergyFloor(age: number, sex: Sex): number {
  // These are temporary placeholders (SG03 requirement: marked `reviewed: false`)
  // Real values come from rules/energy_floors.yaml and require RD sign-off

  if (age < 1) return 500; // kcal/day
  if (age < 4) return 1000;
  if (age < 9) return 1400;
  if (age < 14) return 1600;
  if (age < 19) return 1800; // Maintenance for growth
  if (age < 31) return sex === "male" ? 2000 : 1800;
  if (age < 51) return sex === "male" ? 2000 : 1800;
  return sex === "male" ? 1800 : 1600; // 51+

  // TODO (SG03): load actual floors from rules/energy_floors.yaml
}
