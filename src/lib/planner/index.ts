/**
 * M3 Planner Tools — Deterministic meal plan generation with reproducible seeding.
 * Supports: createPlan(), lock(), swap(), regenerate() operations.
 * All functions are pure and seed-driven for reproducibility.
 */

export interface Recipe {
  id: string;
  name: string;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  ingredients: string[];
  caloriesPerServing: number;
  allergens: string[];
  isOwnSource: boolean;
  /**
   * Which slots this dish is meant to fill. Optional on purpose: the planner
   * fixtures and any recipe predating ADR-124 carry no tags, and an untagged
   * recipe must keep the energy-only behaviour rather than disappear from every
   * band. A caller that loads from the database (planning/pool.ts) always sets
   * it from `recipe.meal_types`.
   */
  mealTypes?: readonly SlotKind[];
}

/** The three cooked slots. `snack` exists in MealSlot but is not banded here. */
export type SlotKind = "breakfast" | "lunch" | "dinner" | "snack";

export interface MealSlot {
  date: string; // ISO date: YYYY-MM-DD
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  recipe: Recipe;
  locked: boolean;
}

export interface PlanOptions {
  /**
   * Candidate recipes, supplied by the caller. Required: this used to be
   * implicit, and createPlan() silently drew from RECIPE_LIBRARY below, so a
   * plan generated for a real household consisted of 16 hardcoded mock meals
   * (chicken, salmon, apple pie) whose ids are not `recipe.id` values and can
   * therefore never be persisted (plan_slot.shared_recipe_id FKs to recipe).
   * The library is still exported, but only as a declared test fixture.
   */
  pool: Recipe[];
  seed: number;
  memberIds: string[];
  startDate: string; // YYYY-MM-DD
  planDays: number;
  targetEnergyKcal: number;
  allergens: string[];
  dietPreferences: string[];
  requireOwnSourceDinners: boolean;
}

export interface MealPlan {
  planId: string;
  meals: MealSlot[];
  rationale: string;
  createdAt: string;
}

// Test fixture ONLY. Production planning must pass options.pool built from real
// `recipe` rows (src/lib/planning/pool.ts); nothing reads this by default.
export const RECIPE_LIBRARY: Record<string, Recipe> = {
  "recipe-001": {
    id: "recipe-001",
    name: "Oatmeal with Berries",
    servings: 1,
    prepMinutes: 2,
    cookMinutes: 3,
    ingredients: ["oats", "milk", "berries"],
    caloriesPerServing: 320,
    allergens: ["gluten"],
    isOwnSource: false,
  },
  "recipe-002": {
    id: "recipe-002",
    name: "Grilled Chicken Breast",
    servings: 1,
    prepMinutes: 10,
    cookMinutes: 20,
    ingredients: ["chicken breast", "olive oil", "salt", "pepper"],
    caloriesPerServing: 280,
    allergens: [],
    isOwnSource: false,
  },
  "recipe-003": {
    id: "recipe-003",
    name: "Caesar Salad",
    servings: 1,
    prepMinutes: 5,
    cookMinutes: 0,
    ingredients: ["romaine", "parmesan", "croutons", "caesar dressing"],
    caloriesPerServing: 250,
    allergens: ["gluten", "dairy"],
    isOwnSource: false,
  },
  "recipe-004": {
    id: "recipe-004",
    name: "Salmon with Vegetables",
    servings: 1,
    prepMinutes: 10,
    cookMinutes: 15,
    ingredients: ["salmon fillet", "broccoli", "carrot", "olive oil"],
    caloriesPerServing: 420,
    allergens: ["fish"],
    isOwnSource: false,
  },
  "recipe-005": {
    id: "recipe-005",
    name: "Pasta Marinara",
    servings: 1,
    prepMinutes: 5,
    cookMinutes: 15,
    ingredients: ["pasta", "tomato sauce", "garlic", "olive oil"],
    caloriesPerServing: 380,
    allergens: ["gluten"],
    isOwnSource: false,
  },
  "recipe-006": {
    id: "recipe-006",
    name: "Family Lasagna",
    servings: 6,
    prepMinutes: 20,
    cookMinutes: 45,
    ingredients: ["pasta sheets", "ground beef", "ricotta", "mozzarella", "tomato sauce"],
    caloriesPerServing: 480,
    allergens: ["gluten", "dairy"],
    isOwnSource: true, // Own-source recipe
  },
  "recipe-007": {
    id: "recipe-007",
    name: "Apple Pie",
    servings: 8,
    prepMinutes: 20,
    cookMinutes: 40,
    ingredients: ["apples", "flour", "sugar", "butter"],
    caloriesPerServing: 380,
    allergens: ["gluten", "dairy"],
    isOwnSource: true, // Own-source recipe
  },
  "recipe-008": {
    id: "recipe-008",
    name: "Turkey Meatballs",
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 20,
    ingredients: ["ground turkey", "breadcrumbs", "egg", "garlic"],
    caloriesPerServing: 290,
    allergens: ["gluten"],
    isOwnSource: true, // Own-source recipe
  },
};

