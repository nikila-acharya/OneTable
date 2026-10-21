/**
 * Health field validation (PR02, PR03, PV02, SG01 input rules). Pure.
 * Under-13s: weight is refused outright (PRD PV02 collects only age, allergies,
 * likes/dislikes and optional height for children). Consent does not unlock it.
 */
import { ALLERGENS, CONDITIONS, type Allergen, type Condition } from "./enums";
import type { MemberHealthData } from "../../../db/schema";

export const HEALTH_KEYS = ["heightCm", "weightKg", "conditions", "allergies", "otherAllergens"] as const;
export type HealthKey = (typeof HEALTH_KEYS)[number];
const OTHER_MAX_COUNT = 20;
const OTHER_MAX_LEN = 40;

export interface HealthIssue {
  field: string;
  code: "invalid" | "not_allowed" | "child_collection_limit";
  message: string;
}

export type HealthPatch = Partial<Pick<MemberHealthData, HealthKey>>;

export type HealthValidation =
  | { ok: true; value: HealthPatch }
  | { ok: false; issues: HealthIssue[] };

export function validateHealthPatch(input: Record<string, unknown>, ageYears: number): HealthValidation {
  const issues: HealthIssue[] = [];
  const out: HealthPatch = {};

  for (const key of Object.keys(input)) {
    if (!(HEALTH_KEYS as readonly string[]).includes(key)) {
      issues.push({ field: key, code: "not_allowed", message: `${key} is not a health field` });
    }
  }

  if (input.weightKg !== undefined && input.weightKg !== null && ageYears < 13) {
    issues.push({
      field: "weightKg",
      code: "child_collection_limit",
      message: "weight is not collected for children under 13 (PV02)",
    });
  }

  if (input.heightCm !== undefined) {
    if (input.heightCm === null) out.heightCm = null;
    else if (typeof input.heightCm === "number" && input.heightCm >= 50 && input.heightCm <= 250) out.heightCm = input.heightCm;
    else issues.push({ field: "heightCm", code: "invalid", message: "height must be 50-250 cm" });
  }

  if (input.weightKg !== undefined && !issues.some((i) => i.field === "weightKg")) {
    if (input.weightKg === null) out.weightKg = null;
    else if (typeof input.weightKg === "number" && input.weightKg >= 2 && input.weightKg <= 400) out.weightKg = input.weightKg;
    else issues.push({ field: "weightKg", code: "invalid", message: "weight must be 2-400 kg" });
  }

  if (input.conditions !== undefined) {
    if (!Array.isArray(input.conditions) || input.conditions.some((c) => !(CONDITIONS as readonly string[]).includes(c as string))) {
      issues.push({ field: "conditions", code: "invalid", message: "conditions must come from the fixed list (PR03)" });
    } else out.conditions = [...new Set(input.conditions as Condition[])].sort();
  }

  if (input.allergies !== undefined) {
    if (!Array.isArray(input.allergies) || input.allergies.some((a) => !(ALLERGENS as readonly string[]).includes(a as string))) {
      issues.push({ field: "allergies", code: "invalid", message: "allergies must come from the major-allergen list (PR02)" });
    } else out.allergies = [...new Set(input.allergies as Allergen[])].sort();
  }

  if (input.otherAllergens !== undefined) {
    const raw = input.otherAllergens;
    if (!Array.isArray(raw) || raw.length > OTHER_MAX_COUNT || raw.some((x) => typeof x !== "string" || x.trim().length === 0 || x.trim().length > OTHER_MAX_LEN)) {
      issues.push({ field: "otherAllergens", code: "invalid", message: `other allergens: up to ${OTHER_MAX_COUNT} items, 1-${OTHER_MAX_LEN} characters each` });
    } else out.otherAllergens = [...new Set((raw as string[]).map((x) => x.trim().toLowerCase()))].sort();
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: out };
}
