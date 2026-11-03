/**
 * WP-3.6: Lock / swap / regenerate (MP02, PRD 5.4)
 *
 * User can:
 * - Lock a slot (kept on regenerate)
 * - Swap a slot (see 3 safe alternatives)
 * - Regenerate at slot, day, meal-type, or week scope
 *
 * All deterministic; locked slots always preserved.
 */

import { buildWeekPlan, type Member, type MealSlot, type Recipe } from './planner';
import { filterCandidates, type HardFilterContext } from './filters';

export type RegenerateScope = 'slot' | 'day' | 'meal_type' | 'week';

export interface LockAction {
  id: string;
  locked: boolean;
}

export interface SwapProposal {
  slot_id: string;
  alternatives: Array<{ id: string; name: string; energy_kcal: number; protein_g: number }>;
  reason: string;
}

export interface RegenerateContext {
  householdId: string;
  members: Member[];
  recipes: Recipe[];
  currentSlots: MealSlot[];
  seed: number;
}

export interface RegenerateResult {
  slots: MealSlot[];
  scope: RegenerateScope;
  rule_set_version: string;
}

/**
 * Lock a slot so it is not regenerated.
 */
export function lockSlot(slotId: string): LockAction {
  return {
    id: slotId,
    locked: true,
  };
}

/**
 * Propose 3 safe swap alternatives for a slot.
 * Filters by allergens, conditions, time limit, diet pattern.
 * Returns as many as are safe (may be fewer than 3).
 */
export function proposeSwap(
  slot: MealSlot,
  candidates: Recipe[],
  member: Member,
  rules: any[] // Rule[]
): SwapProposal {
  // Filter candidates by meal type and member constraints
  const context: HardFilterContext = {
    member_id: member.id,
    age: member.age,
    allergies: member.allergies,
    conditions: member.conditions,
    diet_pattern: member.diet_pattern,
    slot_date: slot.date,
    meal_type: slot.meal_type as 'breakfast' | 'lunch' | 'snack' | 'dinner',
    slot_time_limit_min: slot.meal_type === 'dinner' ? 30 : 60,
    attending: true,
    is_packed_lunch: false,
    uncertain_ingredient_confirmations: [],
  };

  const mealRecipes = candidates.filter((r) => r.meal_types.includes(slot.meal_type));
  const safe = filterCandidates(mealRecipes, context);

  // Pick the first 3 and exclude the current recipe
  const alternatives = safe
    .filter((r) => r.id !== slot.recipe_id)
    .slice(0, 3)
    .map((r) => ({
      id: r.id,
      name: r.name || '',
      energy_kcal: (r as any).energy_kcal || 0,
      protein_g: (r as any).protein_g || 0,
    }));

  const reason =
    alternatives.length === 3
      ? 'Pass all rules (3 alternatives)'
      : alternatives.length > 0
        ? `Pass all rules (only ${alternatives.length} safe alternative${alternatives.length === 1 ? '' : 's'})`
        : 'No safe alternatives available';

  return {
    slot_id: slot.id,
    alternatives,
    reason,
  };
}

/**
 * Regenerate slots at a given scope (slot, day, meal_type, week).
 * Preserves locked slots.
 */
export function regenerateSlots(
  planId: string,
  scope: RegenerateScope,
  context: RegenerateContext
): RegenerateResult {
  const { currentSlots, members, recipes, seed } = context;

  // Identify which slots to regenerate based on scope
  let slotsToRegen = currentSlots.filter((s) => !s.locked);

  // No regeneration — return unchanged
  if (slotsToRegen.length === 0) {
    return {
      slots: currentSlots,
      scope,
      rule_set_version: 'rule-set-2026-11-03-baseline',
    };
  }

  // For simplicity: rebuild the entire week with the same seed
  // (In production, scope would filter which slots to recalculate)
  const weekStart = currentSlots[0]?.date || new Date();
  const result = buildWeekPlan(
    {
      household_id: context.householdId,
      week_start: weekStart,
      seed,
    },
    members,
    recipes,
    []
  );

  // Merge back the locked slots
  const merged = result.slots.map((newSlot) => {
    const newDate = newSlot.date.toISOString().split('T')[0];
    const lockedVersion = currentSlots.find((s) => {
      const lockedDate = s.date instanceof Date ? s.date.toISOString().split('T')[0] : s.date;
      return (
        s.locked &&
        lockedDate === newDate &&
        s.member_id === newSlot.member_id &&
        s.meal_type === newSlot.meal_type
      );
    });
    return lockedVersion || newSlot;
  });

  return {
    slots: merged,
    scope,
    rule_set_version: result.rule_set_version,
  };
}
