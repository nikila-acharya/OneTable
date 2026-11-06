/**
 * M4 Approval Inbox — Action logging, status tracking, and undo/rollback capability.
 * Tracks all A-level (approval) decisions from Coordinator and agent cards.
 * Implements Map-based store for M4 (in-memory; DB in M5).
 * Supports: logging actions, tracking status, undoing/rolling back, expiry escalation.
 */

/**
 * Action types that go through approval
 */
export type ActionType = 'plan_lock' | 'recipe_add' | 'pref_update' | 'swap_meal' | 'reflow_week' | 'grocery_send';

/**
 * Status of an approval action
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/**
 * User response/decision on an approval action
 */
export type UserDecision = 'approve' | 'reject' | 'edit';

/**
 * Log entry for an approval action.
 * Immutable once created; status and decisions are tracked separately.
 */
export interface ApprovalLogEntry {
  id: string;
  timestamp: Date;
  agentId: string;
  actionType: ActionType;
  content: {
    preview: string;
    summary: string;
    diff?: string;
  };
  status: ApprovalStatus;
  userDecision?: UserDecision;
  approvedAt?: Date;
  userEmail?: string;
  escalated?: boolean; // true if held >24h and flagged for human review
}

/**
 * State to rollback for an action.
 * Contains enough information to undo the action's effects.
 */
export interface RollbackState {
  actionId: string;
  previousState: Record<string, unknown>;
  rollbackFn?: () => Promise<void>;
}

/**
 * ApprovalInbox class: Maps-based store for approval actions (M4 in-memory).
 * Thread-safe map operations for concurrent approvals and undo.
 */
export class ApprovalInbox {
  private log: Map<string, ApprovalLogEntry>;
  private rollbackStates: Map<string, RollbackState>;
  private readonly createdAt: Date;

  constructor() {
    this.log = new Map();
    this.rollbackStates = new Map();
    this.createdAt = new Date();
  }

  /**
   * Log a new action that requires approval.
   * Returns the generated action ID.
   */
  logAction(
    agentId: string,
    actionType: ActionType,
    content: {
      preview: string;
      summary: string;
      diff?: string;
    },
    rollbackState?: RollbackState
  ): string {
    const id = this.generateId();
    const entry: ApprovalLogEntry = {
      id,
      timestamp: new Date(),
      agentId,
      actionType,
      content,
      status: 'pending',
    };

    this.log.set(id, entry);

    if (rollbackState) {
      this.rollbackStates.set(id, rollbackState);
    }

    return id;
  }

  /**
   * Get a specific approval entry by ID.
   */
  getEntry(id: string): ApprovalLogEntry | undefined {
    return this.log.get(id);
  }

  /**
   * Get all pending approvals.
   */
  getPending(): ApprovalLogEntry[] {
    return Array.from(this.log.values()).filter(
      (entry) => entry.status === 'pending'
    );
  }

  /**
   * Get all entries for an agent.
   */
  getEntriesByAgent(agentId: string): ApprovalLogEntry[] {
    return Array.from(this.log.values()).filter(
      (entry) => entry.agentId === agentId
    );
  }

  /**
   * Get all entries since a timestamp.
   */
  getEntriesSince(since: Date): ApprovalLogEntry[] {
    return Array.from(this.log.values()).filter(
      (entry) => entry.timestamp >= since
    );
  }

  /**
   * Approve an action. Updates status and sets userDecision.
   * Returns true if successful, false if not found or already decided.
   */
  approve(
    id: string,
    userEmail?: string,
    decision: UserDecision = 'approve'
  ): boolean {
    const entry = this.log.get(id);
    if (!entry) {
      return false;
    }

    if (entry.status !== 'pending') {
      return false;
    }

    entry.status = 'approved';
    entry.userDecision = decision;
    entry.approvedAt = new Date();
    entry.userEmail = userEmail;

    return true;
  }

  /**
   * Reject an action. Updates status and sets userDecision.
   * Returns true if successful, false if not found or already decided.
   */
  reject(
    id: string,
    userEmail?: string,
    decision: UserDecision = 'reject'
  ): boolean {
    const entry = this.log.get(id);
    if (!entry) {
      return false;
    }

    if (entry.status !== 'pending') {
      return false;
    }

    entry.status = 'rejected';
    entry.userDecision = decision;
    entry.userEmail = userEmail;

    return true;
  }

