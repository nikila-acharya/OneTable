// WP-0.5 — Action log (PRD 7.7 AG05, 10.3 `agent_action`).
// Interface-compatible superset of the WP-1.2 seam (lib/members/action-log.ts):
// same entry fields, plus `ok`/`errorCode` (7.2 AC: failed X-level and off-roster
// attempts MUST be logged) and `undoPayload`/`undoneAt` (7.7: A-level undo 7 days).
//
// NF-P6: summaries are built field-name-first by agent/tools/redact.ts BEFORE a
// row is written — health values never enter this table.

import { randomUUID } from 'node:crypto';
import type { ToolLevel } from './levels';
import type { Db } from './db';
import type { JsonValue } from './json';

export const UNDO_WINDOW_DAYS = 7;

export interface ActionLogEntry {
  at: string;
  householdId: string;
  tool: string;
  level: ToolLevel;
  runId: string | null;
  agent: string | null;
  memberId: string | null;
  /** False for denied attempts (no_such_tool, approval failures) and handler errors. */
  ok: boolean;
  errorCode: string | null;
  /** Field names + counts only. Never raw values for name, health or measurement fields. */
  inputsSummary: JsonValue;
  resultSummary: JsonValue;
  /** A-level only: the exact previous state needed to restore (7.7). */
  undoPayload?: JsonValue | null;
  undoneAt?: string | null;
}

export interface ActionLog {
  record(entry: ActionLogEntry): Promise<void>;
}

export class InMemoryActionLog implements ActionLog {
  readonly entries: ActionLogEntry[] = [];

  async record(entry: ActionLogEntry): Promise<void> {
    this.entries.push({ ...entry });
  }

  /** Test/dev helper. */
  find(id: string): ActionLogEntry | undefined {
    return this.entries.find((e) => (e as ActionLogEntry & { id: string }).id === id);
  }
}

export const noActionLog: ActionLog = {
  async record() {
    /* dev default: discard */
  },
};

// --- Postgres implementation against db/schema/003_agent.sql `agent_action` --

export const AGENT_ACTION_COLUMNS = [
  'id',
  'created_at',
  'household_id',
  'run_id',
  'agent',
  'tool',
  'level',
  'ok',
  'error_code',
  'member_id',
  'inputs_summary',
  'result_summary',
  'undo_payload',
  'undone_at',
] as const;

export class DbActionLog implements ActionLog {
  constructor(
    private readonly db: Db,
    /** Row id allocator; defaults to UUIDv4. Tests pass a deterministic one. */
    private readonly id: () => string = randomUUID,
  ) {}

  async record(entry: ActionLogEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO agent_action (${AGENT_ACTION_COLUMNS.join(', ')})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14)`,
      [
        this.id(),
        entry.at,
        entry.householdId,
        entry.runId,
        entry.agent,
        entry.tool,
        entry.level,
        entry.ok,
        entry.errorCode,
        entry.memberId,
        JSON.stringify(entry.inputsSummary),
        JSON.stringify(entry.resultSummary),
        entry.undoPayload === undefined || entry.undoPayload === null ? null : JSON.stringify(entry.undoPayload),
        entry.undoneAt ?? null,
      ],
    );
  }
}
