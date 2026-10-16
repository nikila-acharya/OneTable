// WP-1.2 — member profile domain types (PR01, PV02).
// Enums mirror PRD Section 5.2 / 10.3. Health-bearing fields (allergies, conditions,
// height, weight) are typed here for the input shape only; their storage belongs to the
// WP-1.3 encrypted `member_health` table via the HealthWriter seam (see health.ts).

export const SEXES = ['female', 'male', 'prefer_not_to_say'] as const;
export type Sex = (typeof SEXES)[number];

export const ACTIVITY_LEVELS = ['sedentary', 'low_active', 'active', 'very_active'] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export const DIET_PATTERNS = [
  'omnivore',
  'vegetarian',
  'vegan',
  'pescatarian',
  'halal',
  'kosher',
  'other',
] as const;
export type DietPattern = (typeof DIET_PATTERNS)[number];

export const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

/** ISO weekday: 1 = Monday … 7 = Sunday (PRD 5.4 week runs Mon–Sun). */
export const WEEKDAY_MIN = 1;
export const WEEKDAY_MAX = 7;

export const NAME_MAX_LEN = 40; // PR01: free text, max 40 chars
export const PREF_TAG_MAX_LEN = 40;
export const PREF_MAX_COUNT = 50;

export interface MemberRecord {
  id: string;
  householdId: string;
  name: string;
  /** Birth month as "YYYY-MM". Age is derived, never stored (PR01). */
  birthYm: string;
  sex: Sex;
  activityLevel: ActivityLevel;
  dietPattern: DietPattern | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  // PV02 AC: this record — and the `member` table — has NO auth fields.
  // Members never hold email, phone, password or provider data; only `user` authenticates.
}

export interface MemberPrefs {
  likes: string[];
  dislikes: string[];
}

export interface AttendanceEntry {
  mealType: MealType;
  weekday: number;
  attending: boolean;
  /** "packed" flag for school/work lunches only (MP01). */
  packed: boolean;
}

/** Health-bearing fields — routed to the WP-1.3 encrypted store, consent-gated (PV01). */
export interface HealthPatch {
  heightCm?: number | null;
  weightKg?: number | null;
  allergies?: string[] | null;
  otherAllergens?: string[] | null;
  conditions?: string[] | null;
}

/** Agent/API-facing input for create_or_update_member. Unknown or auth-like keys are rejected. */
export interface MemberInput {
  /** Absent = create. Present = update; must belong to the caller's household. */
  id?: string;
  name?: unknown;
  birthYm?: unknown;
  sex?: unknown;
  activityLevel?: unknown;
  dietPattern?: unknown;
  heightCm?: unknown;
  weightKg?: unknown;
  allergies?: unknown;
  otherAllergens?: unknown;
  conditions?: unknown;
  likes?: unknown;
  dislikes?: unknown;
  [key: string]: unknown;
}

export interface SetAttendanceInput {
  memberId: string;
  entries: Array<{
    mealType?: unknown;
    weekday?: unknown;
    attending?: unknown;
    packed?: unknown;
  }>;
}
