/**
 * WP-3.4: Hard filters for meal selection (SG-A, MP01)
 *
 * Deterministic filtering of recipe candidates per member and slot.
 * Removes ineligible recipes before scoring/selection (PRD 5.4):
 * 1. Allergen hard filters (SG-A)
 * 2. Uncertain ingredients (SG-A, confirmed by user)
 * 3. Slot time limits (MP01)
 * 4. Member not attending
 * 5. Packed lunch suitability
 * 6. Dietary pattern / cultural / ethical constraints
 *
 * Every filtering decision is deterministic; no LLM involved.
 */

export interface HardFilterContext {
  member_id: string;
  age: number;
  allergies: string[];
  conditions: string[];
  diet_pattern?: string;
  slot_date: Date;
  meal_type: 'breakfast' | 'lunch' | 'snack' | 'dinner';
  slot_time_limit_min: number;
  attending: boolean;
  is_packed_lunch: boolean;
  uncertain_ingredient_confirmations?: string[];
}

export interface Candidate {
  id: string;
  name?: string;
  allergens?: string[];
  uncertain_ingredients?: string[];
  prep_time_min?: number;
  packable?: boolean;
  diet_patterns?: string[];
}

/**
 * Filter candidates for a member and slot.
 * Returns recipes that pass ALL hard filters.
 */
export function filterCandidates(
  candidates: Candidate[],
  context: HardFilterContext
): Candidate[] {
  if (!context.attending) {
    return []; // Member not attending this slot
  }

  return candidates.filter((recipe) => {
    // 1. Allergen hard filter (SG-A)
    if (hasAllergen(recipe, context.allergies)) {
      return false;
    }

    // 2. Uncertain ingredients (SG-A)
    if (
      hasUnconfirmedUncertainIngredient(
        recipe,
        context.uncertain_ingredient_confirmations || []
      )
    ) {
      return false;
    }

    // 3. Slot time limit (MP01)
    if (recipe.prep_time_min && recipe.prep_time_min > context.slot_time_limit_min) {
      return false;
    }

    // 4. Packed lunch requirement
    if (context.is_packed_lunch && recipe.packable === false) {
      return false;
    }

    // 5. Dietary pattern constraint
    if (
      context.diet_pattern &&
      recipe.diet_patterns &&
      !recipe.diet_patterns.includes(context.diet_pattern)
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Check if a recipe contains any of the member's allergens.
 */
function hasAllergen(recipe: Candidate, allergies: string[]): boolean {
  if (!recipe.allergens) return false;
  return recipe.allergens.some((allergen) => allergies.includes(allergen));
}

/**
 * Check if a recipe has uncertain ingredients that are NOT confirmed.
 */
function hasUnconfirmedUncertainIngredient(
  recipe: Candidate,
  confirmations: string[]
): boolean {
  if (!recipe.uncertain_ingredients) return false;
  return recipe.uncertain_ingredients.some((uncertain) => !confirmations.includes(uncertain));
}

/**
 * Export types for planner use
 */
