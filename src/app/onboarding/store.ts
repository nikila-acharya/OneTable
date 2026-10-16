/**
 * WP-1.6 — ON01 onboarding draft store (PRD §5.0, §16.4).
 *
 * The flow is saved after every step so the User can stop and come back
 * (AC §5.0: "closing the browser at any step and returning resumes at that
 * step with the data saved"). The durable server-side home for this draft is
 * the WP-1.2 household/member tools; until that lands, this module persists
 * the draft in localStorage behind one narrow API (loadDraft / saveDraft /
 * clearDraft) so the UI can be repointed at the server without touching the
 * screens.
 *
 * Step numbering follows ON01 exactly (1–6). Step 5 (sources) is built in
 * WP-2.7 and is NOT reachable from this flow; the review screen shows the
 * starter-library fallback so onboarding can finish with zero sources
 * (AC §5.0).
 */

export const STORAGE_KEY = "onetable:onboarding:v1";
export const POLICY_VERSION = "2026-10-16";

export type OnboardStep = 1 | 2 | 3 | 4 | 6;

export const STEP_ORDER: OnboardStep[] = [1, 2, 3, 4, 6];

export const STEP_LABELS: Record<OnboardStep, string> = {
  1: "Welcome",
  2: "Your household",
  3: "Family members",
  4: "Meals to plan",
  6: "Review",
};

/* ------------------------------- consent (PV01) ------------------------------- */

export type ConsentType = "allergies" | "conditions" | "measurements";

export type ConsentGrant = {
  granted: boolean;
  /** ISO timestamp, recorded per household with the policy version (§PV01). */
  at: string;
  policyVersion: string;
};

export type ConsentState = Partial<Record<ConsentType, ConsentGrant>>;

/* ------------------------------- household (step 2) ------------------------------- */

export type HouseholdDraft = {
  name: string;
  timezone: string;
  /** Weekday breakfast limit in minutes. Default 10 (PRD §5.0 step 2). */
  weekdayBreakfastMinutes: number;
  /** Weeknight dinner limit in minutes. Default 30 (PRD §5.0 step 2). */
  weeknightDinnerMinutes: number;
  /** Cuisines the family loves. */
  cuisines: string[];
  /** Optional; the PRD marks budget feel as "optional, later". */
  budgetFeel: "" | "keep-it-cheap" | "balanced" | "no-stress";
};

/* ------------------------------- members (step 3) ------------------------------- */

export type Sex = "female" | "male" | "prefer-not";
export type Activity = "sedentary" | "low-active" | "active" | "very-active";
export type DietaryPattern =
  | "omnivore"
  | "vegetarian"
  | "vegan"
  | "pescatarian"
  | "halal"
  | "kosher"
  | "other";

/** The 9 major US allergens (PRD §5.2 PR02). */
export const MAJOR_ALLERGENS = [
  "milk",
  "egg",
  "fish",
  "crustacean shellfish",
  "tree nuts",
  "peanuts",
  "wheat",
  "soy",
  "sesame",
] as const;

/** Fixed condition list (PRD §5.2 PR03). No free-text conditions. */
export const CONDITIONS = [
  "type 1 diabetes",
  "type 2 diabetes",
  "prediabetes",
  "hypertension",
  "chronic kidney disease",
  "heart failure",
  "high cholesterol",
  "celiac disease",
  "pregnancy",
  "breastfeeding",
  "eating-disorder history",
  "takes medication with food interactions",
  "other",
] as const;

/**
 * Conditions that switch the member to general-guidance mode (SG01):
 * diabetes (any type), CKD, heart failure, pregnancy, eating-disorder
 * history, food-drug interactions.
 */
export const GENERAL_GUIDANCE_CONDITIONS: ReadonlySet<string> = new Set([
  "type 1 diabetes",
  "type 2 diabetes",
  "chronic kidney disease",
  "heart failure",
  "pregnancy",
  "eating-disorder history",
  "takes medication with food interactions",
]);

export const CUISINES = [
  "Italian",
  "Mexican",
  "American",
  "Chinese",
  "Indian",
  "Thai",
  "Japanese",
  "Greek / Mediterranean",
  "Middle Eastern",
  "Latin American",
  "Korean",
  "French",
] as const;

export type MemberDraft = {
  id: string;
  name: string;
  birthYear: number | null;
  birthMonth: number | null; // 1-12
  sex: Sex | null;
  activity: Activity | null;
  dietaryPattern: DietaryPattern | null;
  allergies: string[]; // major allergens + free "other" tags
  conditions: (typeof CONDITIONS)[number][];
  likes: string[];
  dislikes: string[];
  heightCm: string; // measurement consent-gated
  weightKg: string; // measurement consent-gated
  /** Which meals they're home for (step 3) — seeds step 4. */
  homeFor: {
    breakfast: boolean;
    lunch: boolean;
    snack: boolean;
    dinner: boolean;
  };
  packedLunch: "" | "school" | "work";
};