// Simple seeded random number generator for reproducibility
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  choice<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)]!;
  }

  range(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

/**
 * Create a meal plan from member preferences, deterministically seeded.
 */
export function createPlan(options: PlanOptions): MealPlan {
  const rng = new SeededRandom(options.seed);
  const meals: MealSlot[] = [];
  const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // Available recipes filtered by allergens.
  // NOTE: this is defence in depth, not the whole filter. The planner has never
  // used options.dietPreferences (a vegetarian household would happily receive
  // meat from a pool that contains it); hard filters on diet, cook time and
  // uncertain allergens belong to the pool loader, which has the data for them.
  if (!Array.isArray(options.pool) || options.pool.length === 0) {
    throw new Error("createPlan requires a non-empty options.pool");
  }
  const availableRecipes = options.pool.filter((recipe) => {
    return !recipe.allergens.some((allergen) => options.allergens.includes(allergen));
  });
  if (availableRecipes.length === 0) {
    throw new Error("createPlan: every pooled recipe is excluded by the household allergens");
  }

  // ADR-124. Energy bands stay exactly as they were, but they are no longer the
  // ONLY rule: a slot used to be filled by any recipe whose calories fit, so a
  // 311 kcal upma was eligible for dinner and a 363 kcal roti-sabzi for
  // breakfast. That is what the first real production week exposed - see ADR-124,
  // which is why meal_types is now consulted. Untagged recipes keep the old
  // energy-only behaviour per band, so nothing silently vanishes from a pool.
  const ENERGY_BANDS: Record<"breakfast" | "lunch" | "dinner", (kcal: number) => boolean> = {
    breakfast: (k) => k < 400,
    lunch: (k) => k >= 250 && k < 450,
    dinner: (k) => k >= 300,
  };

  const forSlot = (slot: "breakfast" | "lunch" | "dinner"): Recipe[] => {
    const byEnergy = availableRecipes.filter((r) => ENERGY_BANDS[slot](r.caloriesPerServing));
    const tagged = byEnergy.filter((r) => (r.mealTypes ?? []).includes(slot));
    // Fall back per band, never globally: a pool whose recipes are all tagged
    // for other slots still gets a full week rather than an empty option list.
    return tagged.length > 0 ? tagged : byEnergy;
  };

  const breakfastOptions = forSlot("breakfast");
  const lunchOptions = forSlot("lunch");
  const dinnerOptions = forSlot("dinner");
  const ownSourceDinners = dinnerOptions.filter((r) => r.isOwnSource);

  // rng.choice() on an empty array returns undefined, and the meal was then
  // pushed with `recipe: undefined` — a TypeError several frames away (or, in
  // the agent path, a "success" with a hole in the week). Say which band is
  // short instead: this is the common case for a small household pool, e.g.
  // four recipes where none lands in the 250-450 lunch band.
  const emptyBands = [
    ["breakfast", breakfastOptions.length],
    ["lunch", lunchOptions.length],
    ["dinner", dinnerOptions.length],
  ].filter(([, n]) => n === 0).map(([n]) => n);
  if (emptyBands.length) {
    throw new Error(
      `createPlan: no candidate recipe left for ${emptyBands.join(", ")} — the pool is too small or too uniform (pool=${options.pool.length}, available after allergens=${availableRecipes.length})`,
    );
  }

  // Generate meals for each day
  const startDate = new Date(options.startDate);
  for (let day = 0; day < options.planDays; day++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() + day);
    const dateStr = currentDate.toISOString().split("T")[0]!;

    // ADR-124 part 2: no identical dish twice in one calendar day. The first
    // production week served Suji Upma for both lunch and dinner on the same day
    // (and again for breakfast+lunch two days later). Draws stay one-per-slot, so
    // the seeded sequence length is unchanged and determinism holds; only the
    // candidate list shrinks as the day fills up. If a band is left with nothing
    // but already-used dishes, repeating is better than a hole in the week; that
    // fallback is deliberate (a missing meal is worse than a familiar one).
    const usedToday = new Set<string>();
    const pick = (candidates: Recipe[]): { recipe: Recipe; repeated: boolean } => {
      const fresh = candidates.filter((r) => !usedToday.has(r.id));
      const list = fresh.length > 0 ? fresh : candidates;
      const chosen = rng.choice(list);
      if (!chosen) {
        throw new Error(
          `createPlan: no candidate recipe left for ${dateStr} (pool=${options.pool.length}, available after allergens=${availableRecipes.length})`,
        );
      }
      usedToday.add(chosen.id);
      return { recipe: chosen, repeated: fresh.length === 0 };
    };

    const breakfast = pick(breakfastOptions).recipe;
    meals.push({
      date: dateStr,
      mealType: "breakfast",
      recipe: breakfast,
      locked: false,
    });

    const lunch = pick(lunchOptions).recipe;
    meals.push({
      date: dateStr,
      mealType: "lunch",
      recipe: lunch,
      locked: false,
    });

    // Select dinner (with own-source bias if required)
    let dinner: Recipe;
    if (
      options.requireOwnSourceDinners &&
      ownSourceDinners.length > 0 &&
      rng.next() > 0.4
    ) {
      dinner = pick(ownSourceDinners).recipe;
    } else {
      dinner = pick(dinnerOptions).recipe;
    }
    meals.push({
      date: dateStr,
      mealType: "dinner",
      recipe: dinner,
      locked: false,
    });
  }

  const rationale = generateRationale(options, meals);

  return {
    planId,
    meals,
    rationale,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Lock a specific meal in the plan (prevents regeneration from changing it).
 */
export function lock(
  plan: MealPlan,
  date: string,
  mealType: "breakfast" | "lunch" | "dinner" | "snack",
): MealPlan {
  return {
    ...plan,
    meals: plan.meals.map((meal) =>
      meal.date === date && meal.mealType === mealType
        ? { ...meal, locked: true }
        : meal,
    ),
  };
}

/**
 * Unlock a specific meal in the plan.
 */
export function unlock(
  plan: MealPlan,
  date: string,
  mealType: "breakfast" | "lunch" | "dinner" | "snack",
): MealPlan {
  return {
    ...plan,
    meals: plan.meals.map((meal) =>
      meal.date === date && meal.mealType === mealType
        ? { ...meal, locked: false }
        : meal,
    ),
  };
}

/**
 * Swap a meal with another recipe (only if not locked).
 */
export function swap(
  plan: MealPlan,
  date: string,
  mealType: "breakfast" | "lunch" | "dinner" | "snack",
  newRecipe: Recipe,
): MealPlan {
  return {
    ...plan,
    meals: plan.meals.map((meal) =>
      meal.date === date && meal.mealType === mealType && !meal.locked
        ? { ...meal, recipe: newRecipe }
        : meal,
    ),
  };
}

/**
 * Regenerate unlocked meals with the same seed and options.
 */
export function regenerate(
  plan: MealPlan,
  options: PlanOptions,
): MealPlan {
  // Regenerate with a modified seed to get different meals
  const newPlan = createPlan({ ...options, seed: options.seed + 1 });

  // Preserve locked meals from original plan
  const lockedMeals = plan.meals.filter((m) => m.locked);
  const unlockedSlots = plan.meals.filter((m) => !m.locked);

  const merged = [
    ...lockedMeals,
    ...newPlan.meals.slice(0, unlockedSlots.length),
  ].sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    if (dateA !== dateB) return dateA - dateB;
    const mealOrder: Record<string, number> = {
      breakfast: 0,
      lunch: 1,
      dinner: 2,
      snack: 3,
    };
    return (mealOrder[a.mealType] || 0) - (mealOrder[b.mealType] || 0);
  });

  return {
    ...plan,
    meals: merged,
    rationale: generateRationale(options, merged),
  };
}

