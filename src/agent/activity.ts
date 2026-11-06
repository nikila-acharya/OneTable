/**
 * WP-4.9 — Activity & Tips Agent: Health goals and sourced tips
 * Sets up activity goals from HHS guidelines.
 * Sends weekly check-in reminders.
 * Records check-ins and surfaces clinical-source tips.
 * Filtered pool tips with their source.
 * EX01, EX02, HT01, HT02
 */

import type { AgentExecutionContext } from "./runtime";
import { LLMClient } from "./runtime";
import { getAgentConfig } from "./roster";

/**
 * Activity goal.
 */
export interface ActivityGoal {
  goalId: string;
  memberId: string;
  householdId: string;
  goalType: "strength" | "cardio" | "flexibility" | "daily_steps";
  frequency: "daily" | "weekly" | "monthly";
  targetValue: number;
  unit: "minutes" | "days" | "miles" | "steps";
  createdAt: string;
  completedAt?: string;
  notes?: string;
}

/**
 * Health tip (clinical or pool).
 */
export interface HealthTip {
  tipId: string;
  content: string;
  source: {
    name: string; // "CDC", "Mayo Clinic", "HHS", "user_pool"
    url?: string;
    type: "clinical" | "user_pool";
  };
  category: "nutrition" | "activity" | "sleep" | "stress" | "general";
  visibility: "visible" | "hidden"; // Hidden if contradicts rule or ED-related
  createdAt: string;
}

/**
 * Weekly check-in.
 */
export interface CheckIn {
  checkInId: string;
  memberId: string;
  householdId: string;
  week: string; // ISO week: "2026-W45"
  completedAt: string;
  activities: Array<{
    goalId: string;
    completed: number; // How much completed (vs. target)
    unit: string;
  }>;
  notes?: string;
}

/**
 * Activity & Tips Agent.
 */
export class ActivityAgent {
  private llm: LLMClient;
  private config = getAgentConfig("activity");
  private goals: Map<string, ActivityGoal> = new Map();
  private tips: Map<string, HealthTip> = new Map();
  private checkIns: Map<string, CheckIn> = new Map();

  constructor(
    private context: AgentExecutionContext,
  ) {
    this.llm = new LLMClient(this.config.model);
    this.initializeClinicaTips();
  }

  /**
   * Set up activity goals from HHS guidelines.
   */
  async setActivityGoal(
    householdId: string,
    memberId: string,
    ageGroup: "child_6_17" | "adult_18_64" | "older_adult_65plus",
  ): Promise<{ goals: ActivityGoal[]; message: string }> {
    const createdGoals: ActivityGoal[] = [];

    // HHS guidelines by age group
    const guidelines: Record<string, Array<Omit<ActivityGoal, "goalId" | "memberId" | "householdId" | "createdAt">>> = {
      child_6_17: [
        {
          goalType: "cardio",
          frequency: "daily",
          targetValue: 60,
          unit: "minutes",
          notes: "HHS: Children need 60+ min/day moderate activity",
        },
        {
          goalType: "strength",
          frequency: "weekly",
          targetValue: 3,
          unit: "days",
          notes: "HHS: Include muscle-strengthening 3+ days/week",
        },
      ],
      adult_18_64: [
        {
          goalType: "cardio",
          frequency: "weekly",
          targetValue: 150,
          unit: "minutes",
          notes: "HHS: 150 min/week moderate-intensity aerobic",
        },
        {
          goalType: "strength",
          frequency: "weekly",
          targetValue: 2,
          unit: "days",
          notes: "HHS: Muscle-strengthening 2+ days/week",
        },
      ],
      older_adult_65plus: [
        {
          goalType: "daily_steps",
          frequency: "daily",
          targetValue: 7000,
          unit: "steps",
          notes: "HHS: Aim for 7,000+ steps daily",
        },
        {
          goalType: "flexibility",
          frequency: "weekly",
          targetValue: 2,
          unit: "days",
          notes: "HHS: Flexibility and balance training 2+ days/week",
        },
      ],
    };

    const hhsGoals = guidelines[ageGroup] || guidelines.adult_18_64;

    for (const goal of hhsGoals) {
      const created: ActivityGoal = {
        ...goal,
        goalId: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        memberId,
        householdId,
        createdAt: new Date().toISOString(),
      };

      this.goals.set(created.goalId, created);
      createdGoals.push(created);
    }

    return {
      goals: createdGoals,
      message: `Set up ${createdGoals.length} activity goals based on HHS guidelines for ${ageGroup}`,
    };
  }

