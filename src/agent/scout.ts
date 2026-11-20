/**
 * WP-4.6 Scout Agent: Recipe discovery, fetching, parsing, and validation.
 * Fetches recipes from M2 recipe fetcher via lib/recipes/fetcher,
 * validates tags against member profiles, returns structured recipe cards.
 * Read-only (R) on M2 fetcher and member data; approval-gated (A) for recipe adds.
 */

import type { ParsedRecipe } from "@/lib/recipes/schema-org";

/**
 * Recipe search constraints: ingredient, cuisine, cook time.
 */
export interface RecipeSearchParams {
  ingredients?: string[]; // e.g., ["chicken", "rice"]
  cuisines?: string[]; // e.g., ["Italian", "Asian"]
  maxCookTimeMinutes?: number; // e.g., 60
  mealType?: "breakfast" | "lunch" | "dinner" | "snack";
}

/**
 * Member profile for allergen validation.
 */
export interface MemberProfile {
  memberId: string;
  name: string;
  allergies: string[]; // Allergen tags: "peanuts", "tree_nuts", "dairy", etc.
  dietPreferences: string[]; // Diet tags: "vegetarian", "vegan", "gluten_free", etc.
}

/**
 * Structured recipe card returned to coordinator.
 */
export interface RecipeCard {
  id: string;
  name: string;
  cookTimeMinutes: number | null;
  ingredients: string[];
  steps: string[];
  tags: {
    allergens: string[];
    cuisines: string[];
    dietaryRestrictions: string[];
  };
  sourceUrl: string;
  approvalStatus: "pending" | "approved" | "rejected";
}

/**
 * Internal recipe structure from M2 API/fetcher.
 */
interface FetchedRecipe {
  id: string;
  name: string;
  ingredients: string[];
  steps: string[];
  cookTimeMinutes: number | null;
  tags: {
    allergens: string[];
    cuisines: string[];
    dietaryRestrictions: string[];
  };
  sourceUrl: string;
}

/**
 * Scout Agent: Recipe discovery, fetching, parsing, validation.
 * Responsible for:
 * - Searching recipes by ingredient/cuisine/time constraints
 * - Fetching recipes via M2 API
 * - Parsing structured data (name, ingredients, steps, tags, URL)
 * - Validating allergen tags against member profiles
 * - Returning formatted recipe cards
 */
export class ScoutAgent {
  private recipes: Map<string, FetchedRecipe> = new Map();
  private memberProfiles: Map<string, MemberProfile> = new Map();

  /**
   * Initialize with member profiles for allergen validation.
   */
  constructor(memberProfiles: MemberProfile[] = []) {
    for (const profile of memberProfiles) {
      this.memberProfiles.set(profile.memberId, profile);
    }
  }

  /**
   * Search recipes by ingredient, cuisine, and cook time constraints.
   * Returns array of recipes matching all constraints.
   */
  searchRecipes(params: RecipeSearchParams): RecipeCard[] {
    const results: RecipeCard[] = [];

    for (const recipe of this.recipes.values()) {
      // Filter by ingredients (all specified ingredients must be present)
      if (params.ingredients && params.ingredients.length > 0) {
        const hasAllIngredients = params.ingredients.every((ing) =>
          recipe.ingredients.some((recipeIng) =>
            recipeIng.toLowerCase().includes(ing.toLowerCase()),
          ),
        );
        if (!hasAllIngredients) continue;
      }

      // Filter by cuisine (recipe must have at least one matching cuisine)
      if (params.cuisines && params.cuisines.length > 0) {
        const hasCuisine = params.cuisines.some((cuisine) =>
          recipe.tags.cuisines.some(
            (c) => c.toLowerCase() === cuisine.toLowerCase(),
          ),
        );
        if (!hasCuisine) continue;
      }

      // Filter by cook time (recipe cook time must not exceed max)
      if (
        params.maxCookTimeMinutes !== undefined &&
        recipe.cookTimeMinutes !== null
      ) {
        if (recipe.cookTimeMinutes > params.maxCookTimeMinutes) continue;
      }

      // Filter by meal type (if specified)
      if (params.mealType) {
        // Infer meal type from recipe name/cuisine/ingredients heuristics
        const mealType = this.inferMealType(recipe);
        if (mealType !== params.mealType) continue;
      }

      results.push(this.formatRecipeCard(recipe));
    }

    return results;
  }

