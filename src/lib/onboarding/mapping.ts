/**
 * WP-1.6: the onboarding UI's vocabulary -> backend enums. Pure. The UI keeps its
 * own words (what users see); the backend keeps the PRD/DB words. Decisions are
 * recorded in ADR-008.
 */
import type { Activity, Sex, DietaryPattern, ConsentType } from "../../../src/app/onboarding/store";
import type { ActivityLevel, DietPattern, Sex as BackendSex } from "../members/types";
import type { ConsentDataType } from "../consent/types";

export function mapSex(ui: Sex | null): BackendSex {
  if (ui === "female" || ui === "male") return ui;
  return "unspecified"; // "prefer-not" and unset
}

export function mapActivity(ui: Activity | null): ActivityLevel {
  switch (ui) {
    case "sedentary": return "sedentary";
    case "low-active": return "light";
    case "active": return "moderate";
    case "very-active": return "high";
    default: return "moderate"; // the backend default for an unanswered question
  }
}

export function mapDiet(ui: DietaryPattern | null): DietPattern {
  if (ui === null || ui === "other") return "unspecified";
  return ui;
}

export function mapConsentType(ui: ConsentType): ConsentDataType {
  switch (ui) {
    case "allergies": return "allergies";
    case "conditions": return "health_conditions";
    case "measurements": return "body_measurements";
  }
}