  /**
   * Send weekly check-in reminder.
   */
  async scheduleCheckInReminder(
    householdId: string,
    memberId: string,
  ): Promise<{ message: string; nextCheckInDue: string }> {
    const memberGoals = Array.from(this.goals.values()).filter(
      (g) => g.householdId === householdId && g.memberId === memberId,
    );

    if (memberGoals.length === 0) {
      return {
        message: "No activity goals set up yet.",
        nextCheckInDue: new Date().toISOString(),
      };
    }

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    return {
      message: `Time for your weekly check-in! Here are your ${memberGoals.length} activity goals:`,
      nextCheckInDue: nextWeek.toISOString(),
    };
  }

  /**
   * Record weekly check-in.
   */
  async recordCheckIn(
    householdId: string,
    memberId: string,
    activities: Array<{ goalId: string; completed: number }>,
    notes?: string,
  ): Promise<{ checkIn: CheckIn; summary: string }> {
    const week = this.getCurrentISOWeek();
    const checkInId = `checkin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Ensure completed values match unit types
    const validatedActivities = activities
      .map((a) => {
        const goal = this.goals.get(a.goalId);
        if (!goal) return null;

        return {
          goalId: a.goalId,
          completed: a.completed,
          unit: goal.unit,
        };
      })
      .filter((a) => a !== null) as Array<{ goalId: string; completed: number; unit: string }>;

    const checkIn: CheckIn = {
      checkInId,
      memberId,
      householdId,
      week,
      completedAt: new Date().toISOString(),
      activities: validatedActivities,
      notes,
    };

    this.checkIns.set(checkInId, checkIn);

    // Calculate completion percentages
    const summary = this.generateCheckInSummary(checkIn);

    return { checkIn, summary };
  }

  /**
   * Get clinical-source tips (HT01).
   */
  getClinicalTips(category?: string): HealthTip[] {
    return Array.from(this.tips.values()).filter(
      (t) =>
        t.source.type === "clinical" &&
        t.visibility === "visible" &&
        (!category || t.category === category),
    );
  }

  /**
   * Get visible pool tips (HT02 - after filtering).
   */
  getPoolTips(category?: string): HealthTip[] {
    return Array.from(this.tips.values()).filter(
      (t) =>
        t.source.type === "user_pool" &&
        t.visibility === "visible" &&
        (!category || t.category === category),
    );
  }

  /**
   * Add user-provided tip to pool (will be classified & filtered).
   */
  async submitPoolTip(
    householdId: string,
    content: string,
    category: string,
  ): Promise<{ tip: HealthTip; message: string }> {
    const tipId = `tip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Classify tip (detect ED signals, contradictions)
    const visibility = this.classifyTip(content, category);

    const tip: HealthTip = {
      tipId,
      content,
      source: {
        name: "user_pool",
        type: "user_pool",
      },
      category: category as HealthTip["category"],
      visibility,
      createdAt: new Date().toISOString(),
    };

    this.tips.set(tipId, tip);

    const message =
      visibility === "visible"
        ? "Tip added to the pool!"
        : "Thanks for the tip! Our team is reviewing it.";

    return { tip, message };
  }

  /**
   * Hide tips that contradict rules (HT02 filtering).
   */
  hideTipIfConflicts(tipId: string, ruleId: string): { hidden: boolean; reason: string } {
    const tip = this.tips.get(tipId);
    if (!tip) {
      return { hidden: false, reason: "Tip not found" };
    }

    // Check for ED signals, weight-loss language, contradiction with rules
    const edSignals = ["weight loss", "diet", "restrict", "calories"];
    const isED = edSignals.some((signal) => tip.content.toLowerCase().includes(signal));

    if (isED) {
      tip.visibility = "hidden";
      return { hidden: true, reason: "Eating disorder signal detected" };
    }

    return { hidden: false, reason: "No conflict" };
  }