/**
 * Generate a human-readable rationale for the plan.
 */
function generateRationale(options: PlanOptions, meals: MealSlot[]): string {
  const totalCals = meals.reduce((sum, m) => sum + m.recipe.caloriesPerServing, 0);
  const avgCalsPerDay = Math.round(totalCals / options.planDays);
  const ownSourceDinners = meals.filter(
    (m) => m.mealType === "dinner" && m.recipe.isOwnSource,
  ).length;

  return [
    `Plan optimized for ${options.memberIds.length} member(s).`,
    `Allergen-free plan excludes: ${options.allergens.join(", ") || "none"}`,
    `Average ${avgCalsPerDay} kcal/day (target: ${options.targetEnergyKcal}).`,
    `${ownSourceDinners} own-source dinners included.`,
  ].join(" ");
}

/**
 * Get a specific meal from the plan.
 */
export function getMeal(
  plan: MealPlan,
  date: string,
  mealType: "breakfast" | "lunch" | "dinner" | "snack",
): MealSlot | undefined {
  return plan.meals.find((m) => m.date === date && m.mealType === mealType);
}

/**
 * Get all meals for a specific date.
 */
export function getMealsForDate(plan: MealPlan, date: string): MealSlot[] {
  return plan.meals.filter((m) => m.date === date);
}

/**
 * Get all own-source meals in the plan.
 */
export function getOwnSourceMeals(plan: MealPlan): MealSlot[] {
  return plan.meals.filter((m) => m.recipe.isOwnSource);
}

/**
 * Get all locked meals in the plan.
 */
export function getLockedMeals(plan: MealPlan): MealSlot[] {
  return plan.meals.filter((m) => m.locked);
}

/**
 * Calculate total energy for a specific date.
 */
export function calculateDayEnergy(plan: MealPlan, date: string): number {
  return getMealsForDate(plan, date).reduce((sum, m) => sum + m.recipe.caloriesPerServing, 0);
}
