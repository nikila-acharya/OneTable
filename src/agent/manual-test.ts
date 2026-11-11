/**
 * Manual validation of MealPlannerAgent and planner tools
 * Run with: npx tsx src/agent/manual-test.ts
 */

import { MealPlannerAgent, type MemberProfile, type PlanRequest } from "./meal-planner";
import { createPlan, lock, swap, regenerate, getLockedMeals, getOwnSourceMeals } from "@/lib/planner";

const test = async () => {
  console.log("=== WP-4.5 MealPlanner Agent Test Suite ===\n");

  let passed = 0;
  let failed = 0;

  // Test 1: Basic plan creation
  try {
    const agent = new MealPlannerAgent();
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
    if (response.success && response.planId && response.meals) {
      console.log("✓ Test 1: Basic plan creation");
      passed++;
    } else {
      console.log("✗ Test 1: Basic plan creation failed");
      failed++;
    }
  } catch (e) {
    console.log(`✗ Test 1 error: ${e}`);
    failed++;
  }

  // Test 2: Deterministic generation
  try {
    const agent1 = new MealPlannerAgent();
    const agent2 = new MealPlannerAgent();
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

    const request: PlanRequest = {
      requestType: "plan",
      memberIds: ["m1"],
      memberProfiles: profiles,
      startDate: "2026-11-03",
      planDays: 5,
      seed: 999,
    };

    await agent1.draftPlan(request);
    await agent2.draftPlan(request);

    const plan1 = agent1.getCurrentPlan();
    const plan2 = agent2.getCurrentPlan();

    if (
      plan1 &&
      plan2 &&
      plan1.meals.map((m) => m.recipe.id).join(",") ===
        plan2.meals.map((m) => m.recipe.id).join(",")
    ) {
      console.log("✓ Test 2: Deterministic generation (same seed)");
      passed++;
    } else {
      console.log("✗ Test 2: Deterministic generation failed");
      failed++;
    }
  } catch (e) {
    console.log(`✗ Test 2 error: ${e}`);
    failed++;
  }

  // Test 3: Allergen filtering
  try {
    const agent = new MealPlannerAgent();
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
    const glutenOrDairyMeals = response.meals?.filter(
      (m) =>
        m.recipe.allergens.includes("gluten") ||
        m.recipe.allergens.includes("dairy"),
    ) || [];

    if (response.success && glutenOrDairyMeals.length === 0) {
      console.log("✓ Test 3: Allergen filtering");
      passed++;
    } else {
      console.log(
        `✗ Test 3: Allergen filtering failed (found ${glutenOrDairyMeals.length} allergen conflicts)`,
      );
      failed++;
    }
  } catch (e) {
    console.log(`✗ Test 3 error: ${e}`);
    failed++;
  }

  // Test 4: Lock/Unlock operations
  try {
    const agent = new MealPlannerAgent();
    const profiles: MemberProfile[] = [
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

    const request: PlanRequest = {
      requestType: "plan",
      memberIds: ["m1"],
      memberProfiles: profiles,
      startDate: "2026-11-03",
      planDays: 7,
      seed: 5555,
    };

    await agent.draftPlan(request);
    const plan = agent.getCurrentPlan();
    const firstMeal = plan!.meals[0]!;

    await agent.applyLockMeal(firstMeal.date, firstMeal.mealType);
    const lockedPlan = agent.getCurrentPlan();
    const lockedMeal = lockedPlan!.meals.find(
      (m) => m.date === firstMeal.date && m.mealType === firstMeal.mealType,
    );

    if (lockedMeal?.locked === true) {
      console.log("✓ Test 4: Lock/Unlock operations");
      passed++;
    } else {
      console.log("✗ Test 4: Lock/Unlock operations failed");
      failed++;
    }
  } catch (e) {
    console.log(`✗ Test 4 error: ${e}`);
    failed++;
  }

  // Test 5: Swap operations
  try {
    const agent = new MealPlannerAgent();
    const profiles: MemberProfile[] = [
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

    const request: PlanRequest = {
      requestType: "plan",
      memberIds: ["m1"],
      memberProfiles: profiles,
      startDate: "2026-11-03",
      planDays: 7,
      seed: 5555,
    };

    await agent.draftPlan(request);
    const plan = agent.getCurrentPlan();
    const targetMeal = plan!.meals.find((m) => m.mealType === "breakfast");

    const newRecipe = {
      id: "recipe-custom-001",
      name: "Scrambled Eggs with Toast",
      servings: 1,
      prepMinutes: 5,
      cookMinutes: 5,
      ingredients: ["eggs", "bread", "butter"],
      caloriesPerServing: 350,
      allergens: [] as string[],
      isOwnSource: false,
    };

    const swapResp = await agent.swapMeal(
      targetMeal!.date,
      targetMeal!.mealType,
      newRecipe,
    );

    if (swapResp.success) {
      console.log("✓ Test 5: Swap operations");
      passed++;
    } else {
      console.log("✗ Test 5: Swap operations failed");
      failed++;
    }
  } catch (e) {
    console.log(`✗ Test 5 error: ${e}`);
    failed++;
  }

  // Test 6: Regenerate with locked meals
  try {
    const agent = new MealPlannerAgent();
    const profiles: MemberProfile[] = [
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

    const request: PlanRequest = {
      requestType: "plan",
      memberIds: ["m1"],
      memberProfiles: profiles,
      startDate: "2026-11-03",
      planDays: 7,
      seed: 6666,
    };

    await agent.draftPlan(request);
    const plan = agent.getCurrentPlan();
    const firstMeal = plan!.meals[0]!;
    const originalRecipeId = firstMeal.recipe.id;

    await agent.applyLockMeal(firstMeal.date, firstMeal.mealType);
    await agent.regeneratePlan();

    const regeneratedPlan = agent.getCurrentPlan();
    const lockedMealAfter = regeneratedPlan!.meals.find(
      (m) => m.date === firstMeal.date && m.mealType === firstMeal.mealType,
    );

    if (
      lockedMealAfter?.locked === true &&
      lockedMealAfter?.recipe.id === originalRecipeId
    ) {
      console.log("✓ Test 6: Regenerate with locked meals");
      passed++;
    } else {
      console.log("✗ Test 6: Regenerate with locked meals failed");
      failed++;
    }
  } catch (e) {
    console.log(`✗ Test 6 error: ${e}`);
    failed++;
  }

  // Test 7: Own-source verification
  try {
    const agent = new MealPlannerAgent();
    const profiles: MemberProfile[] = [
      {
        memberId: "m1",
        name: "Ana",
        age: 35,
        activity: "moderate",
        allergies: [],
        conditions: ["diabetes"],
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

    if (verification.totalDinners === 7) {
      console.log("✓ Test 7: Own-source verification");
      passed++;
    } else {
      console.log("✗ Test 7: Own-source verification failed");
      failed++;
    }
  } catch (e) {
    console.log(`✗ Test 7 error: ${e}`);
    failed++;
  }

  // Test 8: Plan summary
  try {
    const agent = new MealPlannerAgent();
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
    const summary = agent.getPlanSummary();

    if (
      summary &&
      summary.mealCount === 15 &&
      summary.dayCount === 5 &&
      summary.totalEnergy > 0
    ) {
      console.log("✓ Test 8: Plan summary");
      passed++;
    } else {
      console.log("✗ Test 8: Plan summary failed");
      failed++;
    }
  } catch (e) {
    console.log(`✗ Test 8 error: ${e}`);
    failed++;
  }

  // Test 9: Multiple members with overlapping allergens
  try {
    const agent = new MealPlannerAgent();
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
    const glutenOrDairyMeals = response.meals?.filter(
      (m) =>
        m.recipe.allergens.includes("gluten") ||
        m.recipe.allergens.includes("dairy"),
    ) || [];

    if (response.success && glutenOrDairyMeals.length === 0) {
      console.log("✓ Test 9: Multiple members with overlapping allergens");
      passed++;
    } else {
      console.log(
        `✗ Test 9: Multiple members failed (found ${glutenOrDairyMeals.length} conflicts)`,
      );
      failed++;
    }
  } catch (e) {
    console.log(`✗ Test 9 error: ${e}`);
    failed++;
  }

  // Test 10: Invalid plan duration
  try {
    const agent = new MealPlannerAgent();
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
      planDays: 0,
      seed: 123,
    };

    const response = await agent.draftPlan(request);

    if (!response.success && response.error) {
      console.log("✓ Test 10: Invalid plan duration rejection");
      passed++;
    } else {
      console.log("✗ Test 10: Invalid plan duration rejection failed");
      failed++;
    }
  } catch (e) {
    console.log(`✗ Test 10 error: ${e}`);
    failed++;
  }

  console.log(`\n=== Test Summary ===`);
  console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Pass Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);

  process.exit(failed > 0 ? 1 : 0);
};

test().catch(console.error);
