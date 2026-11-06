/**
 * WP-4.4 — Approval Inbox, Action Log, and Undo Tests (AG05)
 * Approval cards, action log entries, undo reversions, dashboard.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AG05Manager,
  ApprovalInbox,
  ActionLog,
  UndoManager,
  type ApprovalCard,
  type ActionLogEntry,
} from "./approval-inbox";

describe("WP-4.4 AG05 Manager (Approval Inbox, Action Log, Undo)", () => {
  let manager: AG05Manager;
  let approval: ApprovalInbox;
  let actionLog: ActionLog;
  let undo: UndoManager;

  const householdId = "household-001";
  const userId = "user-123";

  beforeEach(() => {
    manager = new AG05Manager();
    approval = manager.getApprovalInbox();
    actionLog = manager.getActionLog();
    undo = manager.getUndoManager();
  });

  // ============ Approval Inbox ============
  describe("Approval Inbox", () => {
    it("creates an approval card with 7-day expiry", () => {
      const card = approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-001",
        summary: "Thursday dinner: Chicken tikka → Chana masala",
        diff: {
          thursday_dinner: {
            before: "Chicken tikka",
            after: "Chana masala",
          },
        },
      });

      expect(card.id).toBeDefined();
      expect(card.createdAt).toBeDefined();
      expect(card.expiresAt).toBeDefined();
      expect(card.status).toBe("pending");

      const created = new Date(card.createdAt);
      const expires = new Date(card.expiresAt);
      const days = (expires.getTime() - created.getTime()) / (24 * 60 * 60 * 1000);

      expect(days).toBe(7);
    });

    it("retrieves pending approvals for household", () => {
      approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-001",
        summary: "Plan",
        diff: {},
      });

      approval.addCard({
        householdId: "other-household",
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-002",
        summary: "Other plan",
        diff: {},
      });

      const pending = approval.getPending(householdId);
      expect(pending).toHaveLength(1);
      expect(pending[0].householdId).toBe(householdId);
    });

    it("approves a card", () => {
      const card = approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-001",
        summary: "Plan",
        diff: {},
      });

      const approved = approval.approve(card.id, userId);

      expect(approved).toBeDefined();
      expect(approved!.status).toBe("approved");
      expect(approved!.approvedBy).toBe(userId);
      expect(approved!.approvedAt).toBeDefined();
    });

    it("declines a card", () => {
      const card = approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-001",
        summary: "Plan",
        diff: {},
      });

      const declined = approval.decline(card.id, userId, "Too many swaps");

      expect(declined).toBeDefined();
      expect(declined!.status).toBe("declined");
      expect(declined!.declinedBy).toBe(userId);
      expect(declined!.declineReason).toBe("Too many swaps");
    });

    it("allows user to edit before approving", () => {
      const card = approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-001",
        summary: "Plan",
        diff: { thursday_dinner: "Chicken tikka" },
      });

      const edited = { thursday_dinner: "Butter chicken" };
      const approved = approval.approve(card.id, userId, edited);

      expect(approved!.editedProposal).toEqual(edited);
      expect(approved!.status).toBe("approved");
    });

    it("cannot approve non-pending card", () => {
      const card = approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-001",
        summary: "Plan",
        diff: {},
      });

      approval.approve(card.id, userId);
      const retry = approval.approve(card.id, userId);

      expect(retry).toBeNull();
    });

    it("detects expired cards", () => {
      const card = approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-001",
        summary: "Plan",
        diff: {},
      });

      // Mock expiry by directly manipulating the card
      const futureCard = approval.getCard(card.id);
      if (futureCard) {
        futureCard.expiresAt = new Date(Date.now() - 1000).toISOString();
      }

      expect(approval.isExpired(card.id)).toBe(true);
    });

    it("auto-expires old pending cards", () => {
      const card1 = approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-001",
        summary: "Plan 1",
        diff: {},
      });

      const card2 = approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-002",
        summary: "Plan 2",
        diff: {},
      });

      // Mock expiry
      const oldCard = approval.getCard(card1.id);
      if (oldCard) {
        oldCard.expiresAt = new Date(Date.now() - 1000).toISOString();
      }

      const result = approval.expireOldCards();

      expect(result.expiredCount).toBe(1);
      expect(approval.getCard(card1.id)!.status).toBe("expired");
      expect(approval.getCard(card2.id)!.status).toBe("pending");
    });

    it("retrieves all cards for household", () => {
      approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-001",
        summary: "Plan",
        diff: {},
      });

      const all = approval.getAll(householdId);
      expect(all).toHaveLength(1);
    });
  });

  // ============ Action Log ============
  describe("Action Log", () => {
    it("records a tool call", () => {
      const entry = actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "planner",
        tool: "draft_plan",
        permissionLevel: "P",
        inputsSummary: "Plan 2026-11-10 to 2026-11-16",
        resultSummary: "7 meals planned",
        tokensUsed: 1200,
        durationMs: 3400,
        reversible: false,
      });

      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.tool).toBe("draft_plan");
      expect(entry.agentRole).toBe("planner");
    });

    it("retrieves entries for household (sorted by recency)", () => {
      actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "planner",
        tool: "draft_plan",
        permissionLevel: "P",
        inputsSummary: "Plan 1",
        resultSummary: "7 meals",
        tokensUsed: 1000,
        durationMs: 1000,
        reversible: false,
      });

      actionLog.recordCall({
        householdId,
        runId: "run-002",
        mode: "conversational",
        agentRole: "grocery",
        tool: "draft_grocery_list",
        permissionLevel: "P",
        inputsSummary: "List from plan",
        resultSummary: "42 items",
        tokensUsed: 800,
        durationMs: 2000,
        reversible: false,
      });

      const all = actionLog.getAll(householdId);
      expect(all).toHaveLength(2);
      // Most recent first
      expect(all[0].tool).toBe("draft_grocery_list");
      expect(all[1].tool).toBe("draft_plan");
    });

    it("retrieves entries by run ID", () => {
      const runId = "run-001";

      actionLog.recordCall({
        householdId,
        runId,
        mode: "conversational",
        agentRole: "planner",
        tool: "draft_plan",
        permissionLevel: "P",
        inputsSummary: "Plan",
        resultSummary: "Planned",
        tokensUsed: 1000,
        durationMs: 1000,
        reversible: false,
      });

      actionLog.recordCall({
        householdId,
        runId: "run-002",
        mode: "conversational",
        agentRole: "planner",
        tool: "another_tool",
        permissionLevel: "A",
        inputsSummary: "Other",
        resultSummary: "Done",
        tokensUsed: 500,
        durationMs: 500,
        reversible: true,
      });

      const byRun = actionLog.getByRun(runId);
      expect(byRun).toHaveLength(1);
      expect(byRun[0].tool).toBe("draft_plan");
    });

    it("retrieves reversible (A-level) entries within 7 days", () => {
      actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "setup",
        tool: "update_member",
        permissionLevel: "A",
        inputsSummary: "Updated Leo",
        resultSummary: "Success",
        tokensUsed: 100,
        durationMs: 500,
        reversible: true,
      });

      actionLog.recordCall({
        householdId,
        runId: "run-002",
        mode: "conversational",
        agentRole: "planner",
        tool: "draft_plan",
        permissionLevel: "P",
        inputsSummary: "Draft",
        resultSummary: "Planned",
        tokensUsed: 1000,
        durationMs: 1000,
        reversible: false,
      });

      const reversible = actionLog.getReversible(householdId);
      expect(reversible).toHaveLength(1);
      expect(reversible[0].tool).toBe("update_member");
    });

    it("marks entry as undone", () => {
      const entry = actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "setup",
        tool: "update_member",
        permissionLevel: "A",
        inputsSummary: "Updated",
        resultSummary: "Success",
        tokensUsed: 100,
        durationMs: 500,
        reversible: true,
      });

      const marked = actionLog.markUndone(entry.id, "undo-001");
      expect(marked).toBe(true);

      const retrieved = actionLog.getEntry(entry.id);
      expect(retrieved!.undoneAt).toBeDefined();
      expect(retrieved!.undoneByActionId).toBe("undo-001");
    });

    it("counts entries", () => {
      expect(actionLog.count()).toBe(0);

      actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "planner",
        tool: "draft_plan",
        permissionLevel: "P",
        inputsSummary: "Plan",
        resultSummary: "Planned",
        tokensUsed: 1000,
        durationMs: 1000,
        reversible: false,
      });

      expect(actionLog.count()).toBe(1);
    });

    it("never logs raw health data (references only)", () => {
      const entry = actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "planner",
        tool: "draft_plan",
        permissionLevel: "P",
        inputsSummary: "Member m1 (ref: health_profile_001)", // Reference, not values
        resultSummary: "7 meals planned",
        tokensUsed: 1000,
        durationMs: 1000,
        reversible: false,
      });

      expect(entry.inputsSummary).toContain("ref:");
      expect(entry.inputsSummary).not.toContain("calories");
      expect(entry.inputsSummary).not.toContain("age");
    });
  });

  // ============ Undo Manager ============
  describe("Undo Manager", () => {
    it("lists undoable actions (A-level, within 7 days)", () => {
      actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "setup",
        tool: "update_member",
        permissionLevel: "A",
        inputsSummary: "Updated Leo",
        resultSummary: "Success",
        tokensUsed: 100,
        durationMs: 500,
        reversible: true,
      });

      actionLog.recordCall({
        householdId,
        runId: "run-002",
        mode: "conversational",
        agentRole: "planner",
        tool: "draft_plan",
        permissionLevel: "P",
        inputsSummary: "Draft",
        resultSummary: "Planned",
        tokensUsed: 1000,
        durationMs: 1000,
        reversible: false,
      });

      const undoable = undo.getUndoable(householdId);
      expect(undoable).toHaveLength(1);
      expect(undoable[0].tool).toBe("update_member");
    });

    it("checks if undo is allowed", () => {
      const entry = actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "setup",
        tool: "update_member",
        permissionLevel: "A",
        inputsSummary: "Updated Leo",
        resultSummary: "Success",
        tokensUsed: 100,
        durationMs: 500,
        reversible: true,
      });

      const result = undo.canUndo(entry.id, userId);
      expect(result.allowed).toBe(true);
    });

    it("rejects undo for P-level actions", () => {
      const entry = actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "planner",
        tool: "draft_plan",
        permissionLevel: "P",
        inputsSummary: "Draft",
        resultSummary: "Planned",
        tokensUsed: 1000,
        durationMs: 1000,
        reversible: false,
      });

      const result = undo.canUndo(entry.id, userId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("cannot be undone");
    });

    it("rejects undo for already-undone actions", () => {
      const entry = actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "setup",
        tool: "update_member",
        permissionLevel: "A",
        inputsSummary: "Updated",
        resultSummary: "Success",
        tokensUsed: 100,
        durationMs: 500,
        reversible: true,
      });

      undo.undo(entry.id, userId);

      const result = undo.canUndo(entry.id, userId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Already undone");
    });

    it("rejects undo for actions older than 7 days", () => {
      const entry = actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "setup",
        tool: "update_member",
        permissionLevel: "A",
        inputsSummary: "Updated",
        resultSummary: "Success",
        tokensUsed: 100,
        durationMs: 500,
        reversible: true,
      });

      // Mock old timestamp
      const logEntry = actionLog.getEntry(entry.id);
      if (logEntry) {
        logEntry.timestamp = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      }

      const result = undo.canUndo(entry.id, userId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("too old");
    });

    it("performs undo and creates undo action log entry", () => {
      const entry = actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "setup",
        tool: "update_member",
        permissionLevel: "A",
        inputsSummary: "Updated Leo",
        resultSummary: "Success",
        tokensUsed: 100,
        durationMs: 500,
        reversible: true,
        previousState: { name: "Leo", age: 10 }, // Previous state
      });

      const result = undo.undo(entry.id, userId);

      expect(result.success).toBe(true);
      expect(result.newActionId).toBeDefined();

      // Check original is marked undone
      const original = actionLog.getEntry(entry.id);
      expect(original!.undoneAt).toBeDefined();
      expect(original!.undoneByActionId).toBe(result.newActionId);

      // Check undo action is logged
      const undoAction = actionLog.getEntry(result.newActionId!);
      expect(undoAction).toBeDefined();
      expect(undoAction!.tool).toBe("undo_update_member");
    });

    it("rejects undo for missing previous state", () => {
      const entry = actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "setup",
        tool: "update_member",
        permissionLevel: "A",
        inputsSummary: "Updated",
        resultSummary: "Success",
        tokensUsed: 100,
        durationMs: 500,
        reversible: true,
        // No previousState
      });

      const result = undo.undo(entry.id, userId);

      expect(result.success).toBe(false);
      expect(result.reason).toContain("No previous state");
    });
  });

  // ============ Dashboard ============
  describe("Dashboard", () => {
    it("returns pending approvals, recent actions, and undoable actions", () => {
      // Add approval
      approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-001",
        summary: "Plan",
        diff: {},
      });

      // Add action
      actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "planner",
        tool: "draft_plan",
        permissionLevel: "P",
        inputsSummary: "Plan",
        resultSummary: "Planned",
        tokensUsed: 1000,
        durationMs: 1000,
        reversible: false,
      });

      // Add undoable action
      actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "setup",
        tool: "update_member",
        permissionLevel: "A",
        inputsSummary: "Updated",
        resultSummary: "Success",
        tokensUsed: 100,
        durationMs: 500,
        reversible: true,
      });

      const dashboard = manager.getDashboard(householdId);

      expect(dashboard.pendingApprovals).toHaveLength(1);
      expect(dashboard.recentActions.length).toBeGreaterThan(0);
      expect(dashboard.undoable).toHaveLength(1);
    });

    it("limits recent actions to 20 by default", () => {
      // Add 30 actions
      for (let i = 0; i < 30; i++) {
        actionLog.recordCall({
          householdId,
          runId: `run-${i}`,
          mode: "conversational",
          agentRole: "planner",
          tool: "draft_plan",
          permissionLevel: "P",
          inputsSummary: `Plan ${i}`,
          resultSummary: `Planned ${i}`,
          tokensUsed: 1000,
          durationMs: 1000,
          reversible: false,
        });
      }

      const dashboard = manager.getDashboard(householdId);
      expect(dashboard.recentActions).toHaveLength(20);
    });
  });

  // ============ Integration ============
  describe("Full workflow", () => {
    it("creates approval → user approves → action logged", () => {
      // 1. Planner drafts plan (creates approval card)
      const card = approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-001",
        summary: "Thursday dinner: Chicken tikka → Chana masala",
        diff: { thursday_dinner: "Chana masala" },
      });

      expect(card.status).toBe("pending");

      // 2. User approves it
      const approved = approval.approve(card.id, userId);
      expect(approved!.status).toBe("approved");

      // 3. Tool is executed and logged
      const action = actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "planner",
        tool: "apply_plan",
        permissionLevel: "A",
        inputsSummary: "Applied approved plan",
        resultSummary: "Plan applied",
        tokensUsed: 500,
        durationMs: 1000,
        reversible: true,
        previousState: { thursday_dinner: "Chicken tikka" },
      });

      expect(action.permissionLevel).toBe("A");

      // 4. User can later undo
      const undoResult = undo.undo(action.id, userId);
      expect(undoResult.success).toBe(true);
    });

    it("tracks full run lifecycle", () => {
      // Run starts
      const runId = "run-001";

      // Tool 1: draft_plan (P-level, creates approval)
      const approval1 = approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId,
        summary: "Plan drafted",
        diff: {},
      });

      // Log tool call
      const logEntry1 = actionLog.recordCall({
        householdId,
        runId,
        mode: "conversational",
        agentRole: "planner",
        tool: "draft_plan",
        permissionLevel: "P",
        inputsSummary: "Draft",
        resultSummary: "Planned",
        tokensUsed: 1000,
        durationMs: 1500,
        reversible: false,
      });

      expect(logEntry1.runId).toBe(runId);

      // User approves
      approval.approve(approval1.id, userId);

      // Tool 2: apply_plan (A-level, executable)
      const logEntry2 = actionLog.recordCall({
        householdId,
        runId,
        mode: "conversational",
        agentRole: "planner",
        tool: "apply_plan",
        permissionLevel: "A",
        inputsSummary: "Approved plan applied",
        resultSummary: "Applied",
        tokensUsed: 200,
        durationMs: 800,
        reversible: true,
        previousState: { plan: "old" },
      });

      // Check run history
      const runEntries = actionLog.getByRun(runId);
      expect(runEntries).toHaveLength(2);
      expect(runEntries.map((e) => e.tool)).toContain("draft_plan");
      expect(runEntries.map((e) => e.tool)).toContain("apply_plan");
    });
  });

  // ============ Cleanup ============
  describe("Data management", () => {
    it("clears all data for testing", () => {
      approval.addCard({
        householdId,
        proposedBy: "planner",
        tool: "draft_plan",
        mode: "conversational",
        runId: "run-001",
        summary: "Plan",
        diff: {},
      });

      actionLog.recordCall({
        householdId,
        runId: "run-001",
        mode: "conversational",
        agentRole: "planner",
        tool: "draft_plan",
        permissionLevel: "P",
        inputsSummary: "Draft",
        resultSummary: "Planned",
        tokensUsed: 1000,
        durationMs: 1000,
        reversible: false,
      });

      manager.clear();

      expect(actionLog.count()).toBe(0);
      expect(approval.getPending(householdId)).toHaveLength(0);
    });
  });
});
