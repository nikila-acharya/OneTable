/**
 * Generate and persist the household's plan for the current week.
 *
 * This is the seam that never existed: the M3 planner and the M5 `recipe`/`plan`
 * tables were both finished, but nothing ever read real recipes into the
 * planner or wrote a plan back out, so `plan` stayed empty in production and the
 * wizard's last button only stored a client-side flag.
 *
 * Properties this implementation is responsible for:
 * - Household comes from the session (caller passes the id it already
 *   resolved); nothing here reads a household id from a request body.
 * - Health data is read through `readHealth()`, the canonical decrypting reader
 *   that re-checks ownership, so no cross-household blob is ever opened.
 * - Idempotent per (household, week): a second press returns the existing plan
 *   instead of creating a second one. The lesson from onboarding completion
 *   (#53) was that "run it again" is the normal user behaviour, and the schema
 *   has no unique index here to save us, so the check is explicit.
 * - Persistence is one transaction: a failure leaves no half-written week.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { member, plan, planSlot, slotMember } from "../../../db/schema";

type MemberRow = typeof member.$inferSelect;
import { readHealth } from "../health/service";
import { MealPlannerAgent, type MemberProfile } from "../../agent/meal-planner";
import type { Db } from "../db";
import { loadRecipePool, type ExcludeReason } from "./pool";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DB enum -> M4 profile enum. They were written independently and never met. */
const ACTIVITY_MAP: Record<string, MemberProfile["activity"]> = {
  sedentary: "sedentary",
  light: "light",
  moderate: "moderate",
  high: "active",
  athlete: "very_active",
};

export type PlanErrorCode =
  | "no_household"
  | "no_members"
  | "no_recipes"
  | "pool_blocked"
  | "planner_refused"
  | "non_persistable_recipe";

export class PlanError extends Error {
  readonly code: PlanErrorCode;
  readonly detail?: Record<string, unknown>;
  constructor(code: PlanErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "PlanError";
    this.code = code;
    this.detail = detail;
  }
}

export interface FirstPlanResult {
  created: boolean;
  planId: string;
  weekStart: string;
  seed: number;
  slots: number;
  status: string;
  meals: Array<{ date: string; mealType: string; recipeId: string; recipeName: string }>;
}

