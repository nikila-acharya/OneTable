/**
 * Approval Inbox tests — comprehensive coverage for action logging, status tracking,
 * undo/rollback, concurrent approvals, and expiry escalation.
 * 14+ tests with Vitest + fast-check property-based safety where applicable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ApprovalInbox,
  ApprovalLogEntry,
  ActionType,
  ApprovalStatus,
  RollbackState,
} from './index';

describe('ApprovalInbox', () => {
  let inbox: ApprovalInbox;

  beforeEach(() => {
    inbox = new ApprovalInbox();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    inbox.clear();
  });

  // ========== Test 1: Basic action logging ==========
  it('should log a new action and assign a unique ID', () => {
    const agentId = 'coordinator-001';
    const actionType: ActionType = 'plan_lock';
    const content = {
      preview: 'Lock Thursday dinner',
      summary: 'Thursday: Chicken tikka locked by user',
    };

    const id1 = inbox.logAction(agentId, actionType, content);
    const id2 = inbox.logAction(agentId, actionType, content);

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);

    const entry = inbox.getEntry(id1);
    expect(entry).toBeDefined();
    expect(entry?.id).toBe(id1);
    expect(entry?.agentId).toBe(agentId);
    expect(entry?.actionType).toBe(actionType);
    expect(entry?.status).toBe('pending');
  });

  // ========== Test 2: Status tracking - approve ==========
  it('should track status changes from pending to approved', () => {
    const id = inbox.logAction('coordinator-001', 'plan_lock', {
      preview: 'Lock Thursday',
      summary: 'Thursday locked',
    });

    let entry = inbox.getEntry(id);
    expect(entry?.status).toBe('pending');
    expect(entry?.userDecision).toBeUndefined();

    const approved = inbox.approve(id, 'user@example.com', 'approve');
    expect(approved).toBe(true);

    entry = inbox.getEntry(id);
    expect(entry?.status).toBe('approved');
    expect(entry?.userDecision).toBe('approve');
    expect(entry?.userEmail).toBe('user@example.com');
    expect(entry?.approvedAt).toBeDefined();
  });

  // ========== Test 3: Status tracking - reject ==========
  it('should track status changes from pending to rejected', () => {
    const id = inbox.logAction('coordinator-001', 'recipe_add', {
      preview: 'Add new recipe',
      summary: 'Recipe added to pool',
    });

    const rejected = inbox.reject(id, 'user@example.com', 'reject');
    expect(rejected).toBe(true);

    const entry = inbox.getEntry(id);
    expect(entry?.status).toBe('rejected');
    expect(entry?.userDecision).toBe('reject');
  });

  // ========== Test 4: Cannot approve non-existent action ==========
  it('should return false when approving non-existent action', () => {
    const result = inbox.approve('non-existent-id', 'user@example.com');
    expect(result).toBe(false);
  });

  // ========== Test 5: Cannot double-approve ==========
  it('should not allow approving an already approved action', () => {
    const id = inbox.logAction('coordinator-001', 'plan_lock', {
      preview: 'Lock',
      summary: 'Locked',
    });

    const first = inbox.approve(id, 'user@example.com', 'approve');
    expect(first).toBe(true);

    const second = inbox.approve(id, 'user@example.com', 'approve');
    expect(second).toBe(false);
  });

  // ========== Test 6: Undo within 7-day window ==========
  it('should undo an approved action within 7 days', async () => {
    const mockRollback = vi.fn();
    const rollbackState: RollbackState = {
      actionId: 'test-action',
      previousState: { locked: true },
      rollbackFn: mockRollback,
    };

    const id = inbox.logAction('coordinator-001', 'plan_lock', {
      preview: 'Lock',
      summary: 'Locked',
    }, rollbackState);

    inbox.approve(id, 'user@example.com');
    const now = new Date();
    vi.setSystemTime(now);

    // Advance time by 3 days (within 7-day window)
    vi.setSystemTime(new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000));

    const undone = await inbox.undo(id);
    expect(undone).toBe(true);
    expect(mockRollback).toHaveBeenCalled();

    const entry = inbox.getEntry(id);
    expect(entry?.status).toBe('rejected');
  });

  // ========== Test 7: Cannot undo outside 7-day window ==========
  it('should not undo an action older than 7 days', async () => {
    const rollbackState: RollbackState = {
      actionId: 'test-action',
      previousState: { locked: false },
    };

    const id = inbox.logAction('coordinator-001', 'plan_lock', {
      preview: 'Lock',
      summary: 'Locked',
    }, rollbackState);

    inbox.approve(id, 'user@example.com');
    const now = new Date();
    vi.setSystemTime(now);

    // Advance time by 8 days (outside 7-day window)
    vi.setSystemTime(new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000));

    const undone = await inbox.undo(id);
    expect(undone).toBe(false);
  });

  // ========== Test 8: Undo without rollback state ==========
  it('should not undo an action without rollback state', async () => {
    const id = inbox.logAction('coordinator-001', 'plan_lock', {
      preview: 'Lock',
      summary: 'Locked',
    }); // No rollback state

    inbox.approve(id, 'user@example.com');

    const undone = await inbox.undo(id);
    expect(undone).toBe(false);
  });

  // ========== Test 9: Get pending approvals ==========
  it('should return only pending approvals', () => {
    const id1 = inbox.logAction('coordinator-001', 'plan_lock', {
      preview: 'Lock 1',
      summary: 'Locked 1',
    });
    const id2 = inbox.logAction('coordinator-001', 'recipe_add', {
      preview: 'Add recipe',
      summary: 'Added recipe',
    });
    const id3 = inbox.logAction('coordinator-001', 'pref_update', {
      preview: 'Update pref',
      summary: 'Updated pref',
    });

    inbox.approve(id1, 'user@example.com');
    inbox.reject(id3, 'user@example.com');

    const pending = inbox.getPending();
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe(id2);
    expect(pending[0].status).toBe('pending');
  });

  // ========== Test 10: Get entries by agent ==========
  it('should retrieve all entries for a specific agent', () => {
    const agent1 = 'coordinator-001';
    const agent2 = 'scout-001';

    inbox.logAction(agent1, 'plan_lock', { preview: 'P1', summary: 'S1' });
    inbox.logAction(agent1, 'recipe_add', { preview: 'P2', summary: 'S2' });
    inbox.logAction(agent2, 'pref_update', { preview: 'P3', summary: 'S3' });

    const agent1Entries = inbox.getEntriesByAgent(agent1);
    expect(agent1Entries.length).toBe(2);
    expect(agent1Entries.every((e) => e.agentId === agent1)).toBe(true);

    const agent2Entries = inbox.getEntriesByAgent(agent2);
    expect(agent2Entries.length).toBe(1);
    expect(agent2Entries[0].agentId).toBe(agent2);
  });

  // ========== Test 11: Escalation detection >24h ==========
  it('should escalate pending actions held for >24 hours', () => {
    const id1 = inbox.logAction('coordinator-001', 'plan_lock', {
      preview: 'Lock',
      summary: 'Locked',
    });

    const now = new Date();
    vi.setSystemTime(now);

    // Advance time by 25 hours
    vi.setSystemTime(new Date(now.getTime() + 25 * 60 * 60 * 1000));

    const escalated = inbox.checkForEscalation();
    expect(escalated.length).toBe(1);
    expect(escalated[0]).toBe(id1);

    const entry = inbox.getEntry(id1);
    expect(entry?.escalated).toBe(true);
  });

  // ========== Test 12: Get escalated actions ==========
  it('should return all escalated actions', () => {
    const id1 = inbox.logAction('coordinator-001', 'plan_lock', {
      preview: 'Lock',
      summary: 'Locked',
    });
    const id2 = inbox.logAction('coordinator-001', 'recipe_add', {
      preview: 'Add',
      summary: 'Added',
    });

    const now = new Date();
    vi.setSystemTime(now);

    // Advance time by 25 hours to escalate id1
    vi.setSystemTime(new Date(now.getTime() + 25 * 60 * 60 * 1000));
    inbox.checkForEscalation();

    const escalated = inbox.getEscalated();
    expect(escalated.length).toBe(1);
    expect(escalated[0].id).toBe(id1);
    expect(escalated[0].escalated).toBe(true);
  });

  // ========== Test 13: Concurrent approvals with locking ==========
  it('should support concurrent approval attempts with tryLock/unlock', () => {
    const id = inbox.logAction('coordinator-001', 'plan_lock', {
      preview: 'Lock',
      summary: 'Locked',
    });

    const lock1 = inbox.tryLock(id);
    expect(lock1).toBe(true);

    const lock2 = inbox.tryLock(id);
    expect(lock2).toBe(false);

    inbox.unlock(id);

    const lock3 = inbox.tryLock(id);
    expect(lock3).toBe(true);
  });

  // ========== Test 14: Complex concurrent scenario ==========
  it('should handle concurrent approvals and undos correctly', async () => {
    const now = new Date();
    vi.setSystemTime(now);

    // Simulate multiple concurrent approval requests
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const rollbackState: RollbackState = {
        actionId: `action-${i}`,
        previousState: { index: i },
        rollbackFn: vi.fn(),
      };
      const id = inbox.logAction(
        `agent-${i % 2}`,
        ['plan_lock', 'recipe_add', 'pref_update', 'swap_meal', 'reflow_week'][i] as ActionType,
        {
          preview: `Action ${i}`,
          summary: `Summary ${i}`,
        },
        rollbackState
      );
      ids.push(id);
    }

    // Approve some, reject some
    inbox.approve(ids[0], 'user@example.com');
    inbox.approve(ids[2], 'user@example.com');
    inbox.reject(ids[1], 'user@example.com');

    // Advance time by 2 days
    vi.setSystemTime(new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000));

    // Undo approved ones
    const undo1 = await inbox.undo(ids[0]);
    const undo2 = await inbox.undo(ids[2]);

    expect(undo1).toBe(true);
    expect(undo2).toBe(true);

    const stats = inbox.getStats();
    expect(stats.total).toBe(5);
    expect(stats.pending).toBe(2); // ids[3], ids[4]
    expect(stats.rejected).toBe(3); // ids[1], ids[0], ids[2] after undo
  });

  // ========== Test 15: Statistics and analytics ==========
  it('should compute accurate statistics', () => {
    const now = new Date();
    vi.setSystemTime(now);

    for (let i = 0; i < 3; i++) {
      inbox.logAction('coordinator-001', 'plan_lock', {
        preview: `Lock ${i}`,
        summary: `Locked ${i}`,
      });
    }
    for (let i = 0; i < 2; i++) {
      inbox.logAction('scout-001', 'recipe_add', {
        preview: `Add ${i}`,
        summary: `Added ${i}`,
      });
    }

    // Get initial stats
    let stats = inbox.getStats();
    expect(stats.total).toBe(5);
    expect(stats.pending).toBe(5);
    expect(stats.approved).toBe(0);
    expect(stats.rejected).toBe(0);
    expect(stats.byActionType.plan_lock).toBe(3);
    expect(stats.byActionType.recipe_add).toBe(2);

    // Approve and reject some
    const all = inbox.getAllEntries();
    inbox.approve(all[0].id, 'user@example.com');
    inbox.reject(all[1].id, 'user@example.com');

    // Advance time by 1 second to measure approval time
    vi.setSystemTime(new Date(now.getTime() + 1000));

    stats = inbox.getStats();
    expect(stats.pending).toBe(3);
    expect(stats.approved).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.averageTimeToApproval).toBeGreaterThan(0);
  });

  // ========== Test 16: Get entries since timestamp ==========
  it('should retrieve only entries after a given timestamp', () => {
    const now = new Date();
    vi.setSystemTime(now);

    const id1 = inbox.logAction('coordinator-001', 'plan_lock', {
      preview: 'Lock 1',
      summary: 'Locked 1',
    });

    // Advance time by 1 hour
    vi.setSystemTime(new Date(now.getTime() + 60 * 60 * 1000));
    const checkTime = new Date();

    // Advance another hour and log
    vi.setSystemTime(new Date(now.getTime() + 2 * 60 * 60 * 1000));
    const id2 = inbox.logAction('coordinator-001', 'recipe_add', {
      preview: 'Add',
      summary: 'Added',
    });

    const recentEntries = inbox.getEntriesSince(checkTime);
    expect(recentEntries.length).toBe(1);
    expect(recentEntries[0].id).toBe(id2);
  });

  // ========== Test 17: Rollback function error handling ==========
  it('should handle rollback function errors gracefully', async () => {
    const rollbackError = new Error('Rollback failed');
    const rollbackState: RollbackState = {
      actionId: 'test-action',
      previousState: {},
      rollbackFn: async () => {
        throw rollbackError;
      },
    };

    const id = inbox.logAction('coordinator-001', 'plan_lock', {
      preview: 'Lock',
      summary: 'Locked',
    }, rollbackState);

    inbox.approve(id, 'user@example.com');

    const undone = await inbox.undo(id);
    expect(undone).toBe(false);

    // Entry should remain approved
    const entry = inbox.getEntry(id);
    expect(entry?.status).toBe('approved');
  });

  // ========== Test 18: Clear entry and cleanup ==========
  it('should clear entries and remove associated rollback state', () => {
    const rollbackState: RollbackState = {
      actionId: 'test-action',
      previousState: {},
    };

    const id = inbox.logAction('coordinator-001', 'plan_lock', {
      preview: 'Lock',
      summary: 'Locked',
    }, rollbackState);

    expect(inbox.getEntry(id)).toBeDefined();
    expect(inbox.getRollbackState(id)).toBeDefined();

    const cleared = inbox.clearEntry(id);
    expect(cleared).toBe(true);
    expect(inbox.getEntry(id)).toBeUndefined();
    expect(inbox.getRollbackState(id)).toBeUndefined();

    const clearedAgain = inbox.clearEntry(id);
    expect(clearedAgain).toBe(false);
  });

  // ========== Test 19: Get all entries export ==========
  it('should export all entries for persistence', () => {
    for (let i = 0; i < 3; i++) {
      inbox.logAction(`agent-${i}`, 'plan_lock', {
        preview: `Lock ${i}`,
        summary: `Locked ${i}`,
      });
    }

    const all = inbox.getAllEntries();
    expect(all.length).toBe(3);
    expect(all.every((e) => e.status === 'pending')).toBe(true);
  });

  // ========== Test 20: Complex diff tracking ==========
  it('should track detailed diffs for meal swaps', () => {
    const diff = 'Thursday dinner: Chicken tikka → Chana masala for everyone';
    const id = inbox.logAction('coordinator-001', 'swap_meal', {
      preview: 'Thursday swap',
      summary: 'Meal swapped',
      diff,
    });

    const entry = inbox.getEntry(id);
    expect(entry?.content.diff).toBe(diff);
  });
});
