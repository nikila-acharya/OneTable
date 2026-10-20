// WP-0.5 — Approval store (PRD 7.7, AG05; `approval` table per PRD 10.3).
// Interface-compatible superset of the WP-1.2 seam (lib/members/approvals.ts):
// same field names, plus `runId` (optional, so existing callers keep compiling)
// and the `proposal_hash` payload binding.
//
// AC 7.2: "every P-level tool checks for a matching approval record before it
// changes data." The registry (agent/tools/registry.ts) is that check; this
// module owns storage, expiry (7 days, PRD 7.7) and the proposal hash.

import { createHash, randomUUID } from 'node:crypto';
import type { Db } from './db';
import type { JsonValue } from './json';

export type ApprovalStatus = 'pending' | 'approved' | 'declined' | 'expired';

export const APPROVAL_TTL_DAYS = 7;

export interface ApprovalRecord {
  id: string;
  householdId: string;
  /** Set when the proposal was raised by an agent run (AG05 inbox traceability). */
  runId?: string | null;
  tool: string;
  /** The exact normalized input, replayed at apply time. May hold health values —
   * it is user-facing data at rest, never echoed back into agent context (NF-P6). */
  proposalJson: JsonValue;
  proposalHash: string;
  status: ApprovalStatus;
  createdAt: string;
  /** Approvals expire after 7 days [PRD 7.7]. */
  expiresAt: string;
  decidedAt: string | null;
}

export interface ApprovalStore {
  create(record: ApprovalRecord): Promise<void>;
  get(id: string): Promise<ApprovalRecord | null>;
  setStatus(id: string, status: ApprovalStatus, decidedAt: string): Promise<void>;
}

/** Deterministic hash of the normalized proposal. Approving must bind to the exact
 * data that will be written — a swapped payload under the same approvalId fails.
 * Same algorithm as the WP-1.2 seam copy; they dedupe to this one at merge. */
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

export function newApproval(params: {
  householdId: string;
  runId: string | null;
  tool: string;
  proposalJson: JsonValue;
  now: Date;
}): ApprovalRecord {
  const createdAt = params.now.toISOString();
  const expires = new Date(params.now.getTime() + APPROVAL_TTL_DAYS * 24 * 60 * 60 * 1000);
  return {
    id: randomUUID(),
    householdId: params.householdId,
    runId: params.runId,
    tool: params.tool,
    proposalJson: params.proposalJson,
    proposalHash: hashProposal(params.proposalJson),
    status: 'pending',
    createdAt,
    expiresAt: expires.toISOString(),
    decidedAt: null,
  };
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

  /** Test helper — snapshot of all rows. */
  all(): ApprovalRecord[] {
    return [...this.rows.values()];
  }
}

// --- Postgres implementation against db/schema/003_agent.sql `approval` ------

export const APPROVAL_COLUMNS = [
  'id',
  'household_id',
  'run_id',
  'tool',
  'proposal_json',
  'proposal_hash',
  'status',
  'created_at',
  'expires_at',
  'decided_at',
] as const;

type ApprovalRow = {
  id: string;
  household_id: string;
  run_id: string | null;
  tool: string;
  proposal_json: JsonValue;
  proposal_hash: string;
  status: string;
  created_at: Date | string;
  expires_at: Date | string;
  decided_at: Date | string | null;
};

function iso(v: Date | string): string {
  return typeof v === 'string' ? new Date(v).toISOString() : v.toISOString();
}

function rowToRecord(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    householdId: row.household_id,
    runId: row.run_id,
    tool: row.tool,
    proposalJson: row.proposal_json,
    proposalHash: row.proposal_hash,
    status: row.status as ApprovalStatus,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    decidedAt: row.decided_at === null ? null : iso(row.decided_at),
  };
}

export class DbApprovalStore implements ApprovalStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(record: ApprovalRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO approval (${APPROVAL_COLUMNS.join(', ')})
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
      [
        record.id,
        record.householdId,
        record.runId ?? null,
        record.tool,
        JSON.stringify(record.proposalJson),
        record.proposalHash,
        record.status,
        record.createdAt,
        record.expiresAt,
        record.decidedAt,
      ],
    );
  }

  async get(id: string): Promise<ApprovalRecord | null> {
    const rows = await this.db.query<ApprovalRow>(
      `SELECT ${APPROVAL_COLUMNS.join(', ')} FROM approval WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    const record = rowToRecord(row);
    // Lazy expiry (PRD 7.7): a pending approval past its expiry reads as expired.
    if (record.status === 'pending' && Date.parse(record.expiresAt) <= this.now().getTime()) {
      await this.setStatus(record.id, 'expired', this.now().toISOString());
      return { ...record, status: 'expired' };
    }
    return record;
  }

  async setStatus(id: string, status: ApprovalStatus, decidedAt: string): Promise<void> {
    const updated = await this.db.query(
      `UPDATE approval SET status = $2, decided_at = $3 WHERE id = $1`,
      [id, status, decidedAt],
    );
    if (updated.length === 0 && status !== 'expired') {
      // UPDATE returns no rows under RETURNING-less drivers when nothing matched;
      // re-check existence so callers get the same "not found" error as the seam.
      const exists = await this.db.query<{ id: string }>(`SELECT id FROM approval WHERE id = $1`, [id]);
      if (exists.length === 0) throw new Error(`approval ${id} not found`);
    }
  }
}
