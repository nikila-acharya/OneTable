// HealthWriter — seam to WP-1.3 (encrypted member_health table, NF-P1).
// Height/weight/allergies/conditions never land in `member`; they route through this
// port. WP-1.3 supplies the AES-256-GCM store; the in-memory writer here is for unit
// tests and dev only.
//
// Note: enum validation for allergies (PR02's 9 US allergens + free "other") and
// conditions (PR03 fixed list) belongs to WP-1.3 — WP-1.2 passes values through
// untouched so the two WPs do not define competing enums.

import type { HealthPatch } from './types';

export interface HealthWriter {
  putMemberHealth(memberId: string, householdId: string, patch: HealthPatch): Promise<void>;
  getMemberHealth(memberId: string, householdId: string): Promise<HealthPatch | null>;
  deleteMemberHealth(memberId: string): Promise<void>;
}

interface StoredHealth {
  householdId: string;
  patch: HealthPatch;
}

export class InMemoryHealthWriter implements HealthWriter {
  private rows = new Map<string, StoredHealth>();

  async putMemberHealth(memberId: string, householdId: string, patch: HealthPatch): Promise<void> {
    const existing = this.rows.get(memberId);
    if (existing && existing.householdId !== householdId) {
      throw new Error(`health row for member ${memberId} belongs to another household`);
    }
    const merged: HealthPatch = { ...(existing?.patch ?? {}) };
    for (const [k, v] of Object.entries(patch) as Array<[keyof HealthPatch, unknown]>) {
      if (v === undefined) continue;
      (merged[k] as unknown) = v === null ? null : v;
    }
    this.rows.set(memberId, { householdId, patch: merged });
  }

  async getMemberHealth(memberId: string, householdId: string): Promise<HealthPatch | null> {
    const row = this.rows.get(memberId);
    return row && row.householdId === householdId ? { ...row.patch } : null;
  }

  async deleteMemberHealth(memberId: string): Promise<void> {
    this.rows.delete(memberId);
  }
}
