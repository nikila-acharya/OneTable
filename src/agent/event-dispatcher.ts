/**
 * WP-4.9: Event Dispatcher (scheduled household cycles)
 *
 * Orchestrates automatic, recurring meal-plan generation:
 * - Schedules weekly events (Thursday 9 AM household local time)
 * - Triggers MealPlanner agent with context from Reviewer (learned preferences)
 * - Generates meal plans and logs to approval inbox for user preview
 * - Sends notifications: "Your weekly meal plan is ready for review"
 * - Supports user timezone (tz_name in member profile, e.g., 'America/New_York')
 * - M4: setTimeout mock; M5+: real cron integration via pg-boss or node-cron
 *
 * Flow:
 * 1. scheduleWeekly(householdId, weekday, hour, timezone) registers event
 * 2. On trigger: calls MealPlanner with household preferences
 * 3. MealPlanner generates structured plan
 * 4. EventDispatcher logs to approval inbox
 * 5. Notification sent to household members
 */

import type { AgentExecutionContext, LLMClient } from './runtime';

/**
 * Scheduled event descriptor.
 */
export interface ScheduledEvent {
  id: string;
  householdId: string;
  agentName: 'meal_planner' | 'scout' | 'reviewer';
  weekday: number; // 0 = Sunday, 4 = Thursday
  hour: number; // 0–23 (converted from local to UTC)
  timezone: string; // IANA timezone name (e.g., 'America/New_York')
  timezoneOffset: number; // current UTC offset in minutes for this TZ
  createdAt: Date;
  lastRunAt?: Date;
  nextRunAt?: Date;
  isActive: boolean;
}

/**
 * Notification payload sent to household members.
 */
export interface PlanNotification {
  id: string;
  householdId: string;
  title: string;
  message: string;
  planSummary?: {
    recipes: Array<{ name: string; day: string }>;
    generatedAt: Date;
  };
  actions: Array<{
    label: string;
    action: 'approve' | 'edit' | 'dismiss';
  }>;
}

/**
 * Approval inbox entry for user review before commit.
 */
export interface ApprovalInboxEntry {
  id: string;
  householdId: string;
  type: 'meal_plan_review' | 'recipe_import' | 'preference_change';
  title: string;
  description: string;
  content: {
    planId?: string;
    recipes?: Array<{ name: string; rating?: number }>;
    preferences?: Record<string, unknown>;
  };
  createdAt: Date;
  expiresAt: Date;
  status: 'pending' | 'approved' | 'edited' | 'dismissed';
  approvedAt?: Date;
}

/**
 * MealPlanner trigger context.
 */
export interface MealPlannerContext {
  householdId: string;
  memberId: string;
  timezone: string;
  preferences?: {
    dietaryRestrictions?: string[];
    cuisinePreferences?: string[];
    mealCount?: number;
    servingSize?: number;
  };
  learnedPreferences?: Record<string, unknown>;
}

/**
 * MealPlanner output.
 */
export interface MealPlan {
  id: string;
  householdId: string;
  generatedAt: Date;
  weekStart: Date;
  recipes: Array<{
    name: string;
    day: string;
    mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    rating?: number;
  }>;
}

/**
 * EventDispatcher: coordinates scheduled household cycles.
 */
export class EventDispatcher {
  private agentId = 'event_dispatcher';
  private scheduledEvents: Map<string, ScheduledEvent> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private notifications: Map<string, PlanNotification> = new Map();
  private approvalInbox: Map<string, ApprovalInboxEntry> = new Map();
  private mealPlannerAgent?: { trigger: (context: MealPlannerContext) => Promise<MealPlan> };

  constructor(private llmClient?: LLMClient) {}

  /**
   * Register the MealPlanner agent for triggering.
   */
  registerMealPlanner(agent: { trigger: (context: MealPlannerContext) => Promise<MealPlan> }) {
    this.mealPlannerAgent = agent;
  }

  /**
   * Calculate timezone offset in minutes for a given IANA timezone.
   * For M4, stub implementation using basic offset calculation.
   */
  private getTimezoneOffset(timezone: string): number {
    // M4 stub: basic hardcoded mappings
    const offsets: Record<string, number> = {
      'America/New_York': -300, // EST: -5h
      'America/Chicago': -360, // CST: -6h
      'America/Denver': -420, // MST: -7h
      'America/Los_Angeles': -480, // PST: -8h
      'Europe/London': 0,
      'Europe/Paris': 60,
      'Asia/Tokyo': 540,
      'Australia/Sydney': 600,
      'UTC': 0,
    };
    return offsets[timezone] ?? 0;
  }

