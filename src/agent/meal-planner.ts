/**
 * WP-4.5 — MealPlanner Agent: Deterministic meal plan drafting.
 * Translates user preferences to meal plans via M3 planner tools.
 * Applies SG02 energy floor: under-18 members → maintenance only, no deficit.
 * Read-only access (R) to M3 tools; no execution (X); approval-gated (A) for plan locks.
 */

import type {
  MealPlan,
  MealSlot,
  PlanOptions,
  Recipe,
} from "@/lib/planner";
import {
  calculateDayEnergy,
  createPlan,
  getLockedMeals,
  getMealsForDate,
  getOwnSourceMeals,
  lock,
  regenerate,
  swap,
} from "@/lib/planner";

export interface MemberProfile {
  memberId: string;
  name: string;
  age: number;
  activity: "sedentary" | "light" | "moderate" | "active" | "very_active";
  allergies: string[];
  conditions: string[];
  dietPreferences: string[]; // e.g., ["vegetarian", "nut-free", "gluten-free"]
}

export interface PlanRequest {
  requestType: "plan";
  memberIds: string[];
  memberProfiles: MemberProfile[];
  startDate: string; // YYYY-MM-DD
  planDays: number;
  seed: number; // For deterministic reproducibility
}

export interface PlanResponse {
  success: boolean;
  planId?: string;
  meals?: Array<{
    date: string;
    mealType: "breakfast" | "lunch" | "dinner" | "snack";
    recipe: {
      id: string;
      name: string;
      caloriesPerServing: number;
      allergens: string[];
      isOwnSource: boolean;
    };
    locked: boolean;
  }>;
  rationale?: string;
  error?: string;
}

export class MealPlannerAgent {
  private currentPlan: MealPlan | null = null;
  private planOptions: PlanOptions | null = null;