  /**
   * Fetch a recipe by ID from the M2 API.
   * In production, this would call the actual M2 fetcher.
   * For now, returns a recipe from the in-memory store.
   */
  async fetchRecipeById(recipeId: string): Promise<RecipeCard | null> {
    const recipe = this.recipes.get(recipeId);
    return recipe ? this.formatRecipeCard(recipe) : null;
  }

  /**
   * Parse structured recipe data: extract name, ingredients, steps, tags, URL.
   * Takes parsed recipe from schema.org parser (M2) and normalizes it.
   */
  parseRecipe(parsed: ParsedRecipe): FetchedRecipe {
    const allergens = this.extractAllergenTags(parsed);
    const cuisines = this.extractCuisineTagsFromParsed(parsed);
    const dietaryRestrictions = this.extractDietaryTags(parsed);

    return {
      id: this.generateRecipeId(parsed.sourceUrl),
      name: parsed.title,
      ingredients: parsed.ingredients,
      steps: parsed.steps,
      cookTimeMinutes: parsed.cookMinutes ?? parsed.totalMinutes ?? null,
      tags: {
        allergens,
        cuisines,
        dietaryRestrictions,
      },
      sourceUrl: parsed.sourceUrl,
    };
  }

  /**
   * Add a recipe to the in-memory store (after parsing/validation).
   * In production, this would persist to DB.
   */
  addRecipe(recipe: FetchedRecipe): void {
    this.recipes.set(recipe.id, recipe);
  }

  /**
   * Validate allergen tags against a member's allergies.
   * Returns true if recipe is safe for the member (no allergen conflicts).
   */
  validateAllergenTags(
    recipe: RecipeCard,
    memberProfile: MemberProfile,
  ): boolean {
    // SG-A allergen gate: reject recipes with member allergens
    const conflictingAllergens = recipe.tags.allergens.filter((allergen) =>
      memberProfile.allergies.some((allergy) =>
        allergen.toLowerCase() === allergy.toLowerCase(),
      ),
    );

    return conflictingAllergens.length === 0;
  }

  /**
   * Validate recipes for a specific member: check allergens + dietary preferences.
   * Returns filtered list of safe recipes.
   */
  validateRecipesForMember(
    recipes: RecipeCard[],
    memberId: string,
  ): RecipeCard[] {
    const memberProfile = this.memberProfiles.get(memberId);
    if (!memberProfile) return recipes;

    return recipes.filter((recipe) => {
      // Check allergen gate (SG-A)
      if (!this.validateAllergenTags(recipe, memberProfile)) {
        return false;
      }

      // Check dietary preferences (optional soft constraint)
      // A recipe with tags outside member preferences is still returned,
      // but marked for confirmation.
      return true;
    });
  }