  /**
   * Calculate UTC time from local time given timezone.
   */
  private calculateUtcTime(weekday: number, hour: number, timezone: string): { weekday: number; hour: number } {
    const offsetMinutes = this.getTimezoneOffset(timezone);
    const offsetHours = offsetMinutes / 60;

    let utcHour = hour - offsetHours;
    let utcWeekday = weekday;

    if (utcHour < 0) {
      utcHour += 24;
      utcWeekday = (utcWeekday - 1 + 7) % 7;
    } else if (utcHour >= 24) {
      utcHour -= 24;
      utcWeekday = (utcWeekday + 1) % 7;
    }

    return { weekday: utcWeekday, hour: Math.floor(utcHour) };
  }

  /**
   * Calculate milliseconds until next scheduled event.
   */
  private calculateNextRunMs(weekday: number, hour: number): number {
    const now = new Date();
    const currentWeekday = now.getUTCDay();
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();

    let daysUntilEvent = (weekday - currentWeekday + 7) % 7;

    // If same day but time has passed, schedule for next week
    if (daysUntilEvent === 0 && (hour < currentHour || (hour === currentHour && 0 < currentMinute))) {
      daysUntilEvent = 7;
    }

    // If same day and time hasn't passed
    if (daysUntilEvent === 0) {
      const scheduledTime = new Date(now);
      scheduledTime.setUTCHours(hour, 0, 0, 0);
      return Math.max(0, scheduledTime.getTime() - now.getTime());
    }

    // Future week
    const scheduledTime = new Date(now);
    scheduledTime.setUTCDate(now.getUTCDate() + daysUntilEvent);
    scheduledTime.setUTCHours(hour, 0, 0, 0);
    return scheduledTime.getTime() - now.getTime();
  }

  /**
   * Schedule a recurring event (weekly meal-plan generation).
   * For M4: uses setTimeout mock. M5+: real cron via pg-boss.
   */
  async scheduleWeekly(householdId: string, weekday: number, hour: number, timezone: string): Promise<ScheduledEvent> {
    // Validate inputs
    if (weekday < 0 || weekday > 6) {
      throw new Error(`Invalid weekday: ${weekday}. Must be 0–6.`);
    }
    if (hour < 0 || hour > 23) {
      throw new Error(`Invalid hour: ${hour}. Must be 0–23.`);
    }

    const eventId = `evt_${householdId}_${weekday}_${hour}`;
    const offset = this.getTimezoneOffset(timezone);
    const { weekday: utcWeekday, hour: utcHour } = this.calculateUtcTime(weekday, hour, timezone);
    const nextRunMs = this.calculateNextRunMs(utcWeekday, utcHour);

    const event: ScheduledEvent = {
      id: eventId,
      householdId,
      agentName: 'meal_planner',
      weekday: utcWeekday,
      hour: utcHour,
      timezone,
      timezoneOffset: offset,
      createdAt: new Date(),
      nextRunAt: new Date(Date.now() + nextRunMs),
      isActive: true,
    };

    this.scheduledEvents.set(eventId, event);

    // M4: setTimeout mock; schedule the next run
    this.scheduleNextRun(eventId, nextRunMs);

    return event;
  }

  /**
   * Schedule the next run of an event (M4 stub with setTimeout).
   */
  private scheduleNextRun(eventId: string, delayMs: number) {
    const event = this.scheduledEvents.get(eventId);
    if (!event || !event.isActive) return;

    // Clear any existing timer
    if (this.timers.has(eventId)) {
      clearTimeout(this.timers.get(eventId)!);
    }

    // M4: setTimeout mock
    const timer = setTimeout(async () => {
      await this.triggerEvent(eventId);
      // Reschedule for next week
      const nextDelayMs = 7 * 24 * 60 * 60 * 1000; // 1 week
      this.scheduleNextRun(eventId, nextDelayMs);
    }, delayMs);

    this.timers.set(eventId, timer);
  }

