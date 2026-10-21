/**
 * PR02 allergens (the 9 US major allergens; free "other" tags are separate) and
 * PR03 conditions (a fixed list, no free text). The lists are identical to the
 * onboarding UI's (src/app/onboarding/store.ts); tests/health/enums.test.ts
 * fails if they drift.
 */
export const ALLERGENS = [
  "milk", "egg", "fish", "crustacean shellfish", "tree nuts", "peanuts", "wheat", "soy", "sesame",
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const CONDITIONS = [
  "type 1 diabetes", "type 2 diabetes", "prediabetes", "hypertension", "chronic kidney disease",
  "heart failure", "high cholesterol", "celiac disease", "pregnancy", "breastfeeding",
  "eating-disorder history", "takes medication with food interactions", "other",
] as const;
export type Condition = (typeof CONDITIONS)[number];

/** SG01: these switch the member to general-guidance mode (rules gate, no AI advice). */
export const GENERAL_GUIDANCE_CONDITIONS: ReadonlySet<Condition> = new Set<Condition>([
  "type 1 diabetes",
  "type 2 diabetes",
  "chronic kidney disease",
  "heart failure",
  "pregnancy",
  "eating-disorder history",
  "takes medication with food interactions",
]);

/** SG01: celiac is treated as a hard gluten filter, like an allergen. */
export const GLUTEN_HARD_FILTER_CONDITION: Condition = "celiac disease";