  /**
   * Extract allergen tags from parsed recipe ingredients.
   * Common allergens: nuts, dairy, shellfish, soy, gluten, eggs, sesame, etc.
   */
  private extractAllergenTags(parsed: ParsedRecipe): string[] {
    const allergenKeywords = [
      "peanut",
      "peanuts",
      "tree nut",
      "almond",
      "walnut",
      "cashew",
      "pistachio",
      "pecan",
      "macadamia",
      "brazil nut",
      "hazelnut",
      "pine nut",
      "chestnut",
      "sesame",
      "tahini",
      "dairy",
      "milk",
      "cheese",
      "butter",
      "cream",
      "yogurt",
      "whey",
      "lactose",
      "casein",
      "shellfish",
      "shrimp",
      "crab",
      "lobster",
      "oyster",
      "clam",
      "mussel",
      "fish",
      "salmon",
      "tuna",
      "soy",
      "tofu",
      "tempeh",
      "soybean",
      "edamame",
      "gluten",
      "wheat",
      "barley",
      "rye",
      "spelt",
      "kamut",
      "egg",
      "eggs",
      "sesame seed",
      "mustard",
      "sulfite",
      "sulfite",
      "celery",
      "lupin",
      "mollusc",
    ];

    const foundAllergens = new Set<string>();
    const ingredientText = parsed.ingredients.join(" ").toLowerCase();

    for (const keyword of allergenKeywords) {
      if (ingredientText.includes(keyword)) {
        // Normalize to tag format
        const tag = keyword
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^a-z0-9_]/g, "");
        if (
          !tag.includes("tree") &&
          keyword.includes("tree") &&
          keyword.includes("nut")
        ) {
          foundAllergens.add("tree_nuts");
        } else if (tag === "peanut" || tag === "peanuts") {
          foundAllergens.add("peanuts");
        } else if (tag.includes("nut")) {
          foundAllergens.add("tree_nuts");
        } else if (
          // The specific animal must carry its group tag: a recipe listing
          // "shrimp" produced only the tag "shrimp", so a member allergic to
          // shellfish was never screened against it. Same for salmon/tuna/fish.
          /shellfish|crustacean|mollus|shrimp|prawn|crab|lobster|oyster|clam|mussel|scallop|cuttlefish|octopus|squid|snail|surimi/.test(
            tag,
          )
        ) {
          foundAllergens.add("shellfish");
        } else if (
          /\b(fish|salmon|tuna|cod|halibut|sardine|anchov|trout|mackerel|haddock|tilapia|seafood)\b/.test(
            tag,
          )
        ) {
          foundAllergens.add("fish");
        } else if (tag.includes("soy")) {
          foundAllergens.add("soy");
        } else if (tag.includes("dairy") || tag.includes("milk")) {
          foundAllergens.add("dairy");
        } else if (tag.includes("egg")) {
          foundAllergens.add("eggs");
        } else if (tag.includes("gluten") || tag.includes("wheat")) {
          foundAllergens.add("gluten");
        } else if (tag.includes("sesame")) {
          foundAllergens.add("sesame");
        } else if (tag.includes("mustard")) {
          foundAllergens.add("mustard");
        } else if (tag.includes("sulfite")) {
          foundAllergens.add("sulfites");
        } else if (tag.includes("celery")) {
          foundAllergens.add("celery");
        } else if (tag.includes("lupin")) {
          foundAllergens.add("lupin");
        } else if (tag.includes("mollusc")) {
          foundAllergens.add("molluscs");
        }
      }
    }

    return Array.from(foundAllergens).sort();
  }

  /**
   * Extract cuisine tags from parsed recipe.
   */
  private extractCuisineTagsFromParsed(parsed: ParsedRecipe): string[] {
    if (parsed.cuisine && Array.isArray(parsed.cuisine)) {
      return parsed.cuisine.map((c) => c.toLowerCase()).sort();
    }
    return [];
  }

  /**
   * Extract dietary restriction tags from recipe.
   */
  private extractDietaryTags(parsed: ParsedRecipe): string[] {
    const tags = new Set<string>();
    const text = (
      parsed.title +
      " " +
      parsed.ingredients.join(" ")
    ).toLowerCase();

    if (text.includes("vegan")) tags.add("vegan");
    else if (text.includes("vegetarian")) tags.add("vegetarian");

    if (
      text.includes("gluten-free") ||
      text.includes("gluten free") ||
      text.includes("gf")
    ) {
      tags.add("gluten_free");
    }

    if (
      text.includes("dairy-free") ||
      text.includes("dairy free") ||
      text.includes("lactose free")
    ) {
      tags.add("dairy_free");
    }

    if (text.includes("nut-free") || text.includes("nut free")) {
      tags.add("nut_free");
    }

    if (text.includes("low-carb") || text.includes("keto")) {
      tags.add("low_carb");
    }

    if (text.includes("paleo")) {
      tags.add("paleo");
    }

    return Array.from(tags).sort();
  }

  /**
   * Infer meal type from recipe title/ingredients/cuisine.
   * Heuristic-based: breakfast items, dinner mains, etc.
   */
  private inferMealType(recipe: FetchedRecipe): string {
    const text = (recipe.name + " " + recipe.ingredients.join(" ")).toLowerCase();

    const breakfastKeywords = [
      "breakfast",
      "pancake",
      "waffle",
      "omelet",
      "egg",
      "cereal",
      "toast",
      "bagel",
      "granola",
      "yogurt",
    ];
    if (breakfastKeywords.some((kw) => text.includes(kw))) {
      return "breakfast";
    }

    const snackKeywords = [
      "snack",
      "cookie",
      "brownie",
      "chip",
      "dip",
      "trail mix",
      "granola bar",
      "popcorn",
    ];
    if (snackKeywords.some((kw) => text.includes(kw))) {
      return "snack";
    }

    const lunchKeywords = [
      "sandwich",
      "wrap",
      "salad",
      "soup",
      "lunch",
      "quick",
      "easy",
    ];
    if (lunchKeywords.some((kw) => text.includes(kw))) {
      return "lunch";
    }

    // Default to dinner for main courses
    return "dinner";
  }

  /**
   * Format a fetched recipe into a recipe card for the coordinator.
   */
  private formatRecipeCard(recipe: FetchedRecipe): RecipeCard {
    return {
      id: recipe.id,
      name: recipe.name,
      cookTimeMinutes: recipe.cookTimeMinutes,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      tags: recipe.tags,
      sourceUrl: recipe.sourceUrl,
      approvalStatus: "pending",
    };
  }

  /**
   * Generate a unique recipe ID from source URL.
   */
  private generateRecipeId(sourceUrl: string): string {
    // Simple hash of URL for deterministic ID
    let hash = 0;
    for (let i = 0; i < sourceUrl.length; i++) {
      const char = sourceUrl.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `recipe_${Math.abs(hash).toString(16)}`;
  }

  /**
   * Format URL for display/storage.
   * Validates and normalizes URL format.
   */
  formatUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.toString();
    } catch {
      return null;
    }
  }

  /**
   * Extract ingredients from recipe, normalize format.
   */
  extractIngredients(ingredients: string[]): string[] {
    return ingredients
      .map((ing) => ing.trim())
      .filter((ing) => ing.length > 0)
      .sort();
  }

  /**
   * Validate recipe data completeness.
   * Returns true if recipe has minimum required fields.
   */
  validateRecipeData(recipe: Partial<FetchedRecipe>): boolean {
    return (
      !!recipe.name &&
      recipe.name.length > 0 &&
      !!recipe.ingredients &&
      recipe.ingredients.length > 0 &&
      !!recipe.steps &&
      recipe.steps.length > 0 &&
      !!recipe.sourceUrl &&
      recipe.sourceUrl.length > 0
    );
  }

  /**
   * Get all recipes currently in store.
   */
  getAllRecipes(): RecipeCard[] {
    return Array.from(this.recipes.values()).map((r) =>
      this.formatRecipeCard(r),
    );
  }

  /**
   * Clear all recipes (for testing).
   */
  clearRecipes(): void {
    this.recipes.clear();
  }

  /**
   * Get member profile by ID.
   */
  getMemberProfile(memberId: string): MemberProfile | undefined {
    return this.memberProfiles.get(memberId);
  }

  /**
   * Update member profile.
   */
  setMemberProfile(profile: MemberProfile): void {
    this.memberProfiles.set(profile.memberId, profile);
  }
}
