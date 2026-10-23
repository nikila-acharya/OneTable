/**
 * WP-2.4 food_item seed (PRD 5.3, starter library): simple foods the planner can use without a recipe.
 * Each entry is a USDA FoodData Central food picked by hand from recorded search results
 * (tests/fixtures/fdc/food-seed/). Portions are USDA standard units, rounded, and need a dietitian
 * check before the planner relies on them. Allergen tags for these foods come with the allergen work (not here).
 */
export interface StarterFood {
  name: string;
  fdcId: string;
  usdaDescription: string;
  defaultPortionG: number;
  portionNote: string;
  mealTypes: ("breakfast" | "lunch" | "snack" | "dinner")[];
}

export const STARTER_FOODS: StarterFood[] = [
  { name: "banana", fdcId: "173944", usdaDescription: "Bananas, raw", defaultPortionG: 118, portionNote: "1 medium", mealTypes: ["breakfast", "snack"] },
  { name: "plain Greek yogurt", fdcId: "170903", usdaDescription: "Yogurt, Greek, plain, lowfat", defaultPortionG: 170, portionNote: "1 small tub", mealTypes: ["breakfast", "snack"] },
  { name: "apple", fdcId: "171689", usdaDescription: "Apples, raw, without skin", defaultPortionG: 182, portionNote: "1 medium", mealTypes: ["snack"] },
  { name: "egg, whole", fdcId: "171287", usdaDescription: "Egg, whole, raw, fresh", defaultPortionG: 50, portionNote: "1 large", mealTypes: ["breakfast"] },
  { name: "rolled oats", fdcId: "2346396", usdaDescription: "Oats, whole grain, rolled, old fashioned", defaultPortionG: 40, portionNote: "1/2 cup dry", mealTypes: ["breakfast"] },
  { name: "whole wheat bread", fdcId: "172688", usdaDescription: "Bread, whole-wheat, commercially prepared", defaultPortionG: 28, portionNote: "1 slice", mealTypes: ["breakfast"] },
  { name: "brown rice, cooked", fdcId: "169704", usdaDescription: "Rice, brown, long-grain, cooked (Includes foods for USDA's Food Distribution Program)", defaultPortionG: 195, portionNote: "1 cup", mealTypes: ["lunch", "dinner"] },
  { name: "carrot", fdcId: "170393", usdaDescription: "Carrots, raw", defaultPortionG: 61, portionNote: "1 medium", mealTypes: ["snack"] },
  { name: "cucumber", fdcId: "169225", usdaDescription: "Cucumber, peeled, raw", defaultPortionG: 301, portionNote: "1 cup sliced", mealTypes: ["snack"] },
  { name: "chickpeas, cooked", fdcId: "173799", usdaDescription: "Chickpeas (garbanzo beans, bengal gram), mature seeds, cooked, boiled, with salt", defaultPortionG: 164, portionNote: "1 cup", mealTypes: ["lunch", "dinner"] },
  { name: "spinach, raw", fdcId: "168462", usdaDescription: "Spinach, raw", defaultPortionG: 30, portionNote: "1 cup", mealTypes: ["lunch", "dinner"] },
  { name: "tomato", fdcId: "170457", usdaDescription: "Tomatoes, red, ripe, raw, year round average", defaultPortionG: 123, portionNote: "1 medium", mealTypes: ["lunch", "dinner"] },
  { name: "orange", fdcId: "169918", usdaDescription: "Oranges, raw, Florida", defaultPortionG: 131, portionNote: "1 medium", mealTypes: ["snack"] },
];
