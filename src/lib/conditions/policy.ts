/**
 * SG01 policy per PR03 condition. ADR-114 D2 (fail-safe): every listed condition
 * except "other" enters general-guidance mode, because a missed banner is worse
 * than an extra one. The disputed rows are marked `rdReview`; the owner or RD can
 * narrow them in one line each (Gate B).
 */
import type { Condition } from "../health/enums";

export interface ConditionPolicy {
  generalGuidance: boolean;
  glutenHardFilter: boolean;
  /** Display-only DGA awareness areas; never numeric targets. */
  dgaAwareness: readonly string[];
  rdReview: boolean;
}

const gg = (dga: string[] = [], rdReview = false): ConditionPolicy => ({
  generalGuidance: true,
  glutenHardFilter: false,
  dgaAwareness: dga,
  rdReview,
});

export const CONDITION_POLICIES: Record<Condition, ConditionPolicy> = {
  "type 1 diabetes": gg(["carbohydrate-awareness"]),
  "type 2 diabetes": gg(["carbohydrate-awareness"]),
  prediabetes: gg(["carbohydrate-awareness"], true),
  hypertension: gg(["sodium-awareness"], true),
  "chronic kidney disease": gg(["sodium-awareness"]),
  "heart failure": gg(["sodium-awareness"]),
  "high cholesterol": gg(["saturated-fat-awareness"], true),
  "celiac disease": { generalGuidance: true, glutenHardFilter: true, dgaAwareness: [], rdReview: false },
  pregnancy: gg(["folate-and-iron-awareness"]),
  breastfeeding: gg(["general-dga"], true),
  "eating-disorder history": gg(["no-restriction-language"]),
  "takes medication with food interactions": gg(["medication-food-timing"]),
  // "other" is recognised but deliberately not acted on (PR03).
  other: { generalGuidance: false, glutenHardFilter: false, dgaAwareness: [], rdReview: false },
};
