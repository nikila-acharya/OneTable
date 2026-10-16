// ApprovalStore + P-level two-phase execution (PRD 7.2, 7.7, AG05).
// P-level tools change nothing until a matching approval record exists:
//   phase 1  tool call without approvalId  -> validate, store proposal, return review card
//   phase 2  same call with approvalId      -> re-validate, check the stored proposal hash
//                                            matches, only then write.
// AC 7.2: "every P-level tool checks for a matching approval record before it changes data."
// Seam: WP-0.5 owns the real `approval` table; this port adapts to it unchanged.

import { createHash } from 'node:crypto';

export type ApprovalStatus = 'pending' | 'approved' | 'declined' | 'expired';

export interface ApprovalRecord {
  id: string;
  householdId: string;
  tool: string;
  /** The exact normalized input, replayed at apply time. May hold health values —
   * it is user-facing data at rest, never echoed back into agent context (NF-P6). */
  proposalJson: unknown;
  proposalHash: string;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
}

export interface ApprovalStore {
  create(record: ApprovalRecord): Promise<void>;
  get(id: string): Promise<ApprovalRecord | null>;
  setStatus(id: string, status: ApprovalStatus, decidedAt: string): Promise<void>;
}

export class InMemoryApprovalStore implements ApprovalStore {
  private rows = new Map<string, ApprovalRecord>();

  async create(record: ApprovalRecord): Promise<void> {
    this.rows.set(record.id, { ...record });
  }

  async get(id: string): Promise<ApprovalRecord | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  async setStatus(id: string, status: ApprovalStatus, decidedAt: string): Promise<void> {
    const r = this.rows.get(id);
    if (!r) throw new Error(`approval ${id} not found`);
    this.rows.set(id, { ...r, status, decidedAt });
  }
}

/** Deterministic hash of the normalized proposal. Approving must bind to the exact
 * data that will be written — a swapped payload under the same approvalId fails. */
export function hashProposal(normalized: unknown): string {
  return createHash('sha256').update(stableStringify(normalized)).digest('hex');
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortDeep(obj[k]);
    return out;
  }
  return value;
}
