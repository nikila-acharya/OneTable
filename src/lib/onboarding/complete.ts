/**
 * WP-1.6: writes a finished onboarding draft to the backend.
 * Order: validate everything -> tier pre-check -> household -> consent ->
 * members (+ encrypted health, only with consent) -> attendance.
 * Validation runs before any write, so a rejected draft writes nothing.
 * Steps 2-4 run in ONE transaction (ADR-008 as amended): a failure anywhere
 * leaves nothing behind. The previous version of this comment claimed the
 * writes were "not one transaction", which had already been overtaken by the
 * ADR's amendment — believing it produced a wrong bug report, so it is
 * corrected here rather than left to mislead again.
 * Member writes are idempotent: re-running completion updates the profiles it
 * already created instead of inserting a second copy (see step 4).
 */
import { eq } from "drizzle-orm";
import { household, member } from "../../../db/schema";
import type { Db } from "../db";
import type { OnboardingDraft, MemberDraft, MemberMeals } from "../../app/onboarding/store";
import { CONSENT_TYPES } from "../../app/onboarding/store";
import { ALLERGENS, CONDITIONS } from "../health/enums";
import { validateProfile } from "../members/validation";
import { createMember, setAttendance, updateMember, type AttendanceEntry } from "../members/service";
import { validateHealthPatch, type HealthPatch } from "../health/validation";
import { writeHealth } from "../health/service";
import { grantConsent } from "../consent/service";
import { mapActivity, mapConsentType, mapDiet, mapSex } from "./mapping";
import { MEMBER_LIMIT, type Tier } from "../tier/limits";
import { validateSettings, saveHouseholdSettings, type SettingsInput } from "../household/settings";

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
  if (draft.members.length > limit)
    // Reported the CAP instead of the COUNT: a 4-member draft against a
    // 1-member cap read "this plan includes 1 members", hiding the one number
    // that explained the rejection. Also states the limit without pointing at
    // an upgrade, since no tier now grants more than `limit`.
    issues.push(
      `this plan includes ${draft.members.length} members, but a household can have at most ${limit}`,
    );

  const settingsInput: SettingsInput = {
    weekdayBreakfastMinutes: draft.household.weekdayBreakfastMinutes,
    weeknightDinnerMinutes: draft.household.weeknightDinnerMinutes,
    cuisines: draft.household.cuisines,
    budgetFeel: draft.household.budgetFeel,
  };
  const settingsCheck = validateSettings(settingsInput);
  if (!settingsCheck.ok) issues.push(...settingsCheck.issues);

  // Consent keys are UI vocabulary arriving off the wire as `unknown`. An
  // unrecognised one used to reach mapConsentType(), which had no default
  // branch, so it returned undefined; drizzle faithfully wrote DEFAULT for an
  // undefined field and Postgres rejected the not-null column - an opaque 500
  // for what is really a bad request. Report it here, in the same pass as every
  // other input, so nothing is written.
  for (const key of Object.keys(draft.consent ?? {})) {
    if (!(CONSENT_TYPES as readonly string[]).includes(key))
      issues.push(
        `consent "${key}" is not a recognised data type (use ${CONSENT_TYPES.join(", ")})`,
      );
  }

  const grantedEntries = (Object.entries(draft.consent) as [ConsentTypeUi, { granted: boolean }][]).filter(
    ([k, g]) => g.granted && (CONSENT_TYPES as readonly string[]).includes(k),
  );
  const consentGranted = new Set<string>(grantedEntries.map(([k]) => k));

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

  // 2-4. Every write runs in one transaction: a failure anywhere leaves nothing behind (ADR-008).
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // Household details that the backend stores (name, timezone).
    await t.update(household).set({ name: draft.household.name.trim() || undefined, timezone: draft.household.timezone }).where(eq(household.id, householdId));

    // 2b. Household cooking preferences (validated above).
    await saveHouseholdSettings(t, householdId, settingsInput);

    // 3. Consent first, so the health writes below are allowed.
    let consents = 0;
    for (const ui of consentGranted) {
      await grantConsent(t, householdId, mapConsentType(ui as ConsentTypeUi));
      consents++;
    }

    // 4. Members, then their health and meal attendance.
    //
    // Completion is IDEMPOTENT. Running it twice must leave the same member
    // rows, not a second copy of everyone: the code below used to insert
    // unconditionally, so a household that re-completed silently doubled every
    // profile and then planned meals for twice as many people as it has.
    //
    // Matching is on (name, birthYm) with multiset semantics, because member.id
    // is server-generated and the draft's client id is never stored, so no
    // stronger key exists. Genuine twins sharing a name and month still work:
    // each existing row can be claimed only once, so the second twin gets its
    // own row rather than collapsing onto the first.
    //
    // Deliberately NOT delete-and-reinsert: every foreign key to member is ON
    // DELETE CASCADE, including plan rows (db/schema.ts), so rebuilding the set
    // would quietly destroy a returning household's plans, health records and
    // check-ins. Removal therefore stays an explicit Household-tab action
    // (WP-1.2), and a member dropped from the draft is left untouched.
    const idMap = new Map<string, string>();
    const existingRows = await t
      .select({ id: member.id, name: member.name, birthYm: member.birthYm })
      .from(member)
      .where(eq(member.householdId, householdId));
    const claimed = new Set<string>();
    for (const { m, profile, health } of plans) {
      if (!profile.ok) continue;
      const p = profile.value as Parameters<typeof createMember>[2];
      const match = existingRows.find(
        (row) => !claimed.has(row.id) && row.name === p.name && row.birthYm === p.birthYm,
      );
      let memberId: string;
      if (match) {
        claimed.add(match.id);
        await updateMember(t, householdId, match.id, p, now);
        memberId = match.id;
      } else {
        memberId = await createMember(t, householdId, p, now);
      }
      idMap.set(m.id, memberId);
      if (health) await writeHealth(t, householdId, memberId, health);
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
      await setAttendance(t, householdId, memberId, entries);
    }
    return { members: idMap.size, consents };
  });
}

type ConsentTypeUi = "allergies" | "conditions" | "measurements";