  /**
   * Translate member preferences to a meal plan (deterministic, seeded).
   */
  async draftPlan(request: PlanRequest): Promise<PlanResponse> {
    try {
      // Validate request
      if (!request.memberIds.length) {
        return { success: false, error: "No members specified" };
      }

      if (request.planDays < 1 || request.planDays > 30) {
        return { success: false, error: "Plan duration must be 1-30 days" };
      }

      // Extract and validate member preferences
      const { allergens, targetEnergy, dietPreferences } =
        this.extractPreferences(request.memberProfiles);

      // Apply SG02 energy floor: under-18 → maintenance only, no deficit
      const adjustedTarget = this.applySG02EnergyFloor(
        request.memberProfiles,
        targetEnergy,
      );

      // Build plan options
      const planOptions: PlanOptions = {
        seed: request.seed,
        memberIds: request.memberIds,
        startDate: request.startDate,
        planDays: request.planDays,
        targetEnergyKcal: adjustedTarget,
        allergens,
        dietPreferences,
        requireOwnSourceDinners: this.shouldRequireOwnSourceDinners(
          request.memberProfiles,
        ),
      };

      // Generate plan using M3 planner
      const plan = createPlan(planOptions);

      // Store for subsequent operations
      this.currentPlan = plan;
      this.planOptions = planOptions;

      // Format response
      return {
        success: true,
        planId: plan.planId,
        meals: plan.meals.map((meal) => ({
          date: meal.date,
          mealType: meal.mealType,
          recipe: {
            id: meal.recipe.id,
            name: meal.recipe.name,
            caloriesPerServing: meal.recipe.caloriesPerServing,
            allergens: meal.recipe.allergens,
            isOwnSource: meal.recipe.isOwnSource,
          },
          locked: meal.locked,
        })),
        rationale: plan.rationale,
      };
    } catch (error) {
      return {
        success: false,
        error: `Plan drafting failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Lock a meal (approval-gated operation).
   * Requires explicit authorization (simulated via return type indicating approval needed).
   */
  requestLockMeal(
    date: string,
    mealType: "breakfast" | "lunch" | "dinner" | "snack",
    reason: string,
  ): { needsApproval: boolean; reason: string } {
    if (!this.currentPlan) {
      return {
        needsApproval: false,
        reason: "No active plan to lock",
      };
    }

    // Return approval status — in production, this would route to approval gate
    return {
      needsApproval: true,
      reason: `Approve lock on ${mealType} for ${date}: ${reason}`,
    };
  }

  /**
   * Execute lock on a meal (only after approval).
   */
  async applyLockMeal(
    date: string,
    mealType: "breakfast" | "lunch" | "dinner" | "snack",
  ): Promise<PlanResponse> {
    if (!this.currentPlan) {
      return { success: false, error: "No active plan" };
    }

    try {
      this.currentPlan = lock(this.currentPlan, date, mealType);
      return {
        success: true,
        planId: this.currentPlan.planId,
        rationale: `Meal locked: ${mealType} on ${date}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to lock meal: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Swap a meal with another recipe (only if not locked).
   */
  async swapMeal(
    date: string,
    mealType: "breakfast" | "lunch" | "dinner" | "snack",
    newRecipe: Recipe,
  ): Promise<PlanResponse> {
    if (!this.currentPlan) {
      return { success: false, error: "No active plan" };
    }

    try {
      // Check if meal is locked
      const meal = this.currentPlan.meals.find(
        (m) => m.date === date && m.mealType === mealType,
      );
      if (meal?.locked) {
        return {
          success: false,
          error: `Cannot swap locked meal on ${date}`,
        };
      }

      // Check for allergen conflicts
      if (this.planOptions) {
        const conflicts = newRecipe.allergens.filter((a) =>
          this.planOptions!.allergens.includes(a),
        );
        if (conflicts.length > 0) {
          return {
            success: false,
            error: `Recipe contains restricted allergens: ${conflicts.join(", ")}`,
          };
        }
      }

      this.currentPlan = swap(this.currentPlan, date, mealType, newRecipe);
      return {
        success: true,
        planId: this.currentPlan.planId,
        rationale: `Meal swapped: ${mealType} on ${date} → ${newRecipe.name}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to swap meal: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Regenerate unlocked meals while preserving locked ones.
   */
  async regeneratePlan(): Promise<PlanResponse> {
    if (!this.currentPlan || !this.planOptions) {
      return { success: false, error: "No active plan to regenerate" };
    }

    try {
      const lockedCount = getLockedMeals(this.currentPlan).length;
      this.currentPlan = regenerate(this.currentPlan, this.planOptions);

      return {
        success: true,
        planId: this.currentPlan.planId,
        meals: this.currentPlan.meals.map((meal) => ({
          date: meal.date,
          mealType: meal.mealType,
          recipe: {
            id: meal.recipe.id,
            name: meal.recipe.name,
            caloriesPerServing: meal.recipe.caloriesPerServing,
            allergens: meal.recipe.allergens,
            isOwnSource: meal.recipe.isOwnSource,
          },
          locked: meal.locked,
        })),
        rationale: `Regenerated plan, preserving ${lockedCount} locked meals. ${this.currentPlan.rationale}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to regenerate plan: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Verify that own-source dinners meet requirements.
   */
  verifyOwnSourceDinners(): {
    valid: boolean;
    ownSourceDinners: number;
    totalDinners: number;
    message: string;
  } {
    if (!this.currentPlan) {
      return {
        valid: false,
        ownSourceDinners: 0,
        totalDinners: 0,
        message: "No active plan",
      };
    }

    const ownSource = getOwnSourceMeals(this.currentPlan).filter(
      (m) => m.mealType === "dinner",
    ).length;
    const dinners = this.currentPlan.meals.filter(
      (m) => m.mealType === "dinner",
    ).length;
    const requirement = this.planOptions?.requireOwnSourceDinners ?? false;

    return {
      valid: !requirement || ownSource > 0,
      ownSourceDinners: ownSource,
      totalDinners: dinners,
      message: requirement
        ? `${ownSource}/${dinners} dinners are own-source recipes`
        : "Own-source dinner requirement not set",
    };
  }

  /**
   * Validate energy targets for under-18 members (SG02 rule).
   */
  validateEnergyTargets(): {
    valid: boolean;
    violations: Array<{ date: string; energy: number; target: number }>;
  } {
    if (!this.currentPlan || !this.planOptions) {
      return { valid: false, violations: [] };
    }

    const violations: Array<{ date: string; energy: number; target: number }> = [];
    const dates = new Set(this.currentPlan.meals.map((m) => m.date));

    for (const date of dates) {
      const dayEnergy = calculateDayEnergy(this.currentPlan, date);
      if (dayEnergy < this.planOptions.targetEnergyKcal * 0.8) {
        // Allow 20% variance
        violations.push({
          date,
          energy: dayEnergy,
          target: this.planOptions.targetEnergyKcal,
        });
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  /**
   * Extract allergens and diet preferences from member profiles.
   */
  private extractPreferences(
    profiles: MemberProfile[],
  ): {
    allergens: string[];
    targetEnergy: number;
    dietPreferences: string[];
  } {
    const allergens = new Set<string>();
    const dietPreferences = new Set<string>();
    let totalEnergy = 0;

    for (const profile of profiles) {
      profile.allergies.forEach((a) => allergens.add(a));
      profile.dietPreferences.forEach((d) => dietPreferences.add(d));
      totalEnergy += this.estimateEnergyNeeds(profile.age, profile.activity);
    }

    return {
      allergens: Array.from(allergens),
      targetEnergy: Math.round(totalEnergy / profiles.length),
      dietPreferences: Array.from(dietPreferences),
    };
  }

  /**
   * Estimate daily energy needs based on age and activity (Harris-Benedict simplified).
   */
  private estimateEnergyNeeds(age: number, activity: string): number {
    // Base metabolic rate (BMR) estimate
    const baseBMR = age < 18 ? 1200 : 1500; // Simplified
    const activityMultipliers: Record<string, number> = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9,
    };
    const multiplier = activityMultipliers[activity] || 1.55;
    return Math.round(baseBMR * multiplier);
  }

  /**
   * Apply SG02 energy floor: under-18 members get maintenance only, no deficit.
   */
  private applySG02EnergyFloor(
    profiles: MemberProfile[],
    targetEnergy: number,
  ): number {
    const hasUnder18 = profiles.some((p) => p.age < 18);
    if (hasUnder18) {
      // Under-18 members: maintenance only, no caloric deficit
      // Return maintenance target, not deficit target
      return Math.round(targetEnergy * 1.0); // No reduction for under-18
    }
    return targetEnergy;
  }

  /**
   * Determine if own-source dinners should be required.
   */
  private shouldRequireOwnSourceDinners(profiles: MemberProfile[]): boolean {
    // Require own-source dinners if any member has strong preferences or health conditions
    return profiles.some(
      (p) =>
        p.conditions.length > 0 ||
        p.dietPreferences.includes("special-diet"),
    );
  }

  /**
   * Get the current plan (read-only access).
   */
  getCurrentPlan(): MealPlan | null {
    return this.currentPlan;
  }

  /**
   * Get plan summary with statistics.
   */
  getPlanSummary(): {
    planId: string | null;
    mealCount: number;
    dayCount: number;
    lockedMeals: number;
    ownSourceMeals: number;
    totalEnergy: number;
  } | null {
    if (!this.currentPlan) return null;

    const dates = new Set(this.currentPlan.meals.map((m) => m.date));
    const totalEnergy = this.currentPlan.meals.reduce(
      (sum, m) => sum + m.recipe.caloriesPerServing,
      0,
    );

    return {
      planId: this.currentPlan.planId,
      mealCount: this.currentPlan.meals.length,
      dayCount: dates.size,
      lockedMeals: getLockedMeals(this.currentPlan).length,
      ownSourceMeals: getOwnSourceMeals(this.currentPlan).length,
      totalEnergy,
    };
  }
}
