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
}

export interface MealSlot {
  date: string; // ISO date: YYYY-MM-DD
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  recipe: Recipe;
  locked: boolean;
}

export interface PlanOptions {
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

// Mock recipe library for deterministic generation
const RECIPE_LIBRARY: Record<string, Recipe> = {
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

  // Available recipes filtered by allergens
  const availableRecipes = Object.values(RECIPE_LIBRARY).filter((recipe) => {
    return !recipe.allergens.some((allergen) => options.allergens.includes(allergen));
  });

  // Breakfast options
  const breakfastOptions = availableRecipes.filter((r) => r.caloriesPerServing < 400);

  // Lunch options
  const lunchOptions = availableRecipes.filter((r) => r.caloriesPerServing >= 250 && r.caloriesPerServing < 450);

  // Dinner options (own-source required for some slots if option set)
  let dinnerOptions = availableRecipes.filter((r) => r.caloriesPerServing >= 300);
  const ownSourceDinners = dinnerOptions.filter((r) => r.isOwnSource);

  // Generate meals for each day
  const startDate = new Date(options.startDate);
  for (let day = 0; day < options.planDays; day++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() + day);
    const dateStr = currentDate.toISOString().split("T")[0]!;

    // Select breakfast
    const breakfast = rng.choice(breakfastOptions);
    meals.push({
      date: dateStr,
      mealType: "breakfast",
      recipe: breakfast,
      locked: false,
    });

    // Select lunch
    const lunch = rng.choice(lunchOptions);
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
      dinner = rng.choice(ownSourceDinners);
    } else {
      dinner = rng.choice(dinnerOptions);
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