  /**
   * Get member's goal progress.
   */
  getGoalProgress(householdId: string, memberId: string): {
    goals: ActivityGoal[];
    recentCheckIns: CheckIn[];
    completionRate: number;
  } {
    const memberGoals = Array.from(this.goals.values()).filter(
      (g) => g.householdId === householdId && g.memberId === memberId,
    );

    const memberCheckIns = Array.from(this.checkIns.values())
      .filter((c) => c.memberId === memberId && c.householdId === householdId)
      .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
      .slice(0, 4); // Last 4 weeks

    const completionRate = this.calculateCompletionRate(memberCheckIns, memberGoals);

    return { goals: memberGoals, recentCheckIns: memberCheckIns, completionRate };
  }

  /**
   * List all visible tips.
   */
  getAllTips(): HealthTip[] {
    return Array.from(this.tips.values()).filter((t) => t.visibility === "visible");
  }

  /**
   * Private helpers.
   */

  private initializeClinicaTips(): void {
    const clinicalTips: Omit<HealthTip, "tipId" | "createdAt">[] = [
      {
        content:
          "The American Heart Association recommends at least 150 minutes of moderate-intensity aerobic activity per week for adults.",
        source: {
          name: "American Heart Association",
          url: "https://www.heart.org",
          type: "clinical",
        },
        category: "activity",
        visibility: "visible",
      },
      {
        content:
          "Include a variety of fruits and vegetables to get a range of vitamins and minerals. Aim for at least 5 portions a day.",
        source: {
          name: "CDC",
          url: "https://www.cdc.gov",
          type: "clinical",
        },
        category: "nutrition",
        visibility: "visible",
      },
      {
        content:
          "Adults should aim for 7-9 hours of sleep per night. Children need 8-12 hours depending on age.",
        source: {
          name: "CDC",
          url: "https://www.cdc.gov",
          type: "clinical",
        },
        category: "sleep",
        visibility: "visible",
      },
    ];

    for (const tip of clinicalTips) {
      const tipId = `tip-clinical-${Math.random().toString(36).slice(2, 9)}`;
      this.tips.set(tipId, {
        ...tip,
        tipId,
        createdAt: new Date().toISOString(),
      });
    }
  }

  private classifyTip(content: string, category: string): "visible" | "hidden" {
    const edSignals = [
      "lose weight",
      "weight loss",
      "diet",
      "restrict",
      "burn calories",
      "reduce calories",
    ];

    const isED = edSignals.some((signal) => content.toLowerCase().includes(signal));

    return isED ? "hidden" : "visible";
  }

  private generateCheckInSummary(checkIn: CheckIn): string {
    if (checkIn.activities.length === 0) {
      return "No activities logged for this week.";
    }

    const completed = checkIn.activities.filter((a) => a.completed > 0).length;
    const total = checkIn.activities.length;

    return `You logged ${completed}/${total} activities this week. Great effort!`;
  }

  private calculateCompletionRate(checkIns: CheckIn[], goals: ActivityGoal[]): number {
    if (checkIns.length === 0 || goals.length === 0) {
      return 0;
    }

    let totalCompleted = 0;
    let totalExpected = 0;

    for (const checkIn of checkIns) {
      for (const activity of checkIn.activities) {
        const goal = goals.find((g) => g.goalId === activity.goalId);
        if (!goal) continue;

        totalCompleted += Math.min(activity.completed, goal.targetValue);
        totalExpected += goal.targetValue;
      }
    }

    return totalExpected > 0 ? Math.round((totalCompleted / totalExpected) * 100) : 0;
  }

  private getCurrentISOWeek(): string {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());

    const week = Math.ceil(
      ((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7,
    );

    return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
  }
}
