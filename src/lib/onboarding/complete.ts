/**
 * WP-1.6: writes a finished onboarding draft to the backend.
 * Order: validate everything -> tier pre-check -> household -> consent ->
 * members (+ encrypted health, only with consent) -> attendance.
 * Validation runs before any write, so a rejected draft writes nothing.
 * The sequential writes are not one transaction; see ADR-008.
 */
import { eq } from "drizzle-orm";
import { household } from "../../../db/schema";
import type { Db } from "../db";
import type { OnboardingDraft, MemberDraft, MemberMeals } from "../../app/onboarding/store";
import { ALLERGENS, CONDITIONS } from "../health/enums";
import { validateProfile } from "../members/validation";
import { createMember, setAttendance, type AttendanceEntry } from "../members/service";
import { validateHealthPatch, type HealthPatch } from "../health/validation";
import { writeHealth } from "../health/service";
import { grantConsent } from "../consent/service";
import { mapActivity, mapConsentType, mapDiet, mapSex } from "./mapping";
import { MEMBER_LIMIT, type Tier } from "../tier/limits";

export class OnboardingRejectedError extends Error {
  readonly code = "onboarding_rejected" as const;
  constructor(readonly issues: string[]) {
    super(`onboarding not saved: ${issues.join("; ")}`);
    this.name = "OnboardingRejectedError";
  }
}

const MEAL_TYPES = ["breakfast", "lunch", "snack", "dinner"] as const;

function ageYears(m: MemberDraft, now: Date): number | null {
  if (m.birthYear === null || m.birthMonth === null) return null;
  let age = now.getUTCFullYear() - m.birthYear;
  if (now.getUTCMonth() + 1 < m.birthMonth) age -= 1;
  return age;
}

export async function completeOnboarding(
  db: Db,
  householdId: string,
  draft: OnboardingDraft,
  now: Date,
): Promise<{ members: number; consents: number }> {
  // 1. Validate everything first; nothing is written if any check fails.
  const issues: string[] = [];
  const [hh] = await db.select({ tier: household.tier }).from(household).where(eq(household.id, householdId));
  if (!hh) throw new OnboardingRejectedError(["household not found"]);
  const limit = MEMBER_LIMIT[hh.tier as Tier];
  if (draft.members.length > limit) issues.push(`this plan includes ${limit} members`);

  const consentGranted = new Set(
    (Object.entries(draft.consent) as [ConsentTypeUi, { granted: boolean }][])
      .filter(([, g]) => g.granted)
      .map(([k]) => k),
  );

  const plans = draft.members.map((m) => {
    const profile = validateProfile(
      {
        name: m.name,
        birthYm: m.birthYear && m.birthMonth ? `${m.birthYear}-${String(m.birthMonth).padStart(2, "0")}` : undefined,
        sex: mapSex(m.sex),
        activityLevel: mapActivity(m.activity),
        dietPattern: mapDiet(m.dietaryPattern),
        likes: m.likes,
        dislikes: m.dislikes,
      },
      "create",
      now,
    );
    if (!profile.ok) {
      for (const i of profile.issues) issues.push(`${m.name || "member"}: ${i.field} ${i.message ?? "invalid"}`);
    }

    // Health is written only for the categories the household consented to (PV01).
    const age = ageYears(m, now);
    const raw: Record<string, unknown> = {};
    if (consentGranted.has("allergies")) {
      raw.allergies = m.allergies.filter((a) => (ALLERGENS as readonly string[]).includes(a));
      raw.otherAllergens = m.allergies.filter((a) => !(ALLERGENS as readonly string[]).includes(a));
    }
    if (consentGranted.has("conditions")) raw.conditions = m.conditions.filter((c) => (CONDITIONS as readonly string[]).includes(c));
    if (consentGranted.has("measurements")) {
      if (m.heightCm.trim() !== "") raw.heightCm = Number(m.heightCm);
      if (m.weightKg.trim() !== "") raw.weightKg = Number(m.weightKg);
    }
    let health: HealthPatch | null = null;
    if (Object.keys(raw).length > 0 && age !== null) {
      const v = validateHealthPatch(raw, age);
      if (!v.ok) for (const i of v.issues) issues.push(`${m.name || "member"}: ${i.field} ${i.message ?? "invalid"}`);
      else health = v.value;
    }
    return { m, profile, health };
  });

  if (issues.length > 0) throw new OnboardingRejectedError(issues);

  // 2. Household details that the backend stores (name, timezone).
  await db.update(household).set({ name: draft.household.name.trim() || undefined, timezone: draft.household.timezone }).where(eq(household.id, householdId));

  // 3. Consent first, so the health writes below are allowed.
  let consents = 0;
  for (const ui of consentGranted) {
    await grantConsent(db, householdId, mapConsentType(ui as ConsentTypeUi));
    consents++;
  }

  // 4. Members, then their health and meal attendance.
  const idMap = new Map<string, string>();
  for (const { m, profile, health } of plans) {
    if (!profile.ok) continue;
    const memberId = await createMember(db, householdId, profile.value as Parameters<typeof createMember>[2], now);
    idMap.set(m.id, memberId);
    if (health) await writeHealth(db, householdId, memberId, health);
  }
  for (const meals of draft.meals as MemberMeals[]) {
    const memberId = idMap.get(meals.memberId);
    if (!memberId) continue;
    const entries: AttendanceEntry[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      for (const mealType of MEAL_TYPES) {
        const attending = mealType === "snack" ? meals.snack : meals[mealType];
        const packed = mealType === "lunch" && meals.packedLunch !== "";
        entries.push({ mealType, weekday, attending: Boolean(attending), packed });
      }
    }
    await setAttendance(db, householdId, memberId, entries);
  }
  return { members: idMap.size, consents };
}

type ConsentTypeUi = "allergies" | "conditions" | "measurements";
