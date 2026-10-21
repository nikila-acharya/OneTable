/**
 * Household cooking preferences (PRD 5.0 step 2). Validation is pure; storage is
 * one row per household with PRD defaults when absent (ADR-010).
 * Bounds are [Proposed] for the owner to confirm.
 */
import { eq } from "drizzle-orm";
import { householdSettings } from "../../../db/schema";
import type { Db } from "../db";

export const BUDGET_FEELS = ["keep-it-cheap", "balanced", "no-stress"] as const;
export type BudgetFeel = (typeof BUDGET_FEELS)[number];

export const SETTINGS_BOUNDS = {
  breakfastMinutes: { min: 5, max: 60 },
  dinnerMinutes: { min: 10, max: 120 },
  cuisinesMax: 20,
  cuisineMaxLength: 30,
} as const;

export const PRD_DEFAULTS = { weekdayBreakfastMinutes: 10, weeknightDinnerMinutes: 30, cuisines: [] as string[], budgetFeel: null as BudgetFeel | null };

export interface HouseholdSettings {
  weekdayBreakfastMinutes: number;
  weeknightDinnerMinutes: number;
  cuisines: string[];
  budgetFeel: BudgetFeel | null;
}

export interface SettingsInput {
  weekdayBreakfastMinutes?: unknown;
  weeknightDinnerMinutes?: unknown;
  cuisines?: unknown;
  budgetFeel?: unknown; // "" or null mean "not answered"
}

export type SettingsValidation =
  | { ok: true; value: HouseholdSettings }
  | { ok: false; issues: string[] };

function inRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** Pure check; nothing is stored here. Used before any write. */
export function validateSettings(input: SettingsInput): SettingsValidation {
  const issues: string[] = [];
  const { breakfastMinutes: b, dinnerMinutes: d, cuisinesMax, cuisineMaxLength } = SETTINGS_BOUNDS;

  if (!inRange(input.weekdayBreakfastMinutes, b.min, b.max)) {
    issues.push(`weekday breakfast must be a whole number of minutes from ${b.min} to ${b.max}`);
  }
  if (!inRange(input.weeknightDinnerMinutes, d.min, d.max)) {
    issues.push(`weeknight dinner must be a whole number of minutes from ${d.min} to ${d.max}`);
  }

  const cuisines: string[] = [];
  if (!Array.isArray(input.cuisines)) {
    issues.push("cuisines must be a list");
  } else {
    const seen = new Set<string>();
    for (const raw of input.cuisines) {
      if (typeof raw !== "string") { issues.push("each cuisine must be text"); break; }
      const c = raw.trim();
      if (c === "" || c.length > cuisineMaxLength) { issues.push(`each cuisine must be 1 to ${cuisineMaxLength} characters`); break; }
      if (!seen.has(c)) { seen.add(c); cuisines.push(c); }
    }
    if (cuisines.length > cuisinesMax) issues.push(`at most ${cuisinesMax} cuisines`);
  }

  let budgetFeel: BudgetFeel | null = null;
  if (input.budgetFeel !== undefined && input.budgetFeel !== null && input.budgetFeel !== "") {
    if ((BUDGET_FEELS as readonly unknown[]).includes(input.budgetFeel)) budgetFeel = input.budgetFeel as BudgetFeel;
    else issues.push("budget feel must be one of the listed choices");
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      weekdayBreakfastMinutes: input.weekdayBreakfastMinutes as number,
      weeknightDinnerMinutes: input.weeknightDinnerMinutes as number,
      cuisines,
      budgetFeel,
    },
  };
}

export class SettingsRejectedError extends Error {
  readonly code = "settings_rejected" as const;
  constructor(readonly issues: string[]) {
    super(`household settings not saved: ${issues.join("; ")}`);
    this.name = "SettingsRejectedError";
  }
}

export async function getHouseholdSettings(db: Db, householdId: string): Promise<HouseholdSettings> {
  const [row] = await db.select().from(householdSettings).where(eq(householdSettings.householdId, householdId));
  if (!row) return { ...PRD_DEFAULTS, cuisines: [] };
  return {
    weekdayBreakfastMinutes: row.weekdayBreakfastMinutes,
    weeknightDinnerMinutes: row.weeknightDinnerMinutes,
    cuisines: [...row.cuisines],
    budgetFeel: (row.budgetFeel as BudgetFeel | null) ?? null,
  };
}

/** Validates first, then upserts. Refused input stores nothing. */
export async function saveHouseholdSettings(db: Db, householdId: string, input: SettingsInput): Promise<HouseholdSettings> {
  const v = validateSettings(input);
  if (!v.ok) throw new SettingsRejectedError(v.issues);
  const now = new Date();
  await db
    .insert(householdSettings)
    .values({ householdId, ...v.value, updatedAt: now })
    .onConflictDoUpdate({
      target: householdSettings.householdId,
      set: { ...v.value, updatedAt: now },
    });
  return v.value;
}