/* ------------------------------- meals (step 4) ------------------------------- */

export type MemberMeals = {
  memberId: string;
  breakfast: boolean;
  lunch: boolean;
  snack: boolean;
  secondSnack: boolean;
  dinner: boolean;
  packedLunch: "" | "school" | "work";
};

/* ------------------------------- draft ------------------------------- */

export type OnboardingDraft = {
  version: 1;
  /** The step to resume at when the browser is closed and reopened. */
  step: OnboardStep;
  completed: OnboardStep[];
  household: HouseholdDraft;
  members: MemberDraft[];
  meals: MemberMeals[];
  consent: ConsentState;
  /** Set when the User taps "Plan our first week" (stub — plan lands in M3). */
  firstPlanRequestedAt: string | null;
  /** Set when the User taps "Finish setup" on the approval card (done screen). */
  finishedAt: string | null;
};

export function newDraft(): OnboardingDraft {
  return {
    version: 1,
    step: 1,
    completed: [],
    household: {
      name: "",
      timezone: defaultTimezone(),
      weekdayBreakfastMinutes: 10,
      weeknightDinnerMinutes: 30,
      cuisines: [],
      budgetFeel: "",
    },
    members: [],
    meals: [],
    consent: {},
    firstPlanRequestedAt: null,
    finishedAt: null,
  };
}

export function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function newMemberId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newMember(): MemberDraft {
  return {
    id: newMemberId(),
    name: "",
    birthYear: null,
    birthMonth: null,
    sex: null,
    activity: null,
    dietaryPattern: null,
    allergies: [],
    conditions: [],
    likes: [],
    dislikes: [],
    heightCm: "",
    weightKg: "",
    homeFor: { breakfast: true, lunch: true, snack: true, dinner: true },
    packedLunch: "",
  };
}

/* ------------------------------- derived ------------------------------- */

/**
 * Age in whole years, derived from birth month + year (PRD §5.2 PR01:
 * "Age is derived"). Returns null when either part is missing.
 */
export function ageYears(m: Pick<MemberDraft, "birthYear" | "birthMonth">, now = new Date()): number | null {
  if (!m.birthYear || !m.birthMonth) return null;
  let age = now.getFullYear() - m.birthYear;
  if (now.getMonth() + 1 < m.birthMonth) age -= 1;
  return age;
}

export function isUnder18(m: Pick<MemberDraft, "birthYear" | "birthMonth">, now = new Date()): boolean {
  const age = ageYears(m, now);
  return age !== null && age < 18;
}

/** Required fields first (PRD §5.2: "adding a member with only the required fields takes one screen"). */
export function memberRequiredComplete(m: MemberDraft, now = new Date()): boolean {
  return (
    m.name.trim().length > 0 &&
    m.name.trim().length <= 40 &&
    m.birthYear !== null &&
    m.birthMonth !== null &&
    m.sex !== null &&
    m.activity !== null &&
    ageYears(m, now) !== null &&
    ageYears(m, now)! >= 0
  );
}

export function memberNeedsGeneralGuidance(m: MemberDraft): boolean {
  return m.conditions.some((c) => GENERAL_GUIDANCE_CONDITIONS.has(c));
}

/** All stored allergies across members, in member order (review chips must match these exactly). */
export function allStoredAllergies(draft: OnboardingDraft): { memberId: string; memberName: string; allergen: string }[] {
  const out: { memberId: string; memberName: string; allergen: string }[] = [];
  for (const m of draft.members) {
    for (const a of m.allergies) out.push({ memberId: m.id, memberName: m.name || "Member", allergen: a });
  }
  return out;
}

export function householdComplete(h: HouseholdDraft): boolean {
  return h.name.trim().length > 0 && h.timezone.length > 0;
}

export function anyMealPlanned(meals: MemberMeals[]): boolean {
  return meals.some(
    (x) => x.breakfast || x.lunch || x.snack || x.secondSnack || x.dinner,
  );
}

/** The step is completable only when its required data is valid (saved after every step). */
export function stepCanAdvance(draft: OnboardingDraft, step: OnboardStep): boolean {
  switch (step) {
    case 1:
      return true; // welcome is read-and-continue
    case 2:
      return householdComplete(draft.household);
    case 3:
      // at least one member with the required fields
      return draft.members.some((m) => memberRequiredComplete(m));
    case 4:
      return anyMealPlanned(draft.meals);
    case 6:
      return true; // review is the terminal stub step
  }
}

