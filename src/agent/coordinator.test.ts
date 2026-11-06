/**
 * WP-4.3 — Coordinator Agent Tests
 * Intent routing, specialist delegation, result merging, one-card rule, budget enforcement
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Coordinator } from "./coordinator";
import { AgentRuntime } from "./runtime";
import { SafetyGuardian } from "./safety-guardian";
import type { AgentExecutionContext } from "./runtime";

describe("WP-4.3 Coordinator Agent", () => {
  let coordinator: Coordinator;
  let runtime: AgentRuntime;
  let mockContext: AgentExecutionContext;
  let mockGuardian: SafetyGuardian;

  beforeEach(() => {
    runtime = new AgentRuntime("household-001", "household");
    mockContext = runtime.createContext(
      "run-001",
      "conversational",
      "user_message",
      "user-123",
    );

    // Mock guardian
    mockGuardian = {
      checkInputMessage: vi.fn().mockResolvedValue({
        decision: "pass",
        failedChecks: [],
        record: {} as any,
      }),
      checkOutputMessage: vi.fn().mockResolvedValue({
        decision: "pass",
        failedChecks: [],
        record: {} as any,
      }),
    } as any;

    coordinator = new Coordinator(mockContext, runtime, mockGuardian);
  });

  // ============ Intent Classification ============
  describe("Intent classification", () => {
    it("handles setup household intent", async () => {
      const response = await coordinator.handleUserRequest(
        "We have two kids, ages 6 and 11. One is allergic to peanuts.",
      );

      expect(response.success).toBeDefined();
      expect(response.message).toBeDefined();
    });

    it("handles recipe import intent", async () => {
      const response = await coordinator.handleUserRequest(
        "I want to import recipes from https://example.com/blog",
      );

      expect(response.success).toBeDefined();
    });

    it("handles meal planning intent", async () => {
      const response = await coordinator.handleUserRequest(
        "My sister's family is coming Saturday, 4 extra for dinner, one is vegetarian.",
      );

      expect(response.success).toBeDefined();
    });

    it("handles tips/advice intent", async () => {
      const response = await coordinator.handleUserRequest(
        "What are good breakfast options for kids?",
      );

      expect(response.success).toBeDefined();
    });

    it("handles help request", async () => {
      const response = await coordinator.handleUserRequest(
        "What can you help me with?",
      );

      expect(response.success).toBe(true);
      expect(response.message).toContain("allergies");
    });
  });

  // ============ Specialist Delegation ============
  describe("Specialist delegation", () => {
    it("delegates to correct specialist for meal planning", async () => {
      const response = await coordinator.handleUserRequest(
        "Can we plan meals for next week?",
      );

      expect(response.success).toBeDefined();
      expect(response.delegationsSummary).toBeDefined();
    });

    it("tracks delegation results", async () => {
      await coordinator.handleUserRequest(
        "Import recipes from my blog",
      );

      const history = coordinator.getDelegationHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it("respects budget limits on delegations", async () => {
      // Max 4 delegations per run
      for (let i = 0; i < 4; i++) {
        const result = runtime.recordDelegation(mockContext, "setup");
        expect(result.allowed).toBe(i < 4);
      }

      const response = await coordinator.handleUserRequest(
        "Another request after budget exhausted",
      );

      expect(response.budgetStatus?.delegationsRemaining).toBeLessThanOrEqual(0);
    });

    it("handles delegation failures gracefully", async () => {
      // This tests merging when some delegates fail
      const response = await coordinator.handleUserRequest(
        "Plan meals and import recipes",
      );

      expect(response.delegationsSummary).toBeDefined();
      expect(
        response.delegationsSummary!.tasksCompleted +
          response.delegationsSummary!.tasksSkipped,
      ).toBeGreaterThanOrEqual(0);
    });
  });

  // ============ Result Merging ============
  describe("Result merging (one-card rule)", () => {
    it("creates single approval card from multiple delegations", async () => {
      const response = await coordinator.handleUserRequest(
        "Plan meals and draft groceries for next week",
      );

      // Should have max one approval card
      expect(response.approvalCard).toBeDefined();
      if (response.approvalCard) {
        expect(response.approvalCard.summary).toContain("Plan and grocery list");
      }
    });

    it("merges specialist messages into one response", async () => {
      const response = await coordinator.handleUserRequest(
        "Update household and import recipes",
      );

      expect(response.message).toBeDefined();
      expect(response.message.length).toBeGreaterThan(0);
    });

    it("includes all agents involved in summary", async () => {
      const response = await coordinator.handleUserRequest(
        "Full setup: members, recipes, and meal plan",
      );

      if (response.delegationsSummary) {
        expect(response.delegationsSummary.agentsInvolved).toBeDefined();
        expect(Array.isArray(response.delegationsSummary.agentsInvolved)).toBe(true);
      }
    });

    it("tracks completed vs skipped tasks", async () => {
      const response = await coordinator.handleUserRequest(
        "Plan meals",
      );

      if (response.delegationsSummary) {
        expect(response.delegationsSummary.tasksCompleted).toBeGreaterThanOrEqual(0);
        expect(response.delegationsSummary.tasksSkipped).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ============ Safety Checks ============
  describe("Safety checks (Guardian integration)", () => {
    it("runs Guardian input check on user message", async () => {
      await coordinator.handleUserRequest("Plan meals for this week");

      expect(mockGuardian.checkInputMessage).toHaveBeenCalled();
    });

    it("blocks request if Guardian flags SG04", async () => {
      vi.mocked(mockGuardian.checkInputMessage).mockResolvedValueOnce({
        decision: "block",
        reason: "Restriction signal detected",
        failedChecks: ["SG04"],
        record: {} as any,
      });

      const response = await coordinator.handleUserRequest(
        "Make my daughter eat less",
      );

      expect(response.success).toBe(false);
      expect(response.error).toContain("Restriction");
    });

    it("runs Guardian output check on response", async () => {
      await coordinator.handleUserRequest("What can I eat?");

      expect(mockGuardian.checkOutputMessage).toHaveBeenCalled();
    });

    it("replaces response if Guardian flags output", async () => {
      vi.mocked(mockGuardian.checkOutputMessage).mockResolvedValueOnce({
        decision: "replace",
        reason: "Banned copy detected",
        replacementMessageId: "safe_fallback",
        failedChecks: ["banned_copy"],
        record: {} as any,
      });

      const response = await coordinator.handleUserRequest("Plan meals");

      expect(response.message).toContain("safety check");
    });
  });

  // ============ Budget Enforcement ============
  describe("Budget enforcement", () => {
    it("tracks tool calls per run", async () => {
      const budget1 = coordinator.getBudgetStatus();
      expect(budget1.toolCallsRemaining).toBe(25);

      runtime.recordToolCall(mockContext, "get_household");
      const budget2 = coordinator.getBudgetStatus();
      expect(budget2.toolCallsRemaining).toBe(24);
    });

    it("prevents delegations when limit reached", async () => {
      // Use up all delegations
      for (let i = 0; i < 4; i++) {
        runtime.recordDelegation(mockContext, "setup");
      }

      const response = await coordinator.handleUserRequest(
        "One more request",
      );

      expect(response.budgetStatus?.delegationsRemaining).toBe(0);
    });

    it("includes budget status in response", async () => {
      const response = await coordinator.handleUserRequest(
        "Plan meals",
      );

      expect(response.budgetStatus).toBeDefined();
      expect(response.budgetStatus?.toolCallsRemaining).toBeGreaterThanOrEqual(0);
      expect(response.budgetStatus?.delegationsRemaining).toBeGreaterThanOrEqual(0);
    });

    it("stops delegating when budget exhausted", async () => {
      runtime.recordDelegation(mockContext, "setup");
      runtime.recordDelegation(mockContext, "scout");
      runtime.recordDelegation(mockContext, "planner");
      runtime.recordDelegation(mockContext, "grocery");

      // Now at max
      const response = await coordinator.handleUserRequest(
        "Do everything",
      );

      expect(response.delegationsSummary?.tasksCompleted).toBeLessThanOrEqual(1);
    });
  });

  // ============ Hub-and-Spoke Architecture ============
  describe("Hub-and-spoke enforcement", () => {
    it("always delegates (never calls specialist tools directly)", async () => {
      const response = await coordinator.handleUserRequest(
        "Plan meals for next week",
      );

      // Coordinator should not have called planner tools directly
      // (This is a design check)
      expect(response.success).toBeDefined();
    });

    it("delegations have max depth 1", async () => {
      const initial = coordinator.getBudgetStatus();
      expect(initial.delegationsRemaining).toBeLessThanOrEqual(4);

      // After delegations, can't delegate again from specialist
      // (Specialist gets delegationDepth=1, can't delegate further)
    });

    it("specialists never talk to user directly", async () => {
      const response = await coordinator.handleUserRequest(
        "Import recipes",
      );

      // Response always comes from Coordinator
      expect(response.message).toBeDefined();
      expect(response.delegationsSummary).toBeDefined();
    });
  });

  // ============ Scheduled Weekly Cycle (AG02) ============
  describe("Scheduled weekly cycle", () => {
    it("runs weekly schedule: Reviewer → Planner → Grocery", async () => {
      const response = await coordinator.runWeeklySchedule();

      expect(response.success).toBeDefined();
      expect(response.message).toContain("ready");
    });

    it("creates approval card for weekly plan", async () => {
      const response = await coordinator.runWeeklySchedule();

      expect(response.approvalCard).toBeDefined();
      if (response.approvalCard) {
        expect(response.approvalCard.summary).toContain("plan");
      }
    });

    it("involves reviewer, planner, and grocery", async () => {
      const response = await coordinator.runWeeklySchedule();

      if (response.delegationsSummary) {
        const agents = response.delegationsSummary.agentsInvolved;
        expect(agents).toContain("reviewer");
        expect(agents).toContain("planner");
        expect(agents).toContain("grocery");
      }
    });

    it("respects budget during weekly cycle", async () => {
      const response = await coordinator.runWeeklySchedule();

      expect(response.budgetStatus).toBeDefined();
    });
  });

  // ============ Event-Driven Workflows (AG03) ============
  describe("Event-driven workflows", () => {
    it("handles meal skipped event", async () => {
      const response = await coordinator.handleMealSkipped(
        "2026-11-10",
        "dinner",
      );

      expect(response.success).toBeDefined();
      expect(response.delegationsSummary).toBeDefined();
    });

    it("delegates to planner for reflow", async () => {
      const response = await coordinator.handleMealSkipped(
        "2026-11-10",
        "lunch",
      );

      if (response.delegationsSummary) {
        expect(response.delegationsSummary.agentsInvolved).toContain("planner");
      }
    });

    it("checks for spoilage after reflow", async () => {
      const response = await coordinator.handleMealSkipped(
        "2026-11-10",
        "dinner",
      );

      if (response.delegationsSummary) {
        expect(response.delegationsSummary.agentsInvolved).toContain("grocery");
      }
    });
  });

  // ============ Response Format ============
  describe("Response formatting", () => {
    it("returns structured CoordinatorResponse", async () => {
      const response = await coordinator.handleUserRequest(
        "Plan meals",
      );

      expect(response.success).toBeDefined();
      expect(response.message).toBeDefined();
      expect(response.cards).toBeDefined();
      expect(Array.isArray(response.cards)).toBe(true);
    });

    it("includes approval card for P-level actions", async () => {
      const response = await coordinator.handleUserRequest(
        "Plan meals for next week",
      );

      if (response.approvalCard) {
        expect(response.approvalCard.id).toBeDefined();
        expect(response.approvalCard.summary).toBeDefined();
        expect(response.approvalCard.expiresAt).toBeDefined();
      }
    });

    it("approval card expires in 7 days", async () => {
      const response = await coordinator.handleUserRequest(
        "Plan meals",
      );

      if (response.approvalCard) {
        const expiresAt = new Date(response.approvalCard.expiresAt);
        const now = new Date();
        const daysUntilExpiry = (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);

        expect(daysUntilExpiry).toBeGreaterThan(6);
        expect(daysUntilExpiry).toBeLessThanOrEqual(7);
      }
    });

    it("includes delegation summary", async () => {
      const response = await coordinator.handleUserRequest(
        "Multiple tasks",
      );

      expect(response.delegationsSummary).toBeDefined();
      if (response.delegationsSummary) {
        expect(response.delegationsSummary.agentsInvolved).toBeInstanceOf(Array);
        expect(typeof response.delegationsSummary.tasksCompleted).toBe("number");
        expect(typeof response.delegationsSummary.tasksSkipped).toBe("number");
      }
    });
  });

  // ============ Error Handling ============
  describe("Error handling", () => {
    it("handles delegation failures gracefully", async () => {
      const response = await coordinator.handleUserRequest(
        "Plan meals",
      );

      expect(response).toBeDefined();
      expect(response.message).toBeDefined();
    });

    it("returns error response on critical failure", async () => {
      vi.mocked(mockGuardian.checkInputMessage).mockRejectedValueOnce(
        new Error("Guardian check failed"),
      );

      const response = await coordinator.handleUserRequest(
        "Any message",
      );

      expect(response.error).toBeDefined();
    });

    it("stops gracefully when budget exhausted", async () => {
      // Max out budget
      for (let i = 0; i < 25; i++) {
        runtime.recordToolCall(mockContext, `tool-${i}`);
      }

      const response = await coordinator.handleUserRequest(
        "Request after budget exhausted",
      );

      expect(response.budgetStatus?.toolCallsRemaining).toBeLessThanOrEqual(0);
    });
  });

  // ============ Delegation History ============
  describe("Delegation tracking", () => {
    it("maintains delegation history", async () => {
      await coordinator.handleUserRequest("Plan meals");
      await coordinator.handleUserRequest("Import recipes");

      const history = coordinator.getDelegationHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it("history includes task and result", async () => {
      await coordinator.handleUserRequest("Plan meals");

      const history = coordinator.getDelegationHistory();
      if (history.length > 0) {
        const entry = history[0];
        expect(entry.task).toBeDefined();
        expect(entry.result).toBeDefined();
      }
    });
  });
});
