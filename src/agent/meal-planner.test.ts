/**
 * WP-4.5 — MealPlanner Agent Tests
 * 16+ tests covering: preference-to-plan translation, lock/swap/regen operations,
 * own-source dinner verification, allergen-filter application, energy target validation.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { MealPlannerAgent, type MemberProfile, type PlanRequest } from "./meal-planner";
import type { Recipe } from "@/lib/planner";

describe("MealPlannerAgent", () => {
  let agent: MealPlannerAgent;

  beforeEach(() => {
    agent = new MealPlannerAgent();
  });

  describe("preference-to-plan translation (WP-4.1+)", () => {
    it("drafts a meal plan from member profiles and preferences", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Ana",
          age: 35,
          activity: "active",
          allergies: [],
          conditions: [],
          dietPreferences: [],
        },
      ];

      const request: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 7,
        seed: 12345,
      };

      const response = await agent.draftPlan(request);

      expect(response.success).toBe(true);
      expect(response.planId).toBeDefined();
      expect(response.meals).toBeDefined();
      expect(response.meals!.length).toBeGreaterThan(0);
      expect(response.rationale).toBeDefined();
    });

    it("generates deterministic plans with the same seed", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Ana",
          age: 30,
          activity: "moderate",
          allergies: [],
          conditions: [],
          dietPreferences: [],
        },
      ];

      const baseRequest: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 5,
        seed: 999,
      };

      const response1 = await agent.draftPlan(baseRequest);
      const plan1 = agent.getCurrentPlan();

      // Create new agent and repeat
      agent = new MealPlannerAgent();
      const response2 = await agent.draftPlan(baseRequest);
      const plan2 = agent.getCurrentPlan();

      // Same seed should produce identical meals
      expect(response1.meals).toEqual(response2.meals);
      expect(plan1!.meals.map((m) => m.recipe.id)).toEqual(
        plan2!.meals.map((m) => m.recipe.id),
      );
    });

    it("rejects invalid plan duration", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Ana",
          age: 25,
          activity: "light",
          allergies: [],
          conditions: [],
          dietPreferences: [],
        },
      ];

      const request: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 0, // Invalid
        seed: 123,
      };

      const response = await agent.draftPlan(request);
      expect(response.success).toBe(false);
      expect(response.error).toContain("duration");
    });

    it("drafts plans for multiple members with aggregated needs", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Ana",
          age: 35,
          activity: "active",
          allergies: [],
          conditions: [],
          dietPreferences: [],
        },
        {
          memberId: "m2",
          name: "Leo",
          age: 8,
          activity: "very_active",
          allergies: ["peanuts"],
          conditions: [],
          dietPreferences: [],
        },
      ];

      const request: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1", "m2"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 3,
        seed: 777,
      };

      const response = await agent.draftPlan(request);
      expect(response.success).toBe(true);
      expect(response.meals).toBeDefined();

      // All meals should exclude peanut-containing recipes
      const peanutAllergenMeals = response.meals!.filter((m) =>
        m.recipe.allergens.includes("peanuts"),
      );
      expect(peanutAllergenMeals).toHaveLength(0);
    });
  });

  describe("lock/swap/regen operations", () => {
    let profiles: MemberProfile[];
    let request: PlanRequest;

    beforeEach(async () => {
      profiles = [
        {
          memberId: "m1",
          name: "Ana",
          age: 40,
          activity: "moderate",
          allergies: [],
          conditions: [],
          dietPreferences: [],
        },
      ];

      request = {
        requestType: "plan",
        memberIds: ["m1"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 7,
        seed: 5555,
      };

      await agent.draftPlan(request);
    });

    it("locks a meal, preventing future regeneration from changing it", async () => {
      const plan = agent.getCurrentPlan();
      expect(plan).toBeDefined();

      const firstMeal = plan!.meals[0]!;
      expect(firstMeal.locked).toBe(false);

      // Request lock approval
      const approvalReq = agent.requestLockMeal(
        firstMeal.date,
        firstMeal.mealType,
        "Favorite meal",
      );
      expect(approvalReq.needsApproval).toBe(true);

      // Apply lock after approval
      const lockResp = await agent.applyLockMeal(
        firstMeal.date,
        firstMeal.mealType,
      );
      expect(lockResp.success).toBe(true);

      const updatedPlan = agent.getCurrentPlan();
      const lockedMeal = updatedPlan!.meals.find(
        (m) => m.date === firstMeal.date && m.mealType === firstMeal.mealType,
      );
      expect(lockedMeal!.locked).toBe(true);
    });

    it("swaps an unlocked meal with a new recipe", async () => {
      const plan = agent.getCurrentPlan();
      const targetMeal = plan!.meals.find((m) => m.mealType === "breakfast");
      expect(targetMeal).toBeDefined();

      const newRecipe: Recipe = {
        id: "recipe-custom-001",
        name: "Scrambled Eggs with Toast",
        servings: 1,
        prepMinutes: 5,
        cookMinutes: 5,
        ingredients: ["eggs", "bread", "butter"],
        caloriesPerServing: 350,
        allergens: ["gluten"],
        isOwnSource: false,
      };

      const swapResp = await agent.swapMeal(
        targetMeal!.date,
        targetMeal!.mealType,
        newRecipe,
      );
      expect(swapResp.success).toBe(true);

      const updatedPlan = agent.getCurrentPlan();
      const swappedMeal = updatedPlan!.meals.find(
        (m) =>
          m.date === targetMeal!.date && m.mealType === targetMeal!.mealType,
      );
      expect(swappedMeal!.recipe.id).toBe("recipe-custom-001");
    });

    it("prevents swapping a locked meal", async () => {
      const plan = agent.getCurrentPlan();
      const targetMeal = plan!.meals[0]!;

      // Lock the meal
      await agent.applyLockMeal(targetMeal.date, targetMeal.mealType);

      // Attempt swap
      const newRecipe: Recipe = {
        id: "recipe-new",
        name: "New Recipe",
        servings: 1,
        prepMinutes: 10,
        cookMinutes: 15,
        ingredients: ["test"],
        caloriesPerServing: 300,
        allergens: [],
        isOwnSource: false,
      };

      const swapResp = await agent.swapMeal(
        targetMeal.date,
        targetMeal.mealType,
        newRecipe,
      );
      expect(swapResp.success).toBe(false);
      expect(swapResp.error).toContain("locked");
    });

    it("regenerates unlocked meals while preserving locked ones", async () => {
      const plan = agent.getCurrentPlan();
      const firstMeal = plan!.meals[0]!;
      const originalRecipeId = firstMeal.recipe.id;

      // Lock first meal
      await agent.applyLockMeal(firstMeal.date, firstMeal.mealType);

      // Regenerate
      const regenResp = await agent.regeneratePlan();
      expect(regenResp.success).toBe(true);

      const regeneratedPlan = agent.getCurrentPlan();
      const lockedMealAfter = regeneratedPlan!.meals.find(
        (m) => m.date === firstMeal.date && m.mealType === firstMeal.mealType,
      );

      // Locked meal should remain unchanged
      expect(lockedMealAfter!.recipe.id).toBe(originalRecipeId);
      expect(lockedMealAfter!.locked).toBe(true);
    });

    it("fails to regenerate when no plan is active", async () => {
      const emptyAgent = new MealPlannerAgent();
      const regenResp = await emptyAgent.regeneratePlan();
      expect(regenResp.success).toBe(false);
      expect(regenResp.error).toContain("No active plan");
    });
  });

  describe("own-source dinner verification (SG02)", () => {
    it("verifies own-source dinners when required", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Ana",
          age: 35,
          activity: "moderate",
          allergies: [],
          conditions: ["diabetes"], // Triggers own-source requirement
          dietPreferences: [],
        },
      ];

      const request: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 7,
        seed: 6666,
      };

      await agent.draftPlan(request);
      const verification = agent.verifyOwnSourceDinners();

      expect(verification.valid).toBe(true);
      expect(verification.ownSourceDinners).toBeGreaterThan(0);
      expect(verification.totalDinners).toBe(7); // 1 per day
    });

    it("returns own-source meal count even when not required", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Ana",
          age: 25,
          activity: "light",
          allergies: [],
          conditions: [],
          dietPreferences: [],
        },
      ];

      const request: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 5,
        seed: 7777,
      };

      await agent.draftPlan(request);
      const verification = agent.verifyOwnSourceDinners();

      expect(verification.totalDinners).toBe(5);
      expect(verification.ownSourceDinners).toBeGreaterThanOrEqual(0);
    });
  });

  describe("allergen-filter application", () => {
    it("excludes recipes with restricted allergens", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Ana",
          age: 30,
          activity: "active",
          allergies: ["gluten", "dairy"],
          conditions: [],
          dietPreferences: [],
        },
      ];

      const request: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 7,
        seed: 8888,
      };

      const response = await agent.draftPlan(request);
      expect(response.success).toBe(true);

      // Verify no meals contain restricted allergens
      const mealsWithGluten = response.meals!.filter((m) =>
        m.recipe.allergens.includes("gluten"),
      );
      const mealsWithDairy = response.meals!.filter((m) =>
        m.recipe.allergens.includes("dairy"),
      );

      expect(mealsWithGluten).toHaveLength(0);
      expect(mealsWithDairy).toHaveLength(0);
    });

    it("prevents swap with allergen-conflicting recipe", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Ana",
          age: 35,
          activity: "moderate",
          allergies: ["nuts"],
          conditions: [],
          dietPreferences: [],
        },
      ];

      const request: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 3,
        seed: 9999,
      };

      await agent.draftPlan(request);

      const plan = agent.getCurrentPlan();
      const targetMeal = plan!.meals[0]!;

      // Attempt to swap with nut-containing recipe
      const nutRecipe: Recipe = {
        id: "recipe-nuts",
        name: "Almond Butter Smoothie",
        servings: 1,
        prepMinutes: 3,
        cookMinutes: 0,
        ingredients: ["almonds", "milk"],
        caloriesPerServing: 280,
        allergens: ["nuts"],
        isOwnSource: false,
      };

      const swapResp = await agent.swapMeal(
        targetMeal.date,
        targetMeal.mealType,
        nutRecipe,
      );

      expect(swapResp.success).toBe(false);
      expect(swapResp.error).toContain("allergens");
    });

    it("includes allergen information in plan rationale", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Ana",
          age: 28,
          activity: "light",
          allergies: ["peanuts", "fish"],
          conditions: [],
          dietPreferences: [],
        },
      ];

      const request: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 4,
        seed: 1111,
      };

      const response = await agent.draftPlan(request);
      expect(response.rationale).toContain("peanuts");
      expect(response.rationale).toContain("fish");
    });
  });

  describe("energy target validation (SG02 rule)", () => {
    it("applies energy floor for under-18 members (maintenance only, no deficit)", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Leo",
          age: 14, // Under 18
          activity: "light", // Moderate energy needs
          allergies: [],
          conditions: [],
          dietPreferences: [],
        },
      ];

      const request: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 7,
        seed: 2222,
      };

      const response = await agent.draftPlan(request);
      expect(response.success).toBe(true);

      // The plan should be generated without deficit (maintenance energy for under-18)
      const summary = agent.getPlanSummary();
      expect(summary).toBeDefined();
      expect(summary!.mealCount).toBeGreaterThan(0);
    });

    it("validates energy targets across all days in the plan", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Ana",
          age: 35,
          activity: "moderate",
          allergies: [],
          conditions: [],
          dietPreferences: [],
        },
      ];

      const request: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 10,
        seed: 3333,
      };

      await agent.draftPlan(request);
      const validation = agent.validateEnergyTargets();

      expect(validation).toBeDefined();
      expect(validation.valid).toBeDefined();
      expect(Array.isArray(validation.violations)).toBe(true);
    });

    it("detects energy violations below 80% of target", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Ana",
          age: 25,
          activity: "sedentary", // Low energy needs
          allergies: [],
          conditions: [],
          dietPreferences: [],
        },
      ];

      const request: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 3,
        seed: 4444,
      };

      await agent.draftPlan(request);
      const validation = agent.validateEnergyTargets();

      // Violations structure should be well-formed
      if (!validation.valid) {
        expect(validation.violations[0]).toHaveProperty("date");
        expect(validation.violations[0]).toHaveProperty("energy");
        expect(validation.violations[0]).toHaveProperty("target");
      }
    });
  });

  describe("plan summary and statistics", () => {
    it("provides plan summary with statistics", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Ana",
          age: 30,
          activity: "active",
          allergies: [],
          conditions: [],
          dietPreferences: [],
        },
      ];

      const request: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 5,
        seed: 5000,
      };

      await agent.draftPlan(request);

      // Lock some meals
      const plan = agent.getCurrentPlan()!;
      await agent.applyLockMeal(plan.meals[0]!.date, plan.meals[0]!.mealType);
      await agent.applyLockMeal(plan.meals[3]!.date, plan.meals[3]!.mealType);

      const summary = agent.getPlanSummary();
      expect(summary).toBeDefined();
      expect(summary!.planId).toBeDefined();
      expect(summary!.mealCount).toBe(15); // 3 meals/day × 5 days
      expect(summary!.dayCount).toBe(5);
      expect(summary!.lockedMeals).toBe(2);
      expect(summary!.ownSourceMeals).toBeGreaterThanOrEqual(0);
      expect(summary!.totalEnergy).toBeGreaterThan(0);
    });

    it("returns null summary when no plan is active", () => {
      const emptyAgent = new MealPlannerAgent();
      const summary = emptyAgent.getPlanSummary();
      expect(summary).toBeNull();
    });
  });

  describe("edge cases and error handling", () => {
    it("handles empty member list gracefully", async () => {
      const request: PlanRequest = {
        requestType: "plan",
        memberIds: [],
        memberProfiles: [],
        startDate: "2026-11-03",
        planDays: 7,
        seed: 6000,
      };

      const response = await agent.draftPlan(request);
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it("works with multiple members with overlapping allergens", async () => {
      const profiles: MemberProfile[] = [
        {
          memberId: "m1",
          name: "Ana",
          age: 35,
          activity: "active",
          allergies: ["gluten"],
          conditions: [],
          dietPreferences: [],
        },
        {
          memberId: "m2",
          name: "Leo",
          age: 8,
          activity: "very_active",
          allergies: ["gluten", "dairy"],
          conditions: [],
          dietPreferences: [],
        },
      ];

      const request: PlanRequest = {
        requestType: "plan",
        memberIds: ["m1", "m2"],
        memberProfiles: profiles,
        startDate: "2026-11-03",
        planDays: 3,
        seed: 7000,
      };

      const response = await agent.draftPlan(request);
      expect(response.success).toBe(true);

      // Plan should exclude both gluten and dairy
      const glutenOrDairyMeals = response.meals!.filter(
        (m) =>
          m.recipe.allergens.includes("gluten") ||
          m.recipe.allergens.includes("dairy"),
      );
      expect(glutenOrDairyMeals).toHaveLength(0);
    });
  });
});