export function nextStep(step: OnboardStep): OnboardStep | null {
  const i = STEP_ORDER.indexOf(step);
  return i >= 0 && i < STEP_ORDER.length - 1 ? STEP_ORDER[i + 1] : null;
}

export function prevStep(step: OnboardStep): OnboardStep | null {
  const i = STEP_ORDER.indexOf(step);
  return i > 0 ? STEP_ORDER[i - 1] : null;
}

/**
 * Keep one meal row per member (rows for removed members are dropped).
 * New members are seeded from step 3's attendance ("Per member, from step
 * 3's attendance", §5.0 step 4); once a row exists the User's own toggles
 * win, because attendance is only the initial default.
 */
export function syncMeals(members: MemberDraft[], existing: MemberMeals[]): MemberMeals[] {
  return members.map(
    (m) =>
      existing.find((x) => x.memberId === m.id) ?? {
        memberId: m.id,
        breakfast: m.homeFor.breakfast,
        lunch: m.homeFor.lunch,
        snack: m.homeFor.snack,
        secondSnack: false,
        dinner: m.homeFor.dinner,
        packedLunch: m.packedLunch,
      },
  );
}

/* ------------------------------- persistence ------------------------------- */

export function loadDraft(): OnboardingDraft {
  if (typeof window === "undefined") return newDraft();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return newDraft();
    return parseDraft(raw);
  } catch {
    return newDraft();
  }
}

function parseDraft(raw: string): OnboardingDraft {
  const parsed = JSON.parse(raw) as OnboardingDraft;
  if (parsed?.version !== 1) return newDraft();
  return { ...newDraft(), ...parsed, household: { ...newDraft().household, ...parsed.household } };
}

/* ---- store subscription for React (useSyncExternalStore) ---- */

const draftListeners = new Set<() => void>();
let cacheRaw: string | null | undefined;
let cacheDraft: OnboardingDraft | null = null;

function notifyDraftListeners() {
  for (const l of Array.from(draftListeners)) l();
}

export function subscribeDraft(onChange: () => void): () => void {
  draftListeners.add(onChange);
  if (typeof window !== "undefined") window.addEventListener("storage", onChange);
  return () => {
    draftListeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onChange);
  };
}

/** Stable identity per stored value: required by useSyncExternalStore. */
export function getDraftSnapshot(): OnboardingDraft {
  if (typeof window === "undefined") return newDraft();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw !== cacheRaw || !cacheDraft) {
    cacheRaw = raw;
    try {
      cacheDraft = raw ? parseDraft(raw) : newDraft();
    } catch {
      cacheDraft = newDraft();
    }
  }
  return cacheDraft;
}

/** Saved after every step so the User can stop and come back (§5.0). */
export function saveDraft(draft: OnboardingDraft): void {
  if (typeof window === "undefined") return;
  try {
    const json = JSON.stringify(draft);
    window.localStorage.setItem(STORAGE_KEY, json);
    cacheRaw = json;
    cacheDraft = draft;
    notifyDraftListeners();
  } catch {
    /* storage full or blocked — the flow still works in-session */
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    cacheRaw = undefined;
    cacheDraft = null;
    notifyDraftListeners();
  } catch {
    /* ignore */
  }
}

/* ------------------------------- consent helpers (PV01) ------------------------------- */

/**
 * A data type with no consent cannot be stored (PV01). When consent is
 * withheld or withdrawn, the fields for that type are disabled and the
 * stored data for it is cleared. Real consent persistence is WP-1.1; this
 * models the same rules locally.
 */
export function consentAllows(c: ConsentState, type: ConsentType): boolean {
  return c[type]?.granted === true;
}

export function grantConsent(c: ConsentState, type: ConsentType, at: string): ConsentState {
  return { ...c, [type]: { granted: true, at, policyVersion: POLICY_VERSION } };
}

export function withdrawConsent(c: ConsentState, type: ConsentType, at: string): ConsentState {
  return { ...c, [type]: { granted: false, at, policyVersion: POLICY_VERSION } };
}

/** Strip health/measurement data a member holds for a type that is not consented. */
export function scrubWithoutConsent(m: MemberDraft, consent: ConsentState): MemberDraft {
  const out = { ...m };
  if (!consentAllows(consent, "allergies")) out.allergies = [];
  if (!consentAllows(consent, "conditions")) out.conditions = [];
  if (!consentAllows(consent, "measurements")) {
    out.heightCm = "";
    out.weightKg = "";
  }
  return out;
}

export function scrubDraft(draft: OnboardingDraft): OnboardingDraft {
  return { ...draft, members: draft.members.map((m) => scrubWithoutConsent(m, draft.consent)) };
}
