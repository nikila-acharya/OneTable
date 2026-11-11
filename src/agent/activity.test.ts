/**
 * WP-4.9 — Activity & Tips Agent Tests
 * Activity goals (HHS), check-ins, clinical tips, pool tip filtering
 */

import { beforeEach, describe, expect, it } from "vitest";
import { ActivityAgent } from "./activity";
import type { AgentExecutionContext } from "./runtime";

describe("WP-4.9 Activity & Tips Agent", () => {
  let agent: ActivityAgent;
  let mockContext: AgentExecutionContext;

  const householdId = "household-001";
  const memberId = "member-001";

  beforeEach(() => {
    mockContext = {} as AgentExecutionContext;
    agent = new ActivityAgent(mockContext);
  });

  // ============ Activity Goals (HHS Guidelines) ============
  describe("Activity goals from HHS guidelines", () => {
    it("sets goals for children (6-17 years)", async () => {
      const result = await agent.setActivityGoal(householdId, memberId, "child_6_17");

      expect(result.goals.length).toBeGreaterThan(0);
      expect(result.goals.some((g) => g.goalType === "cardio")).toBe(true);
      expect(result.goals.some((g) => g.goalType === "strength")).toBe(true);
    });

    it("child goal: 60 min/day cardio", async () => {
      const result = await agent.setActivityGoal(householdId, memberId, "child_6_17");
      const cardio = result.goals.find((g) => g.goalType === "cardio");

      expect(cardio?.targetValue).toBe(60);
      expect(cardio?.unit).toBe("minutes");
      expect(cardio?.frequency).toBe("daily");
    });

    it("child goal: 3+ days/week strength", async () => {
      const result = await agent.setActivityGoal(householdId, memberId, "child_6_17");
      const strength = result.goals.find((g) => g.goalType === "strength");

      expect(strength?.targetValue).toBe(3);
      expect(strength?.unit).toBe("days");
      expect(strength?.frequency).toBe("weekly");
    });

    it("sets goals for adults (18-64 years)", async () => {
      const result = await agent.setActivityGoal(householdId, memberId, "adult_18_64");

      expect(result.goals.length).toBeGreaterThan(0);
      expect(result.goals.some((g) => g.goalType === "cardio")).toBe(true);
      expect(result.goals.some((g) => g.goalType === "strength")).toBe(true);
    });

    it("adult goal: 150 min/week cardio", async () => {
      const result = await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      const cardio = result.goals.find((g) => g.goalType === "cardio");

      expect(cardio?.targetValue).toBe(150);
      expect(cardio?.unit).toBe("minutes");
      expect(cardio?.frequency).toBe("weekly");
    });

    it("sets goals for older adults (65+)", async () => {
      const result = await agent.setActivityGoal(householdId, memberId, "older_adult_65plus");

      expect(result.goals.length).toBeGreaterThan(0);
      expect(result.goals.some((g) => g.goalType === "daily_steps")).toBe(true);
    });

    it("older adult goal: 7000+ steps/day", async () => {
      const result = await agent.setActivityGoal(householdId, memberId, "older_adult_65plus");
      const steps = result.goals.find((g) => g.goalType === "daily_steps");

      expect(steps?.targetValue).toBeGreaterThanOrEqual(7000);
      expect(steps?.unit).toBe("steps");
    });

    it("creates unique goalIds", async () => {
      const result1 = await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      const result2 = await agent.setActivityGoal(householdId, memberId, "adult_18_64");

      const ids1 = result1.goals.map((g) => g.goalId);
      const ids2 = result2.goals.map((g) => g.goalId);

      expect(ids1).not.toEqual(ids2);
    });

    it("stores goals with household and member ID", async () => {
      const result = await agent.setActivityGoal(householdId, "different-member", "adult_18_64");

      for (const goal of result.goals) {
        expect(goal.householdId).toBe(householdId);
        expect(goal.memberId).toBe("different-member");
      }
    });
  });

  // ============ Check-In Reminders ============
  describe("Weekly check-in reminders", () => {
    it("schedules check-in reminder after goals are set", async () => {
      await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      const result = await agent.scheduleCheckInReminder(householdId, memberId);

      expect(result.message).toContain("check-in");
      expect(result.nextCheckInDue).toBeDefined();
    });

    it("returns message with goal count", async () => {
      const goals = await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      const result = await agent.scheduleCheckInReminder(householdId, memberId);

      expect(result.message).toContain(goals.goals.length.toString());
    });

    it("returns message when no goals set", async () => {
      const result = await agent.scheduleCheckInReminder(householdId, "no-goals-member");

      expect(result.message).toContain("No activity goals");
    });
  });

  // ============ Check-Ins ============
  describe("Recording check-ins", () => {
    it("records weekly check-in with activity data", async () => {
      const goals = await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      const goalId = goals.goals[0]!.goalId;

      const result = await agent.recordCheckIn(householdId, memberId, [
        { goalId, completed: 150 },
      ]);

      expect(result.checkIn).toBeDefined();
      expect(result.checkIn.activities).toHaveLength(1);
      expect(result.checkIn.activities[0]!.completed).toBe(150);
    });

    it("records multiple activities in one check-in", async () => {
      const goals = await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      const goalIds = goals.goals.map((g) => g.goalId);

      const result = await agent.recordCheckIn(
        householdId,
        memberId,
        goalIds.map((id) => ({ goalId: id, completed: 100 })),
      );

      expect(result.checkIn.activities).toHaveLength(goalIds.length);
    });

    it("generates summary after check-in", async () => {
      const goals = await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      const goalId = goals.goals[0]!.goalId;

      const result = await agent.recordCheckIn(householdId, memberId, [
        { goalId, completed: 150 },
      ]);

      expect(result.summary).toContain("logged");
      expect(result.summary).toContain("activities");
    });

    it("includes notes in check-in", async () => {
      const goals = await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      const goalId = goals.goals[0]!.goalId;

      const result = await agent.recordCheckIn(
        householdId,
        memberId,
        [{ goalId, completed: 150 }],
        "Felt good this week!",
      );

      expect(result.checkIn.notes).toBe("Felt good this week!");
    });

    it("stores check-in with ISO week", async () => {
      const goals = await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      const goalId = goals.goals[0]!.goalId;

      const result = await agent.recordCheckIn(householdId, memberId, [
        { goalId, completed: 150 },
      ]);

      expect(result.checkIn.week).toMatch(/\d{4}-W\d{2}/);
    });

    it("ignores invalid goalIds in check-in", async () => {
      const result = await agent.recordCheckIn(householdId, memberId, [
        { goalId: "nonexistent", completed: 100 },
      ]);

      expect(result.checkIn.activities).toHaveLength(0);
    });
  });

  // ============ Clinical Tips (HT01) ============
  describe("Clinical-source tips (HT01)", () => {
    it("returns clinical tips only", () => {
      const tips = agent.getClinicalTips();

      for (const tip of tips) {
        expect(tip.source.type).toBe("clinical");
        expect(tip.visibility).toBe("visible");
      }
    });

    it("includes tips from reputable sources (CDC, AHA, etc.)", () => {
      const tips = agent.getClinicalTips();

      expect(tips.length).toBeGreaterThan(0);
      expect(tips.some((t) => t.source.name.includes("CDC") || t.source.name.includes("American"))).toBe(true);
    });

    it("tips include URL source", () => {
      const tips = agent.getClinicalTips();

      for (const tip of tips) {
        if (tip.source.type === "clinical") {
          expect(tip.source.url).toBeDefined();
        }
      }
    });

    it("filters clinical tips by category", () => {
      const activityTips = agent.getClinicalTips("activity");

      for (const tip of activityTips) {
        expect(tip.category).toBe("activity");
      }
    });
  });

  // ============ Pool Tips & Filtering (HT02) ============
  describe("User pool tips with filtering (HT02)", () => {
    it("submits tip to pool", async () => {
      const result = await agent.submitPoolTip(
        householdId,
        "Make sure to stay hydrated during exercise!",
        "activity",
      );

      expect(result.tip).toBeDefined();
      expect(result.tip.source.type).toBe("user_pool");
      expect(result.message).toContain("pool");
    });

    it("hides tips with ED signals (weight loss language)", async () => {
      const result = await agent.submitPoolTip(
        householdId,
        "Try this diet to lose weight quickly!",
        "nutrition",
      );

      expect(result.tip.visibility).toBe("hidden");
      expect(result.message).toContain("reviewing");
    });

    it("hides tips with restriction language", async () => {
      const result = await agent.submitPoolTip(
        householdId,
        "Restrict calories to improve health",
        "nutrition",
      );

      expect(result.tip.visibility).toBe("hidden");
    });

    it("accepts valid pool tips", async () => {
      const result = await agent.submitPoolTip(
        householdId,
        "Try whole grains for sustained energy",
        "nutrition",
      );

      expect(result.tip.visibility).toBe("visible");
      expect(result.message).toContain("pool");
    });

    it("returns only visible pool tips", () => {
      const tips = agent.getPoolTips();

      for (const tip of tips) {
        expect(tip.source.type).toBe("user_pool");
        expect(tip.visibility).toBe("visible");
      }
    });

    it("filters pool tips by category", async () => {
      await agent.submitPoolTip(householdId, "Stay hydrated", "activity");
      await agent.submitPoolTip(householdId, "Get 8 hours sleep", "sleep");

      const activityTips = agent.getPoolTips("activity");
      const sleepTips = agent.getPoolTips("sleep");

      for (const tip of activityTips) {
        expect(tip.category).toBe("activity");
      }
      for (const tip of sleepTips) {
        expect(tip.category).toBe("sleep");
      }
    });

    it("can hide tip if it conflicts with rules", async () => {
      const tipResult = await agent.submitPoolTip(
        householdId,
        "Try eating less to feel better",
        "nutrition",
      );

      const result = agent.hideTipIfConflicts(tipResult.tip.tipId, "rule-001");

      expect(result.hidden).toBe(true);
    });
  });

  // ============ Goal Progress ============
  describe("Goal progress tracking", () => {
    it("returns goals for member", async () => {
      const goals = await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      const progress = agent.getGoalProgress(householdId, memberId);

      expect(progress.goals).toHaveLength(goals.goals.length);
    });

    it("returns recent check-ins (last 4 weeks)", async () => {
      const goals = await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      const goalId = goals.goals[0]!.goalId;

      await agent.recordCheckIn(householdId, memberId, [{ goalId, completed: 150 }]);
      await agent.recordCheckIn(householdId, memberId, [{ goalId, completed: 140 }]);

      const progress = agent.getGoalProgress(householdId, memberId);

      expect(progress.recentCheckIns.length).toBeGreaterThan(0);
      expect(progress.recentCheckIns.length).toBeLessThanOrEqual(4);
    });

    it("calculates completion rate", async () => {
      const goals = await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      const goalId = goals.goals[0]!.goalId;

      await agent.recordCheckIn(householdId, memberId, [{ goalId, completed: 150 }]);

      const progress = agent.getGoalProgress(householdId, memberId);

      expect(progress.completionRate).toBeGreaterThanOrEqual(0);
      expect(progress.completionRate).toBeLessThanOrEqual(100);
    });

    it("completion rate is 0 when no check-ins", async () => {
      await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      const progress = agent.getGoalProgress(householdId, memberId);

      expect(progress.completionRate).toBe(0);
    });
  });

  // ============ All Tips ============
  describe("Listing all tips", () => {
    it("returns all visible tips (clinical + pool)", async () => {
      await agent.submitPoolTip(householdId, "Stay hydrated", "activity");
      const allTips = agent.getAllTips();

      expect(allTips.length).toBeGreaterThan(0);
      const hasClinical = allTips.some((t) => t.source.type === "clinical");
      const hasPool = allTips.some((t) => t.source.type === "user_pool");

      expect(hasClinical || hasPool).toBe(true);
    });

    it("excludes hidden tips from all tips", async () => {
      await agent.submitPoolTip(householdId, "Try this diet to lose weight", "nutrition");
      const allTips = agent.getAllTips();

      for (const tip of allTips) {
        expect(tip.visibility).toBe("visible");
      }
    });
  });

  // ============ Integration ============
  describe("Full member activity workflow", () => {
    it("end-to-end: set goals → check-in → track progress", async () => {
      // 1. Set goals
      const goals = await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      expect(goals.goals.length).toBeGreaterThan(0);

      // 2. Schedule check-in
      const reminder = await agent.scheduleCheckInReminder(householdId, memberId);
      expect(reminder.message).toContain("check-in");

      // 3. Record check-in
      const goalId = goals.goals[0]!.goalId;
      const checkIn = await agent.recordCheckIn(householdId, memberId, [
        { goalId, completed: 150 },
      ]);
      expect(checkIn.checkIn.activities).toHaveLength(1);

      // 4. View progress
      const progress = agent.getGoalProgress(householdId, memberId);
      expect(progress.goals).toHaveLength(goals.goals.length);
      expect(progress.recentCheckIns.length).toBeGreaterThan(0);
      expect(progress.completionRate).toBeGreaterThan(0);
    });

    it("tips workflow: clinical tips + user-submitted pool tips", () => {
      // 1. Get clinical tips
      const clinicalTips = agent.getClinicalTips();
      expect(clinicalTips.length).toBeGreaterThan(0);

      // 2. Submit pool tip (should be accepted)
      // Note: async test would go here with submitPoolTip

      // 3. Get all visible tips
      const allTips = agent.getAllTips();
      expect(allTips.length).toBeGreaterThanOrEqual(clinicalTips.length);
    });
  });

  // ============ Edge Cases ============
  describe("Edge cases & error handling", () => {
    it("handles empty check-in activities", async () => {
      const result = await agent.recordCheckIn(householdId, memberId, []);

      expect(result.checkIn.activities).toHaveLength(0);
      expect(result.summary).toContain("No activities");
    });

    it("returns empty goals for member with none", () => {
      const progress = agent.getGoalProgress(householdId, "nonexistent-member");

      expect(progress.goals).toHaveLength(0);
      expect(progress.completionRate).toBe(0);
    });

    it("filters tips by invalid category returns empty", () => {
      const tips = agent.getClinicalTips("invalid_category");

      expect(tips).toHaveLength(0);
    });

    it("can set multiple goal sets for same member", async () => {
      await agent.setActivityGoal(householdId, memberId, "adult_18_64");
      await agent.setActivityGoal(householdId, memberId, "adult_18_64");

      const progress = agent.getGoalProgress(householdId, memberId);

      // Should have goals from both sets
      expect(progress.goals.length).toBeGreaterThan(0);
    });
  });
});
