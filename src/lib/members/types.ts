export const SEXES = ["male", "female", "other", "unspecified"] as const;
export type Sex = (typeof SEXES)[number];

export const ACTIVITY_LEVELS = ["sedentary", "light", "moderate", "high", "athlete"] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export const DIET_PATTERNS = [
  "omnivore", "vegetarian", "vegan", "pescatarian", "halal", "kosher", "gluten_free", "dairy_free", "unspecified",
] as const;
export type DietPattern = (typeof DIET_PATTERNS)[number];

export class MemberError extends Error {
  constructor(readonly code: "not_found" | "invalid_attendance", message: string) {
    super(message);
    this.name = "MemberError";
  }
}

/** Profile fields only. Health is never in this shape (WP-1.3). */
export interface MemberProfile {
  id: string;
  householdId: string;
  name: string;
  birthYm: string;
  sex: Sex;
  activityLevel: ActivityLevel;
  dietPattern: DietPattern;
  isChild: boolean;
  likes: string[];
  dislikes: string[];
}