/** Monday of the week containing `now`, in the household's own timezone-free UTC terms. */
export function weekStartFor(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const shift = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

function ageFromBirthYm(birthYm: string, now: Date): number {
  const [ys, ms] = birthYm.split("-");
  const years = now.getUTCFullYear() - Number(ys);
  const beforeBirthday = now.getUTCMonth() + 1 < Number(ms);
  return Math.max(0, years - (beforeBirthday ? 1 : 0));
}

/** Stable per-household-per-week seed, so a retry reproduces the same plan. */
function deriveSeed(householdId: string, weekStart: string): number {
  const digest = createHash("sha256").update(`${householdId}|${weekStart}`).digest();
  return digest.readUInt32BE(0) % 2147483647;
}

export async function generateWeekPlan(
  db: Db,
  householdId: string,
  now: Date = new Date(),
): Promise<FirstPlanResult> {
  const weekStart = weekStartFor(now);
  const seed = deriveSeed(householdId, weekStart);

  const existing = await db
    .select()
    .from(plan)
    .where(and(eq(plan.householdId, householdId), eq(plan.weekStart, weekStart)));
  if (existing.length) {
    const p = existing[0]!;
    const slots = await db.select().from(planSlot).where(eq(planSlot.planId, p.id));
    return {
      created: false,
      planId: p.id,
      weekStart,
      seed: p.seed,
      slots: slots.length,
      status: p.status,
      meals: slots.map((s) => ({
        date: s.date,
        mealType: s.mealType,
        recipeId: s.sharedRecipeId ?? "",
        recipeName: "",
      })),
    };
  }

  const members: MemberRow[] = await db
    .select()
    .from(member)
    .where(eq(member.householdId, householdId));
  if (!members.length) {
    throw new PlanError("no_members", "this household has no members to plan for");
  }

  const profiles: MemberProfile[] = [];
  const poolMembers: { id: string; allergens: string[]; diet: string }[] = [];
  for (const m of members) {
    const health = await readHealth(db, householdId, m.id);
    const allergens = [...(health.allergies ?? []), ...(health.otherAllergens ?? [])];
    const activity = ACTIVITY_MAP[m.activityLevel] ?? "moderate";
    profiles.push({
      memberId: m.id,
      name: m.name,
      age: ageFromBirthYm(m.birthYm, now),
      activity,
      allergies: allergens,
      conditions: health.conditions ?? [],
      dietPreferences: m.dietPattern === "unspecified" || m.dietPattern === "omnivore" ? [] : [m.dietPattern],
    });
    poolMembers.push({ id: m.id, allergens, diet: m.dietPattern });
  }

  const pool = await loadRecipePool(db, householdId, poolMembers);
  if (!pool.recipes.length) {
    const reason = pool.blockedOn as ExcludeReason | null;
    if (reason === "diet_provenance_unavailable") {
      throw new PlanError(
        "pool_blocked",
        "stored recipes carry no diet provenance, so a vegetarian/vegan/pescatarian/halal/kosher household cannot be planned safely yet",
        { reason, members: poolMembers.map((m) => m.diet) },
      );
    }
    throw new PlanError(
      "no_recipes",
      reason === "allergen_unconfirmed"
        ? "every available recipe is excluded by a household member's unconfirmed allergen"
        : reason === "no_nutrients"
          ? "available recipes have no nutrition rollup, so they cannot be banded by energy"
          : "no recipes are available for this household yet",
      { reason, excluded: pool.excluded.slice(0, 10) },
    );
  }

  const agent = new MealPlannerAgent();
  const drafted = await agent.draftPlan({
    requestType: "plan",
    pool: pool.recipes,
    memberIds: members.map((m) => m.id),
    memberProfiles: profiles,
    startDate: weekStart,
    planDays: 7,
    seed,
  });

  // Captured into a local because PlanResponse is not a discriminated union:
  // `success: true` does not narrow `meals`, and the earlier `?.length` test
  // left every later use of drafted.meals possibly-undefined.
  const meals = drafted.meals ?? [];
  if (!drafted.success || meals.length === 0) {
    throw new PlanError("planner_refused", drafted.error ?? "planner produced no meals", {
      poolSize: pool.recipes.length,
    });
  }

  // Mock or fixture ids would satisfy nothing but the FK check, and the FK error
  // is a confusing 500 at insert. Fail here with the real reason.
  const badId = meals.find((m) => !UUID_RE.test(m.recipe.id));
  if (badId) {
    throw new PlanError("non_persistable_recipe", "planner returned a recipe id that is not a stored recipe", {
      recipeId: badId.recipe.id,
    });
  }

  const nameById = new Map(pool.recipes.map((r) => [r.id, r.name]));

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(plan)
      .values({
        householdId,
        weekStart,
        seed,
        status: "draft",
        createdBy: "agent",
        prefsJson: {
          memberIds: members.map((m) => m.id),
          allergens: [...new Set(profiles.flatMap((p) => p.allergies))],
          diets: [...new Set(members.map((m) => m.dietPattern))],
          poolSize: pool.recipes.length,
        },
      })
      .returning({ id: plan.id });

    const planId = row!.id;

    for (const meal of meals) {
      const [slot] = await tx
        .insert(planSlot)
        .values({
          planId,
          date: meal.date,
          mealType: meal.mealType,
          mode: "shared",
          sharedRecipeId: meal.recipe.id,
          locked: false,
        })
        .returning({ id: planSlot.id });

      await tx.insert(slotMember).values(
        members.map((m) => ({ slotId: slot!.id, memberId: m.id })),
      );
    }

    return {
      created: true,
      planId,
      weekStart,
      seed,
      slots: meals.length,
      status: "draft" as const,
      meals: meals.map((m) => ({
        date: m.date,
        mealType: m.mealType,
        recipeId: m.recipe.id,
        recipeName: m.recipe.name || nameById.get(m.recipe.id) || "",
      })),
    } satisfies FirstPlanResult;
  });
}
