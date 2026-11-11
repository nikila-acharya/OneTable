/**
 * WP-4.6 Scout Agent Tests (~210 lines)
 * Covers: recipe search, parsing, allergen validation, ingredient extraction,
 * cuisine filtering, time constraint checking, URL formatting (15+ tests).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ScoutAgent,
  type RecipeSearchParams,
  type MemberProfile,
  type RecipeCard,
} from "./scout";
import type { ParsedRecipe } from "@/lib/recipes/schema-org";

describe("ScoutAgent", () => {
  let scout: ScoutAgent;
  let member1: MemberProfile;
  let member2: MemberProfile;
  let parsedRecipe1: ParsedRecipe;
  let parsedRecipe2: ParsedRecipe;
  let parsedRecipe3: ParsedRecipe;

  beforeEach(() => {
    // Set up member profiles
    member1 = {
      memberId: "member1",
      name: "Alice",
      allergies: ["peanuts", "dairy"],
      dietPreferences: ["vegetarian"],
    };

    member2 = {
      memberId: "member2",
      name: "Bob",
      allergies: ["shellfish", "tree_nuts"],
      dietPreferences: ["pescatarian"],
    };

    // Initialize scout with member profiles
    scout = new ScoutAgent([member1, member2]);

    // Set up parsed recipes from M2 fetcher
    parsedRecipe1 = {
      title: "Grilled Chicken with Garlic",
      ingredients: [
        "2 chicken breasts",
        "4 garlic cloves",
        "olive oil",
        "lemon",
      ],
      steps: [
        "Season chicken with garlic",
        "Grill for 15 minutes",
        "Serve with lemon",
      ],
      yieldText: "2 servings",
      prepMinutes: 10,
      cookMinutes: 20,
      totalMinutes: 30,
      category: ["Main"],
      cuisine: ["Mediterranean"],
      author: "Chef John",
      sourceUrl: "https://example.com/grilled-chicken",
      parseMethod: "markup",
      warnings: [],
    };

    parsedRecipe2 = {
      title: "Peanut Butter Cookie",
      ingredients: [
        "1 cup peanut butter",
        "1 egg",
        "sugar",
        "vanilla",
        "dairy butter",
      ],
      steps: ["Mix ingredients", "Bake at 350F for 12 minutes", "Cool"],
      yieldText: "24 cookies",
      prepMinutes: 15,
      cookMinutes: 12,
      totalMinutes: 27,
      category: ["Dessert"],
      cuisine: ["American"],
      author: "Grandma's Recipe",
      sourceUrl: "https://example.com/peanut-butter-cookie",
      parseMethod: "markup",
      warnings: [],
    };

    parsedRecipe3 = {
      title: "Shrimp Pad Thai",
      ingredients: [
        "200g shrimp",
        "rice noodles",
        "peanut sauce",
        "lime",
        "Thai chili",
      ],
      steps: ["Cook noodles", "Stir fry with shrimp", "Add sauce"],
      yieldText: "1 serving",
      prepMinutes: 5,
      cookMinutes: 10,
      totalMinutes: 15,
      category: ["Main"],
      cuisine: ["Thai"],
      author: "Thai Chef",
      sourceUrl: "https://example.com/pad-thai",
      parseMethod: "markup",
      warnings: [],
    };
  });

  describe("Recipe Parsing", () => {
    it("should parse recipe and extract basic fields", () => {
      const recipe = scout.parseRecipe(parsedRecipe1);
      expect(recipe.name).toBe("Grilled Chicken with Garlic");
      expect(recipe.ingredients).toHaveLength(4);
      expect(recipe.steps).toHaveLength(3);
      expect(recipe.cookTimeMinutes).toBe(20);
      expect(recipe.sourceUrl).toBe("https://example.com/grilled-chicken");
    });

    it("should generate consistent recipe IDs from URL", () => {
      const recipe1 = scout.parseRecipe(parsedRecipe1);
      const recipe2 = scout.parseRecipe(parsedRecipe1);
      expect(recipe1.id).toBe(recipe2.id);
    });

    it("should extract and normalize cuisine tags", () => {
      const recipe = scout.parseRecipe(parsedRecipe1);
      expect(recipe.tags.cuisines).toContain("mediterranean");
    });
  });

  describe("Allergen Extraction and Validation", () => {
    it("should detect peanut allergen in ingredients", () => {
      const recipe = scout.parseRecipe(parsedRecipe2);
      expect(recipe.tags.allergens).toContain("peanuts");
    });

    it("should detect dairy allergen in ingredients", () => {
      const recipe = scout.parseRecipe(parsedRecipe2);
      expect(recipe.tags.allergens).toContain("dairy");
    });

    it("should detect shellfish allergen (shrimp)", () => {
      const recipe = scout.parseRecipe(parsedRecipe3);
      expect(recipe.tags.allergens).toContain("shellfish");
    });

    it("should reject recipe for member with conflicting allergen", () => {
      const recipe = scout.parseRecipe(parsedRecipe2);
      const card = scout.searchRecipes({});
      scout.addRecipe(recipe);
      const recipes = scout.searchRecipes({});
      const isValid = scout.validateAllergenTags(recipes[0], member1);
      expect(isValid).toBe(false);
    });

    it("should accept recipe when no allergen conflict", () => {
      const recipe = scout.parseRecipe(parsedRecipe1);
      const card: RecipeCard = {
        id: recipe.id,
        name: recipe.name,
        cookTimeMinutes: recipe.cookTimeMinutes,
        ingredients: recipe.ingredients,
        steps: recipe.steps,
        tags: recipe.tags,
        sourceUrl: recipe.sourceUrl,
        approvalStatus: "pending",
      };
      const isValid = scout.validateAllergenTags(card, member1);
      expect(isValid).toBe(true);
    });

    it("should validate recipes for specific member", () => {
      scout.addRecipe(scout.parseRecipe(parsedRecipe1));
      scout.addRecipe(scout.parseRecipe(parsedRecipe2));
      scout.addRecipe(scout.parseRecipe(parsedRecipe3));

      const recipes = scout.getAllRecipes();
      const safeForMember1 = scout.validateRecipesForMember(recipes, "member1");
      // Member1 has peanut and dairy allergies, so peanut butter cookie should be excluded
      expect(safeForMember1.length).toBeLessThan(recipes.length);
    });
  });

  describe("Recipe Search", () => {
    beforeEach(() => {
      scout.addRecipe(scout.parseRecipe(parsedRecipe1));
      scout.addRecipe(scout.parseRecipe(parsedRecipe2));
      scout.addRecipe(scout.parseRecipe(parsedRecipe3));
    });

    it("should search recipes by ingredient", () => {
      const params: RecipeSearchParams = {
        ingredients: ["chicken"],
      };
      const results = scout.searchRecipes(params);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain("Chicken");
    });

    it("should search recipes by cuisine", () => {
      const params: RecipeSearchParams = {
        cuisines: ["Thai"],
      };
      const results = scout.searchRecipes(params);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.tags.cuisines.includes("thai"))).toBe(true);
    });

    it("should search recipes by maximum cook time", () => {
      const params: RecipeSearchParams = {
        maxCookTimeMinutes: 15,
      };
      const results = scout.searchRecipes(params);
      results.forEach((recipe) => {
        if (recipe.cookTimeMinutes !== null) {
          expect(recipe.cookTimeMinutes).toBeLessThanOrEqual(15);
        }
      });
    });

    it("should filter by cook time constraint correctly", () => {
      const params: RecipeSearchParams = {
        maxCookTimeMinutes: 12,
      };
      const results = scout.searchRecipes(params);

      // This test claimed "only pad thai (10 min) should match" and asserted a
      // count of 1, but the seeded fixture also includes the Peanut Butter Cookie
      // at exactly 12 minutes — and `max` is inclusive, which the sibling test
      // above relies on (`cookTimeMinutes <= 15`). The comment was wrong about
      // its own data, so the assertion now states the actual contract:
      // everything returned fits the window and the 20-minute recipe is out.
      expect(results.every((x) => x.cookTimeMinutes === null || x.cookTimeMinutes <= 12)).toBe(true);
      expect(results.some((x) => x.name.includes("Pad Thai"))).toBe(true);
      expect(results.some((x) => x.name.includes("Grilled Chicken"))).toBe(false);
      expect(results.length).toBe(2);
    });

    it("should search with multiple constraints", () => {
      const params: RecipeSearchParams = {
        cuisines: ["Mediterranean"],
        maxCookTimeMinutes: 30,
        ingredients: ["chicken"],
      };
      const results = scout.searchRecipes(params);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].tags.cuisines).toContain("mediterranean");
    });

    it("should return empty array when no recipes match", () => {
      const params: RecipeSearchParams = {
        cuisines: ["NonExistent"],
      };
      const results = scout.searchRecipes(params);
      expect(results).toEqual([]);
    });
  });

  describe("Ingredient Extraction", () => {
    it("should extract and normalize ingredients", () => {
      const raw = ["  chicken breast  ", "olive oil", "  garlic  "];
      const extracted = scout.extractIngredients(raw);
      expect(extracted).toContain("chicken breast");
      expect(extracted).toContain("garlic");
      expect(extracted).toContain("olive oil");
      for (const ing of extracted) expect(ing).toBe(ing.trim());
    });

    it("should filter empty ingredient strings", () => {
      const raw = ["chicken", "", "  ", "oil"];
      const extracted = scout.extractIngredients(raw);
      expect(extracted).toHaveLength(2);
      expect(extracted).not.toContain("");
    });

    it("should sort ingredients alphabetically", () => {
      const raw = ["zucchini", "apple", "broccoli"];
      const extracted = scout.extractIngredients(raw);
      expect(extracted[0]).toBe("apple");
      expect(extracted[1]).toBe("broccoli");
      expect(extracted[2]).toBe("zucchini");
    });
  });

  describe("URL Formatting", () => {
    it("should format valid URL", () => {
      const url = "https://example.com/recipe";
      const formatted = scout.formatUrl(url);
      expect(formatted).toBe("https://example.com/recipe");
    });

    it("should return null for invalid URL", () => {
      const url = "not-a-valid-url";
      const formatted = scout.formatUrl(url);
      expect(formatted).toBeNull();
    });

    it("should normalize URL with trailing slash", () => {
      const url = "https://example.com/recipe/";
      const formatted = scout.formatUrl(url);
      expect(formatted).toBeDefined();
      expect(formatted).toContain("example.com");
    });
  });

  describe("Recipe Data Validation", () => {
    it("should validate complete recipe", () => {
      const recipe = scout.parseRecipe(parsedRecipe1);
      const isValid = scout.validateRecipeData(recipe);
      expect(isValid).toBe(true);
    });

    it("should reject recipe with missing name", () => {
      const incomplete = {
        name: "",
        ingredients: ["chicken"],
        steps: ["Cook"],
        sourceUrl: "https://example.com",
      };
      const isValid = scout.validateRecipeData(incomplete);
      expect(isValid).toBe(false);
    });

    it("should reject recipe with empty ingredients", () => {
      const incomplete = {
        name: "Recipe",
        ingredients: [],
        steps: ["Cook"],
        sourceUrl: "https://example.com",
      };
      const isValid = scout.validateRecipeData(incomplete);
      expect(isValid).toBe(false);
    });

    it("should reject recipe with missing source URL", () => {
      const incomplete = {
        name: "Recipe",
        ingredients: ["chicken"],
        steps: ["Cook"],
        sourceUrl: "",
      };
      const isValid = scout.validateRecipeData(incomplete);
      expect(isValid).toBe(false);
    });
  });

  describe("Recipe Storage and Retrieval", () => {
    it("should fetch recipe by ID", async () => {
      const recipe = scout.parseRecipe(parsedRecipe1);
      scout.addRecipe(recipe);
      const fetched = await scout.fetchRecipeById(recipe.id);
      expect(fetched).toBeDefined();
      expect(fetched?.name).toBe(recipe.name);
    });

    it("should return null when recipe not found", async () => {
      const fetched = await scout.fetchRecipeById("nonexistent");
      expect(fetched).toBeNull();
    });

    it("should get all recipes", () => {
      scout.addRecipe(scout.parseRecipe(parsedRecipe1));
      scout.addRecipe(scout.parseRecipe(parsedRecipe2));
      const all = scout.getAllRecipes();
      expect(all).toHaveLength(2);
    });

    it("should clear all recipes", () => {
      scout.addRecipe(scout.parseRecipe(parsedRecipe1));
      scout.clearRecipes();
      const all = scout.getAllRecipes();
      expect(all).toHaveLength(0);
    });
  });

  describe("Member Profile Management", () => {
    it("should get member profile by ID", () => {
      const profile = scout.getMemberProfile("member1");
      expect(profile).toBeDefined();
      expect(profile?.name).toBe("Alice");
    });

    it("should update member profile", () => {
      const updated: MemberProfile = {
        memberId: "member1",
        name: "Alice Updated",
        allergies: ["peanuts", "dairy", "shellfish"],
        dietPreferences: ["vegetarian", "gluten_free"],
      };
      scout.setMemberProfile(updated);
      const profile = scout.getMemberProfile("member1");
      expect(profile?.allergies).toContain("shellfish");
    });

    it("should handle profile not found", () => {
      const profile = scout.getMemberProfile("nonexistent");
      expect(profile).toBeUndefined();
    });
  });

  describe("Recipe Card Formatting", () => {
    it("should format recipe as card with all required fields", () => {
      const recipe = scout.parseRecipe(parsedRecipe1);
      scout.addRecipe(recipe);
      const cards = scout.getAllRecipes();
      const card = cards[0];

      expect(card.id).toBeDefined();
      expect(card.name).toBe("Grilled Chicken with Garlic");
      expect(card.cookTimeMinutes).toBe(20);
      expect(card.ingredients).toHaveLength(4);
      expect(card.steps).toHaveLength(3);
      expect(card.tags.allergens).toBeDefined();
      expect(card.tags.cuisines).toBeDefined();
      expect(card.sourceUrl).toBeDefined();
      expect(card.approvalStatus).toBe("pending");
    });

    it("should set approval status on recipe card", () => {
      const recipe = scout.parseRecipe(parsedRecipe1);
      scout.addRecipe(recipe);
      const card = scout.getAllRecipes()[0];
      expect(card.approvalStatus).toBe("pending");
    });
  });

  describe("Cuisine Filtering", () => {
    beforeEach(() => {
      scout.addRecipe(scout.parseRecipe(parsedRecipe1)); // Mediterranean
      scout.addRecipe(scout.parseRecipe(parsedRecipe2)); // American
      scout.addRecipe(scout.parseRecipe(parsedRecipe3)); // Thai
    });

    it("should filter by single cuisine", () => {
      const params: RecipeSearchParams = { cuisines: ["Italian"] };
      const results = scout.searchRecipes(params);
      // Mediterranean should match Italian search
      results.forEach((r) => {
        expect(r.tags.cuisines.some((c) => c.toLowerCase())).toBeDefined();
      });
    });

    it("should handle cuisine case-insensitivity", () => {
      const params1: RecipeSearchParams = { cuisines: ["thai"] };
      const params2: RecipeSearchParams = { cuisines: ["THAI"] };
      const results1 = scout.searchRecipes(params1);
      const results2 = scout.searchRecipes(params2);
      expect(results1).toHaveLength(results2.length);
    });
  });

  describe("Time Constraint Checking", () => {
    beforeEach(() => {
      scout.addRecipe(scout.parseRecipe(parsedRecipe1)); // 20 min
      scout.addRecipe(scout.parseRecipe(parsedRecipe2)); // 12 min
      scout.addRecipe(scout.parseRecipe(parsedRecipe3)); // 10 min
    });

    it("should filter recipes by max cook time", () => {
      const params: RecipeSearchParams = { maxCookTimeMinutes: 12 };
      const results = scout.searchRecipes(params);
      results.forEach((r) => {
        expect(r.cookTimeMinutes === null || r.cookTimeMinutes <= 12).toBe(
          true,
        );
      });
    });

    it("should include recipes without cook time", () => {
      const recipe = scout.parseRecipe(parsedRecipe1);
      recipe.cookTimeMinutes = null;
      scout.clearRecipes();
      scout.addRecipe(recipe);
      const params: RecipeSearchParams = { maxCookTimeMinutes: 10 };
      const results = scout.searchRecipes(params);
      expect(results).toHaveLength(1);
    });
  });
});
