/**
 * WP-6.3 — Logging & Audit Trail: Compliance logging, security auditing
 * All changes tracked for audit, HIPAA/GDPR compliance, security investigation
 */

import { createHash } from "node:crypto";

export interface AuditEntry {
  id: string;
  timestamp: string;
  householdId: string;
  actorId?: string; // User or system
  actorType: "user" | "system" | "agent";
  entityType: string; // Table name
  entityId: string;
  action: "create" | "read" | "update" | "delete" | "approve" | "decline" | "undo";
  changeSet?: {
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
  reason?: string; // Why the change was made
  ipAddress?: string; // Hashed
  result: "success" | "failure";
  errorMessage?: string;
}

/**
 * Audit Logger
 */
export class AuditLogger {
  private entries: AuditEntry[] = [];

  /**
   * Log an audit entry
   */
  log(entry: Omit<AuditEntry, "id" | "timestamp">): AuditEntry {
    const fullEntry: AuditEntry = {
      ...entry,
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
    };

    // Hash IP for privacy
    if (fullEntry.ipAddress) {
      const hash = createHash("sha256")
        .update(fullEntry.ipAddress)
        .digest("hex")
        .slice(0, 8);
      fullEntry.ipAddress = hash;
    }

    this.entries.push(fullEntry);

    // Persist to database (async)
    this.persistToDB(fullEntry).catch((err) =>
      console.error("Failed to persist audit entry:", err)
    );

    return fullEntry;
  }

  /**
   * Get audit trail for entity
   */
  getEntityTrail(householdId: string, entityType: string, entityId: string): AuditEntry[] {
    return this.entries
      .filter(
        (e) =>
          e.householdId === householdId &&
          e.entityType === entityType &&
          e.entityId === entityId
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Get all changes by actor
   */
  getChangesByActor(householdId: string, actorId: string): AuditEntry[] {
    return this.entries
      .filter((e) => e.householdId === householdId && e.actorId === actorId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Get compliance report (HIPAA/GDPR)
   */
  getComplianceReport(householdId: string, startDate: string, endDate: string): {
    totalChanges: number;
    changesByAction: Record<string, number>;
    changesByActor: Record<string, number>;
    failedAttempts: number;
    dataAccessLog: AuditEntry[];
  } {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const relevant = this.entries.filter(
      (e) =>
        e.householdId === householdId &&
        new Date(e.timestamp) >= start &&
        new Date(e.timestamp) <= end
    );

    const changesByAction: Record<string, number> = {};
    const changesByActor: Record<string, number> = {};
    let failedAttempts = 0;

    for (const entry of relevant) {
      changesByAction[entry.action] = (changesByAction[entry.action] || 0) + 1;

      if (entry.actorId) {
        changesByActor[entry.actorId] = (changesByActor[entry.actorId] || 0) + 1;
      }

      if (entry.result === "failure") {
        failedAttempts++;
      }
    }

    // Data access log (read operations for GDPR compliance)
    const dataAccessLog = relevant.filter((e) => e.action === "read");

    return {
      totalChanges: relevant.length,
      changesByAction,
      changesByActor,
      failedAttempts,
      dataAccessLog,
    };
  }

  /**
   * Get suspicious activity (potential security issues)
   */
  getSuspiciousActivity(householdId: string): AuditEntry[] {
    const suspicious: AuditEntry[] = [];

    // Multiple failures in short time
    const failuresByActor = new Map<string | undefined, AuditEntry[]>();
    for (const entry of this.entries) {
      if (entry.householdId === householdId && entry.result === "failure") {
        if (!failuresByActor.has(entry.actorId)) {
          failuresByActor.set(entry.actorId, []);
        }
        failuresByActor.get(entry.actorId)!.push(entry);
      }
    }

    // Flag if >5 failures in 1 hour
    for (const [, failures] of failuresByActor) {
      if (failures.length > 5) {
        const timespan = failures[failures.length - 1].timestamp;
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        if (timespan > oneHourAgo) {
          suspicious.push(...failures);
        }
      }
    }

    // Unusual access times
    for (const entry of this.entries.filter((e) => e.householdId === householdId)) {
      const hour = new Date(entry.timestamp).getHours();
      if (hour < 6 || hour > 23) {
        // Off-hours access
        suspicious.push(entry);
      }
    }

    return suspicious;
  }

  /**
   * Export audit log (for compliance exports)
   */
  exportLog(householdId: string, format: "csv" | "json"): string {
    const relevant = this.entries.filter((e) => e.householdId === householdId);

    if (format === "json") {
      return JSON.stringify(relevant, null, 2);
    }

    // CSV export
    const headers = [
      "ID",
      "Timestamp",
      "Actor",
      "Action",
      "Entity Type",
      "Entity ID",
      "Result",
    ];
    const rows = relevant.map((e) => [
      e.id,
      e.timestamp,
      e.actorId || "system",
      e.action,
      e.entityType,
      e.entityId,
      e.result,
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((r) => r.map((v) => `"${v}"`).join(",")),
    ].join("\n");

    return csv;
  }

  /**
   * Private helpers
   */

  private async persistToDB(entry: AuditEntry): Promise<void> {
    // Save to database audit_logs table
    try {
      await fetch("/api/audit/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
    } catch (error) {
      console.error("Failed to persist audit entry:", error);
    }
  }
}

/**
 * Singleton instance
 */
export const auditLogger = new AuditLogger();

/**
 * Helper functions for common operations
 */

export function logMemberUpdate(
  householdId: string,
  memberId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  actorId?: string
): void {
  auditLogger.log({
    householdId,
    actorId,
    actorType: actorId ? "user" : "system",
    entityType: "members",
    entityId: memberId,
    action: "update",
    changeSet: { before, after },
    result: "success",
  });
}

export function logApprovalDecision(
  householdId: string,
  cardId: string,
  decision: "approve" | "decline",
  userId: string,
  reason?: string
): void {
  auditLogger.log({
    householdId,
    actorId: userId,
    actorType: "user",
    entityType: "approval_cards",
    entityId: cardId,
    action: decision === "approve" ? "approve" : "decline",
    reason,
    result: "success",
  });
}

export function logDataAccess(
  householdId: string,
  entityType: string,
  userId: string
): void {
  auditLogger.log({
    householdId,
    actorId: userId,
    actorType: "user",
    entityType,
    entityId: householdId,
    action: "read",
    reason: "User data access",
    result: "success",
  });
}

export function logUndo(
  householdId: string,
  actionId: string,
  userId: string
): void {
  auditLogger.log({
    householdId,
    actorId: userId,
    actorType: "user",
    entityType: "action_logs",
    entityId: actionId,
    action: "undo",
    result: "success",
  });
}

export function logSecurityEvent(
  householdId: string,
  eventType: string,
  userId?: string,
  errorMessage?: string
): void {
  auditLogger.log({
    householdId,
    actorId: userId,
    actorType: userId ? "user" : "system",
    entityType: "security_events",
    entityId: eventType,
    action: "create",
    result: errorMessage ? "failure" : "success",
    errorMessage,
  });
}