  /**
   * Undo an approved action if it has rollback state.
   * Returns true if successful, false if not found or no rollback available.
   * Undo available for 7 days (504 hours).
   */
  async undo(id: string): Promise<boolean> {
    const entry = this.log.get(id);
    if (!entry) {
      return false;
    }

    // Check if action is within 7-day window
    const now = new Date();
    const hoursSinceApproval = entry.approvedAt
      ? (now.getTime() - entry.approvedAt.getTime()) / (1000 * 60 * 60)
      : 0;

    if (hoursSinceApproval > 7 * 24) {
      return false; // Too old to undo
    }

    const rollbackState = this.rollbackStates.get(id);
    if (!rollbackState) {
      return false;
    }

    // Execute rollback function if available
    if (rollbackState.rollbackFn) {
      try {
        await rollbackState.rollbackFn();
      } catch (error) {
        console.error(`Rollback failed for action ${id}:`, error);
        return false;
      }
    }

    // Mark as undone by creating a new entry tracking the undo
    entry.status = 'rejected';
    entry.userDecision = 'reject'; // Treat undo as rejection

    return true;
  }

  /**
   * Check for and mark actions held >24h as escalated.
   * Returns list of escalated action IDs.
   */
  checkForEscalation(): string[] {
    const now = new Date();
    const escalated: string[] = [];

    for (const [id, entry] of this.log.entries()) {
      if (entry.status === 'pending' && !entry.escalated) {
        const hoursSincePending = (now.getTime() - entry.timestamp.getTime()) / (1000 * 60 * 60);

        if (hoursSincePending > 24) {
          entry.escalated = true;
          escalated.push(id);
        }
      }
    }

    return escalated;
  }

  /**
   * Get all escalated actions (pending >24h).
   */
  getEscalated(): ApprovalLogEntry[] {
    return Array.from(this.log.values()).filter(
      (entry) => entry.escalated === true
    );
  }

  /**
   * Clear an entry (remove from log and rollback state).
   * Returns true if found and cleared, false otherwise.
   */
  clearEntry(id: string): boolean {
    const deleted = this.log.delete(id);
    if (deleted) {
      this.rollbackStates.delete(id);
    }
    return deleted;
  }

  /**
   * Get entire log for export/persistence.
   */
  getAllEntries(): ApprovalLogEntry[] {
    return Array.from(this.log.values());
  }

  /**
   * Get statistics about the inbox.
   */
  getStats() {
    const entries = Array.from(this.log.values());
    const now = new Date();

    return {
      total: entries.length,
      pending: entries.filter((e) => e.status === 'pending').length,
      approved: entries.filter((e) => e.status === 'approved').length,
      rejected: entries.filter((e) => e.status === 'rejected').length,
      escalated: entries.filter((e) => e.escalated).length,
      byActionType: Array.from(
        entries.reduce((acc, e) => {
          acc.set(e.actionType, (acc.get(e.actionType) || 0) + 1);
          return acc;
        }, new Map<ActionType, number>())
      ).reduce(
        (acc, [type, count]) => {
          acc[type] = count;
          return acc;
        },
        {} as Record<ActionType, number>
      ),
      averageTimeToApproval: this.calculateAverageTimeToApproval(),
      createdAt: this.createdAt,
    };
  }

  /**
   * Private helper: calculate average time from creation to approval.
   */
  private calculateAverageTimeToApproval(): number {
    const approvedEntries = Array.from(this.log.values()).filter(
      (e) => e.status === 'approved' && e.approvedAt
    );

    if (approvedEntries.length === 0) {
      return 0;
    }

    const totalTime = approvedEntries.reduce((sum, e) => {
      const timeDiff = (e.approvedAt!.getTime() - e.timestamp.getTime()) / 1000; // seconds
      return sum + timeDiff;
    }, 0);

    return Math.round(totalTime / approvedEntries.length);
  }

  /**
   * Private helper: generate unique ID.
   */
  private generateId(): string {
    return `approval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clear entire inbox (for testing).
   */
  clear(): void {
    this.log.clear();
    this.rollbackStates.clear();
  }

  /**
   * Get rollback state for an action.
   */
  getRollbackState(id: string): RollbackState | undefined {
    return this.rollbackStates.get(id);
  }

  /**
   * Concurrent approval support: lock an entry for approval to prevent race conditions.
   * Returns true if lock acquired, false if already locked.
   */
  private readonly locks = new Map<string, boolean>();

  tryLock(id: string): boolean {
    if (this.locks.has(id)) {
      return false;
    }
    this.locks.set(id, true);
    return true;
  }

  unlock(id: string): void {
    this.locks.delete(id);
  }
}
