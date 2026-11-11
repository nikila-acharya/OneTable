/**
 * WP-6.1 — Analytics & Metrics: User engagement, health outcomes, agent performance
 * Tracks all relevant metrics for product decisions, A/B testing, and health improvements
 * Privacy-first: never tracks raw health data
 */

import { EventEmitter } from "events";
import { createHash } from "node:crypto";

/**
 * Analytics event types
 */
export type AnalyticsEventType =
  | "user_signup"
  | "household_created"
  | "member_added"
  | "meal_plan_drafted"
  | "meal_plan_approved"
  | "plan_skipped"
  | "grocery_purchased"
  | "checkin_completed"
  | "activity_goal_set"
  | "approval_declined"
  | "undo_performed"
  | "agent_error"
  | "safety_block";

/**
 * Analytics event payload
 */
export interface AnalyticsEvent {
  eventType: AnalyticsEventType;
  householdId: string;
  userId?: string;
  timestamp: string;
  properties: Record<string, unknown>;
  context?: {
    userAgent?: string;
    ipAddress?: string; // Hashed for privacy
    timezone?: string;
  };
}

/**
 * Health metrics (never raw values, only aggregates)
 */
export interface HealthMetrics {
  householdId: string;
  week: string; // ISO week
  mealCompletionRate: number; // 0-100
  mealsSkipped: number;
  ownSourceDinners: number;
  activityCompletionRate: number; // 0-100
  avgEnergyPerMeal: number; // Aggregate only
  allergensAvoided: number;
}

/**
 * Agent performance metrics
 */
export interface AgentMetrics {
  agentRole: string;
  period: string; // Day/week/month
  callsProcessed: number;
  avgDurationMs: number;
  errorRate: number; // Percent
  tokensUsed: number;
  costUSD: number;
  userSatisfaction?: number; // 1-5
}

/**
 * Analytics Manager
 */
export class AnalyticsManager extends EventEmitter {
  private events: AnalyticsEvent[] = [];
  private metrics: Map<string, HealthMetrics> = new Map();
  private agentMetrics: Map<string, AgentMetrics> = new Map();

  /**
   * Track an event
   */
  trackEvent(event: AnalyticsEvent): void {
    // Hash IP for privacy
    if (event.context?.ipAddress) {
      const hash = createHash("sha256")
        .update(event.context.ipAddress)
        .digest("hex")
        .slice(0, 8);
      event.context.ipAddress = hash;
    }

    this.events.push(event);

    // Emit for real-time processing
    this.emit("event", event);

    // Batch to analytics service (async)
    this.sendToAnalyticsService(event).catch((err) =>
      console.error("Analytics send failed:", err)
    );
  }

  /**
   * Record health metrics for household
   */
  recordHealthMetrics(metrics: HealthMetrics): void {
    const key = `${metrics.householdId}-${metrics.week}`;
    this.metrics.set(key, metrics);

    // Emit for dashboard updates
    this.emit("health_metrics", metrics);
  }

  /**
   * Record agent performance
   */
  recordAgentMetrics(metrics: AgentMetrics): void {
    const key = `${metrics.agentRole}-${metrics.period}`;
    this.agentMetrics.set(key, metrics);

    this.emit("agent_metrics", metrics);
  }

  /**
   * Get cohort analysis (households by signup week)
   */
  getCohortAnalysis(weeks: number = 12): Record<string, number> {
    const cohorts: Record<string, number> = {};

    for (const event of this.events) {
      if (event.eventType === "household_created") {
        const date = new Date(event.timestamp);
        const weekOf = this.getISOWeek(date);
        cohorts[weekOf] = (cohorts[weekOf] || 0) + 1;
      }
    }

    return cohorts;
  }

  /**
   * Get retention metrics
   */
  getRetention(): {
    week1: number; // Percent returning
    week4: number;
    week12: number;
  } {
    // Count households active in each period
    const week1Active = new Set<string>();
    const week4Active = new Set<string>();
    const week12Active = new Set<string>();

    const now = new Date();
    const week1Cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const week4Cutoff = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const week12Cutoff = new Date(now.getTime() - 84 * 24 * 60 * 60 * 1000);

    for (const event of this.events) {
      const eventDate = new Date(event.timestamp);

      if (eventDate > week1Cutoff) {
        week1Active.add(event.householdId);
      }
      if (eventDate > week4Cutoff) {
        week4Active.add(event.householdId);
      }
      if (eventDate > week12Cutoff) {
        week12Active.add(event.householdId);
      }
    }

    const total = new Set(this.events.map((e) => e.householdId)).size || 1;

    return {
      week1: Math.round((week1Active.size / total) * 100),
      week4: Math.round((week4Active.size / total) * 100),
      week12: Math.round((week12Active.size / total) * 100),
    };
  }

