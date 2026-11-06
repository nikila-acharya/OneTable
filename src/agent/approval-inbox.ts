/**
 * WP-4.4 — Approval Inbox, Action Log, and Undo Manager (AG05)
 * Approval inbox: one place for every P-level proposal, shown as card with summary, diff, and approve/decline buttons.
 * Action log: every tool call (time, tool, inputs summary, result summary, run ID, mode).
 * Undo: A-level actions reversible for 7 days.
 */

import type { ToolPermissionLevel } from "./tool-registry";

/**
 * Approval card in the inbox.
 */
export interface ApprovalCard {
  id: string;
  householdId: string;
  createdAt: string;
  expiresAt: string; // 7 days from creation
  proposedBy: string; // Agent role
  tool: string; // P-level tool name
  mode: "conversational" | "scheduled" | "event";
  runId: string;

  // User-facing display
  summary: string; // Plain text: "Thursday dinner: Chicken tikka → Chana masala"
  diff: Record<string, unknown>; // Before/after values

  // Status
  status: "pending" | "approved" | "declined" | "expired";
  approvedAt?: string;
  approvedBy?: string; // User ID
  declinedAt?: string;
  declinedBy?: string;
  declineReason?: string;

  // Editing support
  editedProposal?: Record<string, unknown>; // If user edited before approving
}

/**
 * Action log entry for every tool call.
 */
export interface ActionLogEntry {
  id: string;
  householdId: string;
  timestamp: string;
  runId: string;
  parentRunId?: string; // For delegated tasks
  mode: "conversational" | "scheduled" | "event";
  agentRole: string;
  tool: string;
  permissionLevel: ToolPermissionLevel;

  // Inputs/outputs (references only, never raw health data)
  inputsSummary: string; // e.g., "Plan 2026-11-10 to 2026-11-16"
  resultSummary: string; // e.g., "7 meals planned"

  tokensUsed: number;
  durationMs: number;

  // A-level actions track undo state
  reversible: boolean; // true for A-level
  previousState?: Record<string, unknown>; // For undo
  undoneAt?: string; // When (if) this action was undone
  undoneByActionId?: string; // Undo action reference
}

/**
 * Approval Inbox — stores and manages approval cards.
 */
export class ApprovalInbox {
  private cards: Map<string, ApprovalCard> = new Map();

  /**
   * Add a new approval card.
   */
  addCard(card: Omit<ApprovalCard, "id" | "createdAt" | "expiresAt" | "status">): ApprovalCard {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const fullCard: ApprovalCard = {
      ...card,
      id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "pending",
    };

    this.cards.set(fullCard.id, fullCard);
    return fullCard;
  }

  /**
   * Get all pending approvals for a household.
   */
  getPending(householdId: string): ApprovalCard[] {
    return Array.from(this.cards.values()).filter(
      (c) =>
        c.householdId === householdId &&
        c.status === "pending" &&
        new Date(c.expiresAt) > new Date(),
    );
  }

  /**
   * Get all approval cards for a household (including expired/approved).
   */
  getAll(householdId: string): ApprovalCard[] {
    return Array.from(this.cards.values()).filter((c) => c.householdId === householdId);
  }

  /**
   * Approve an approval card.
   */
  approve(
    cardId: string,
    userId: string,
    editedProposal?: Record<string, unknown>,
  ): ApprovalCard | null {
    const card = this.cards.get(cardId);
    if (!card) return null;
    if (card.status !== "pending") return null;
    if (new Date(card.expiresAt) < new Date()) {
      card.status = "expired";
      return card;
    }

    card.status = "approved";
    card.approvedAt = new Date().toISOString();
    card.approvedBy = userId;
    if (editedProposal) {
      card.editedProposal = editedProposal;
    }

    return card;
  }

  /**
   * Decline an approval card.
   */
  decline(cardId: string, userId: string, reason?: string): ApprovalCard | null {
    const card = this.cards.get(cardId);
    if (!card) return null;
    if (card.status !== "pending") return null;

    card.status = "declined";
    card.declinedAt = new Date().toISOString();
    card.declinedBy = userId;
    card.declineReason = reason;

    return card;
  }

  /**
   * Check if a card has expired.
   */
  isExpired(cardId: string): boolean {
    const card = this.cards.get(cardId);
    if (!card) return false;
    return new Date(card.expiresAt) < new Date();
  }

  /**
   * Auto-expire old cards.
   */
  expireOldCards(): { expiredCount: number; cardsRemaining: number } {
    const now = new Date();
    let expiredCount = 0;

    for (const card of this.cards.values()) {
      if (
        card.status === "pending" &&
        new Date(card.expiresAt) < now
      ) {
        card.status = "expired";
        expiredCount++;
      }
    }

    return { expiredCount, cardsRemaining: this.cards.size };
  }

  /**
   * Get card by ID.
   */
  getCard(cardId: string): ApprovalCard | undefined {
    return this.cards.get(cardId);
  }

  /**
   * Clear all cards (for testing).
   */
  clear(): void {
    this.cards.clear();
  }
}

/**
 * Action Log — stores all tool calls with audit trail.
 */
export class ActionLog {
  private entries: ActionLogEntry[] = [];

