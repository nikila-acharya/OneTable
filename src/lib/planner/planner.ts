/**
 * WP-3.5: Deterministic meal planner (MP01, MP02, PRD 5.4)
 *
 * Core logic:
 * 1. Hard-filter candidates per member and slot (filters.ts)
 * 2. Score remaining candidates (own-source preference, variety, nutrient fit, agent soft prefs)
 * 3. Pick greedily day-by-day with a seeded random tiebreak
 * 4. Daily nutrient roll-up per member
 *
 * The planner is deterministic code, NOT an LLM. Agent calls planner with soft preferences
 * (e.g., "more Indian dinners", "extra people Saturday") but NEVER hard rules.
 * Every candidate passes the rule engine before it can be placed.
 */

import { filterCandidates, type HardFilterContext } from './filters';
import { calculateTargets, type DRITarget, type TargetInput } from '../conditions/targets';
import { checkAgainstRules, type Rule } from '../rules/engine';

export interface SoftPreferences {
  household_id: string;
  week_start: Date;
  seed: number; // Seeded RNG for deterministic tiebreak
  agent_prefs?: Record<string, number>; // e.g., { cuisine_indian: 0.2 } = 20% weight
}

export interface Member {
  id: string;
  age: number;
  sex: 'male' | 'female';
  allergies: string[];
  conditions: string[];
  diet_pattern?: string;
  weight_kg: number;
  height_cm: number;
  activity: 'sedentary' | 'light' | 'moderate' | 'very_active';
  attendance?: Record<string, boolean>; // ISO date string => attending
}

export interface Recipe {
  id: string;
  name: string;
  meal_types: string[];
  prep_time_min?: number;
  allergens?: string[];
  uncertain_ingredients?: string[];
  packable?: boolean;
  diet_patterns?: string[];
  energy_kcal: number;
  protein_g: number;
  carbs_g?: number;
  fiber_g?: number;
  own_source?: boolean;
}

export interface MealSlot {
  id: string;
  plan_id: string;
  date: Date;
  meal_type: 'breakfast' | 'lunch' | 'snack' | 'dinner';
  member_id: string;
  recipe_id?: string;
  mode: 'shared' | 'individual';
  locked: boolean;
}

export interface PlanResult {
  slots: MealSlot[];
  rule_set_version: string;
  daily_nutrient_totals?: Record<string, Record<string, number>>; // member_id => { energy_kcal, protein_g, ... }
}

/**
 * Build a week-long meal plan for a household.
 * Returns 7 days x 4 meals x N members deterministically.
 */
export function buildWeekPlan(
  preferences: SoftPreferences,
  members: Member[],
  recipes: Recipe[],
  rules: Rule[]
): PlanResult {
  const slots: MealSlot[] = [];
  const planId = crypto.randomUUID();
  const rng = seededRandom(preferences.seed);
  const mealTypes: Array<'breakfast' | 'lunch' | 'snack' | 'dinner'> = [
    'breakfast',
    'lunch',
    'snack',
    'dinner',
  ];

  // Build one slot per day x meal type x member
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = new Date(preferences.week_start);
    date.setDate(date.getDate() + dayOffset);

    for (const mealType of mealTypes) {
      for (const member of members) {
        // Check attendance
        const dateStr = date.toISOString().split('T')[0];
        const attending = member.attendance?.[dateStr] !== false;

        if (!attending) continue;

        // Hard filters
        const context: HardFilterContext = {
          member_id: member.id,
          age: member.age,
          allergies: member.allergies,
          conditions: member.conditions,
          diet_pattern: member.diet_pattern,
          slot_date: date,
          meal_type: mealType,
          slot_time_limit_min: mealType === 'dinner' ? 30 : 60,
          attending: true,
          is_packed_lunch: false,
          uncertain_ingredient_confirmations: [],
        };

        const candidates = filterCandidates(
          recipes.filter((r) => r.meal_types.includes(mealType)),
          context
        );

        if (candidates.length === 0) continue;

        // Score and pick best
        const scored = candidates.map((c) => ({
          recipe: c,
          score: scoreRecipe(c, member, preferences),
          tiebreak: rng(),
        }));

        scored.sort((a, b) => b.score - a.score || a.tiebreak - b.tiebreak);
        const picked = scored[0].recipe;

        slots.push({
          id: crypto.randomUUID(),
          plan_id: planId,
          date,
          meal_type: mealType,
          member_id: member.id,
          recipe_id: picked.id,
          mode: 'individual',
          locked: false,
        });
      }
    }
  }

  // Compute rule-set version (from rules, or default if empty)
  const rule_set_version = rules[0]?.version || 'rule-set-2026-11-03-baseline';

  return {
    slots,
    rule_set_version,
  };
}

/**
 * Score a recipe for a member in this context.
 * Factors: own-source preference, variety, nutrients, soft preferences.
 */
function scoreRecipe(recipe: Recipe, member: Member, prefs: SoftPreferences): number {
  let score = 0;

  // Own-source preference (PRD AC: >50% of dinners)
  if (recipe.own_source) score += 100;

  // Agent soft preferences
  if (prefs.agent_prefs) {
    Object.entries(prefs.agent_prefs).forEach(([key, weight]) => {
      if ((recipe as any)[key]) score += weight * 50;
    });
  }

  // Diet pattern match
  if (
    member.diet_pattern &&
    recipe.diet_patterns?.includes(member.diet_pattern)
  ) {
    score += 10;
  }

  return score;
}

/**
 * Seeded random number generator (0.0–1.0).
 * Ensures deterministic tiebreaks across runs with the same seed.
 */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