  /**
   * Get feature adoption
   */
  getFeatureAdoption(): {
    mealPlanning: number;
    activityGoals: number;
    groceryTracking: number;
    recipeImport: number;
  } {
    const unique = new Set<string>();

    const mealPlanners = new Set<string>();
    const activityUsers = new Set<string>();
    const groceryUsers = new Set<string>();
    const recipeImporters = new Set<string>();

    for (const event of this.events) {
      unique.add(event.householdId);

      if (event.eventType === "meal_plan_approved") {
        mealPlanners.add(event.householdId);
      }
      if (event.eventType === "checkin_completed") {
        activityUsers.add(event.householdId);
      }
      if (event.eventType === "grocery_purchased") {
        groceryUsers.add(event.householdId);
      }
      if ((event.properties?.tool as string)?.includes("scout")) {
        recipeImporters.add(event.householdId);
      }
    }

    const total = unique.size || 1;

    return {
      mealPlanning: Math.round((mealPlanners.size / total) * 100),
      activityGoals: Math.round((activityUsers.size / total) * 100),
      groceryTracking: Math.round((groceryUsers.size / total) * 100),
      recipeImport: Math.round((recipeImporters.size / total) * 100),
    };
  }

  /**
   * Get health outcome trends
   */
  getHealthOutcomes(): {
    avgMealCompletion: number;
    avgActivityCompletion: number;
    mealsSkippedPerWeek: number;
    allergensAvoided: number;
  } {
    let totalCompletion = 0;
    let totalActivity = 0;
    let totalSkipped = 0;
    let totalAllergensAvoided = 0;
    let metricCount = 0;

    for (const [, metrics] of this.metrics) {
      totalCompletion += metrics.mealCompletionRate;
      totalActivity += metrics.activityCompletionRate;
      totalSkipped += metrics.mealsSkipped;
      totalAllergensAvoided += metrics.allergensAvoided;
      metricCount++;
    }

    return {
      avgMealCompletion: metricCount > 0 ? Math.round(totalCompletion / metricCount) : 0,
      avgActivityCompletion: metricCount > 0 ? Math.round(totalActivity / metricCount) : 0,
      mealsSkippedPerWeek: metricCount > 0 ? Math.round(totalSkipped / metricCount) : 0,
      allergensAvoided: metricCount > 0 ? Math.round(totalAllergensAvoided / metricCount) : 0,
    };
  }

  /**
   * Get agent performance summary
   */
  getAgentPerformance(): Record<
    string,
    {
      avgDurationMs: number;
      errorRate: number;
      tokensUsedTotal: number;
      callsProcessed: number;
    }
  > {
    const summary: Record<
      string,
      {
        avgDurationMs: number;
        errorRate: number;
        tokensUsedTotal: number;
        callsProcessed: number;
      }
    > = {};

    for (const [, metrics] of this.agentMetrics) {
      if (!summary[metrics.agentRole]) {
        summary[metrics.agentRole] = {
          avgDurationMs: 0,
          errorRate: 0,
          tokensUsedTotal: 0,
          callsProcessed: 0,
        };
      }

      summary[metrics.agentRole]!.avgDurationMs += metrics.avgDurationMs;
      summary[metrics.agentRole]!.errorRate += metrics.errorRate;
      summary[metrics.agentRole]!.tokensUsedTotal += metrics.tokensUsed;
      summary[metrics.agentRole]!.callsProcessed += metrics.callsProcessed;
    }

    return summary;
  }

  /**
   * Private helpers
   */

  private async sendToAnalyticsService(event: AnalyticsEvent): Promise<void> {
    // Send to analytics backend (Segment, Mixpanel, custom endpoint, etc.)
    // This is async and non-blocking
    try {
      await fetch("/api/analytics/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
    } catch (error) {
      console.error("Failed to send analytics:", error);
    }
  }

  private getISOWeek(date: Date): string {
    const week = Math.ceil(
      ((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7
    );
    return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
  }
}

/**
 * Singleton instance
 */
export const analytics = new AnalyticsManager();