  /**
   * Record a tool call.
   */
  recordCall(
    entry: Omit<ActionLogEntry, "id" | "timestamp">,
  ): ActionLogEntry {
    const fullEntry: ActionLogEntry = {
      ...entry,
      id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
    };

    this.entries.push(fullEntry);
    return fullEntry;
  }

  /**
   * Get all entries for a household.
   */
  getAll(householdId: string, limit: number = 100): ActionLogEntry[] {
    return this.entries
      .filter((e) => e.householdId === householdId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Get entries by run ID.
   */
  getByRun(runId: string): ActionLogEntry[] {
    return this.entries.filter((e) => e.runId === runId);
  }

  /**
   * Get reversible (A-level) entries.
   */
  getReversible(householdId: string, maxAgeDays: number = 7): ActionLogEntry[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    return this.entries.filter(
      (e) =>
        e.householdId === householdId &&
        e.reversible &&
        !e.undoneAt &&
        new Date(e.timestamp) > cutoff,
    );
  }

  /**
   * Get entry by ID.
   */
  getEntry(entryId: string): ActionLogEntry | undefined {
    return this.entries.find((e) => e.id === entryId);
  }

  /**
   * Mark an entry as undone.
   */
  markUndone(entryId: string, undoActionId: string): boolean {
    const entry = this.entries.find((e) => e.id === entryId);
    if (!entry) return false;
    if (!entry.reversible) return false;
    if (entry.undoneAt) return false; // Already undone

    entry.undoneAt = new Date().toISOString();
    entry.undoneByActionId = undoActionId;
    return true;
  }

  /**
   * Clear all entries (for testing).
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get total entries.
   */
  count(): number {
    return this.entries.length;
  }
}

/**
 * Undo Manager — handles reversions of A-level actions.
 */
export class UndoManager {
  constructor(
    private actionLog: ActionLog,
    private approval: ApprovalInbox,
  ) {}

  /**
   * Get undoable actions for a household (A-level, within 7 days).
   */
  getUndoable(householdId: string): ActionLogEntry[] {
    return this.actionLog.getReversible(householdId, 7);
  }

  /**
   * Undo an action by reverting to its previous state.
   * This creates a new action log entry for the undo itself.
   */
  undo(actionId: string, userId: string): { success: boolean; reason?: string; newActionId?: string } {
    const action = this.actionLog.getEntry(actionId);

    if (!action) {
      return { success: false, reason: "Action not found" };
    }

    if (!action.reversible) {
      return { success: false, reason: "Action is not reversible (P-level)" };
    }

    if (action.undoneAt) {
      return { success: false, reason: "Action already undone" };
    }

    const maxAgeDays = 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    if (new Date(action.timestamp) < cutoff) {
      return { success: false, reason: "Action is too old to undo (7+ days)" };
    }

    if (!action.previousState) {
      return { success: false, reason: "No previous state recorded for this action" };
    }

    // Record the undo action
    const undoActionId = `undo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.actionLog.recordCall({
      householdId: action.householdId,
      runId: `undo-${Date.now()}`,
      mode: "conversational",
      agentRole: "user",
      tool: `undo_${action.tool}`,
      permissionLevel: "A",
      inputsSummary: `Undo of ${action.tool} (action ${actionId})`,
      resultSummary: `Reverted to previous state`,
      tokensUsed: 0,
      durationMs: 0,
      reversible: true,
    });

    // Mark original action as undone
    this.actionLog.markUndone(actionId, undoActionId);

    return { success: true, newActionId: undoActionId };
  }

  /**
   * Validate undo is possible (permission check).
   */
  canUndo(actionId: string, userId: string): { allowed: boolean; reason?: string } {
    const action = this.actionLog.getEntry(actionId);

    if (!action) {
      return { allowed: false, reason: "Action not found" };
    }

    if (!action.reversible) {
      return { allowed: false, reason: "P-level actions cannot be undone" };
    }

    if (action.undoneAt) {
      return { allowed: false, reason: "Already undone" };
    }

    const maxAgeDays = 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    if (new Date(action.timestamp) < cutoff) {
      return { allowed: false, reason: "Action is too old to undo" };
    }

    return { allowed: true };
  }
}

/**
 * AG05 Combined Interface — approval inbox + action log + undo.
 */
export class AG05Manager {
  private approval: ApprovalInbox;
  private actionLog: ActionLog;
  private undo: UndoManager;

  constructor() {
    this.approval = new ApprovalInbox();
    this.actionLog = new ActionLog();
    this.undo = new UndoManager(this.actionLog, this.approval);
  }

  /**
   * Get approval inbox for household.
   */
  getApprovalInbox() {
    return this.approval;
  }

  /**
   * Get action log interface.
   */
  getActionLog() {
    return this.actionLog;
  }

  /**
   * Get undo manager interface.
   */
  getUndoManager() {
    return this.undo;
  }

  /**
   * Get household dashboard (all pending approvals + recent actions).
   */
  getDashboard(householdId: string): {
    pendingApprovals: ApprovalCard[];
    recentActions: ActionLogEntry[];
    undoable: ActionLogEntry[];
  } {
    return {
      pendingApprovals: this.approval.getPending(householdId),
      recentActions: this.actionLog.getAll(householdId, 20),
      undoable: this.undo.getUndoable(householdId),
    };
  }

  /**
   * Clear all data (for testing).
   */
  clear(): void {
    this.approval.clear();
    this.actionLog.clear();
  }
}