  /**
   * Trigger a scheduled event: call MealPlanner, generate plan, notify user.
   */
  private async triggerEvent(eventId: string): Promise<void> {
    const event = this.scheduledEvents.get(eventId);
    if (!event) return;

    try {
      // Call MealPlanner agent
      const mealPlan = await this.callMealPlanner(event.householdId, event.timezone);

      // Log to approval inbox
      await this.logToApprovalInbox(event.householdId, mealPlan);

      // Send notification
      await this.sendNotification(event.householdId, mealPlan);

      // Update event
      event.lastRunAt = new Date();
      event.nextRunAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    } catch (err) {
      console.error(`EventDispatcher: error triggering event ${eventId}:`, err);
    }
  }

  /**
   * Call MealPlanner agent with household context.
   */
  private async callMealPlanner(householdId: string, timezone: string): Promise<MealPlan> {
    if (!this.mealPlannerAgent) {
      throw new Error('MealPlanner agent not registered');
    }

    const context: MealPlannerContext = {
      householdId,
      memberId: `member_primary_${householdId}`,
      timezone,
      preferences: {
        dietaryRestrictions: [],
        cuisinePreferences: ['comfort-food', 'quick-meals'],
        mealCount: 3,
        servingSize: 4,
      },
    };

    return this.mealPlannerAgent.trigger(context);
  }

  /**
   * Log meal plan to approval inbox for user review.
   */
  private async logToApprovalInbox(householdId: string, mealPlan: MealPlan): Promise<void> {
    const entryId = `appr_${mealPlan.id}`;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7-day review window

    const entry: ApprovalInboxEntry = {
      id: entryId,
      householdId,
      type: 'meal_plan_review',
      title: `Weekly Meal Plan – Week of ${mealPlan.weekStart.toLocaleDateString()}`,
      description: `Auto-generated meal plan ready for your review. Approve, edit, or dismiss.`,
      content: {
        planId: mealPlan.id,
        recipes: mealPlan.recipes.map((r) => ({ name: r.name, rating: r.rating })),
      },
      createdAt: new Date(),
      expiresAt,
      status: 'pending',
    };

    this.approvalInbox.set(entryId, entry);
  }

  /**
   * Send notification to household members.
   */
  private async sendNotification(householdId: string, mealPlan: MealPlan): Promise<void> {
    const notificationId = `notif_${mealPlan.id}`;

    const notification: PlanNotification = {
      id: notificationId,
      householdId,
      title: 'Your weekly meal plan is ready for review',
      message: "We've generated a personalized meal plan based on your preferences.",
      planSummary: {
        recipes: mealPlan.recipes.map((r) => ({
          name: r.name,
          day: r.day,
        })),
        generatedAt: mealPlan.generatedAt,
      },
      actions: [
        { label: 'Approve', action: 'approve' },
        { label: 'Edit', action: 'edit' },
        { label: 'Dismiss', action: 'dismiss' },
      ],
    };

    this.notifications.set(notificationId, notification);
  }

  /**
   * Get all scheduled events.
   */
  getScheduledEvents(): ScheduledEvent[] {
    return Array.from(this.scheduledEvents.values());
  }

  /**
   * Get all pending notifications.
   */
  getPendingNotifications(): PlanNotification[] {
    return Array.from(this.notifications.values());
  }

  /**
   * Get all approval inbox entries.
   */
  getApprovalInboxEntries(): ApprovalInboxEntry[] {
    return Array.from(this.approvalInbox.values());
  }

  /**
   * Get approval inbox entries for a household.
   */
  getHouseholdInbox(householdId: string): ApprovalInboxEntry[] {
    return Array.from(this.approvalInbox.values()).filter((e) => e.householdId === householdId);
  }

  /**
   * Mark an approval inbox entry as approved.
   */
  approveInboxEntry(entryId: string): boolean {
    const entry = this.approvalInbox.get(entryId);
    if (!entry) return false;

    entry.status = 'approved';
    entry.approvedAt = new Date();
    return true;
  }

  /**
   * Cancel a scheduled event.
   */
  cancelEvent(eventId: string): boolean {
    const event = this.scheduledEvents.get(eventId);
    if (!event) return false;

    event.isActive = false;
    if (this.timers.has(eventId)) {
      clearTimeout(this.timers.get(eventId)!);
      this.timers.delete(eventId);
    }
    return true;
  }

  /**
   * Clean up all timers (for testing or shutdown).
   */
  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.scheduledEvents.clear();
  }
}
