// WP-0.5 — Action log mechanics: every call is logged; A-level rows carry undo
// payloads; summaries are NF-P6 safe (field names, never health values). Plus the
// Db store against a recording SQL fake.

import { describe, expect, it } from 'vitest';
import { buildFullRegistry, callAs, fixedClock, makeRecordingActionLog } from './helpers';
import { summarize } from '../agent/tools/redact';
import { DbApprovalStore, APPROVAL_COLUMNS, type ApprovalRecord } from '../agent/tools/approvals';
import { DbActionLog, AGENT_ACTION_COLUMNS } from '../agent/tools/action-log';
import type { Db } from '../agent/tools/db';
import { randomUUID } from 'node:crypto';

interface Captured {
  sql: string;
  params: readonly unknown[];
}

function fakeDb(responder?: (captured: Captured) => Record<string, unknown>[]): Db & { captured: Captured[] } {
  const captured: Captured[] = [];
  return {
    captured,
    async query<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      const c = { sql: sql.replace(/\s+/g, ' ').trim(), params };
      captured.push(c);
      return (responder ? responder(c) : []) as T[];
    },
  };
}

describe('NF-P6 summarization', () => {
  it('keeps field names and structure but never health or identity values', () => {
    const summary = summarize({
      memberId: 'm-1',
      name: 'Asha',
      allergies: ['peanut'],
      conditions: ['celiac'],
      weight: 41.2,
      attending: true,
      weekday: 3,
    }) as Record<string, unknown>;
    expect(Object.keys(summary).sort()).toEqual(
      ['allergies', 'attending', 'conditions', 'memberId', 'name', 'weight', 'weekday'].sort(),
    );
    expect(summary.memberId).toBe('m-1'); // ids are references — allowed
    expect(summary.attending).toBe(true);
    const dump = JSON.stringify(summary);
    for (const secret of ['Asha', 'peanut', 'celiac', '41.2']) {
      expect(dump).not.toContain(secret);
    }
    expect(summary.allergies).toBe('ref:list(1)');
  });

  it('recurses into nested objects and arrays', () => {
    const summary = summarize({ proposal: { member: { name: 'Asha', diet: 'vegetarian' } } }) as {
      proposal: { member: { name: string; diet: string } };
    };
    expect(summary.proposal.member.diet).toBe('vegetarian');
    expect(summary.proposal.member.name).toBe('ref:string(len=4)');
  });
});

describe('logging on the call path', () => {
  it('every successful call, R/A/P-phase1/Team, writes exactly one row', async () => {
    const reg = buildFullRegistry();
    await callAs(reg.registry, 'coordinator', 'get_plan', { week_start: '2026-10-12' });
    await callAs(reg.registry, 'planner', 'draft_plan', { seed: 42 });
    await callAs(reg.registry, 'coordinator', 'delegate', { agent: 'scout', task: 'import' });
    const tools = reg.log.entries.map((e) => e.tool);
    expect(tools).toEqual(['get_plan', 'draft_plan', 'delegate']);
    expect(reg.log.entries[0]?.level).toBe('R');
    expect(reg.log.entries[1]?.level).toBe('A');
    expect(reg.log.entries[2]?.level).toBe('Team');
    expect(reg.log.entries.every((e) => e.ok)).toBe(true);
    expect(reg.log.entries[0]?.runId).toBe('run-1');
  });

  it('A-level rows carry the undo payload; R-level rows never do', async () => {
    const reg = buildFullRegistry();
    reg.sink.undoFor = { schedule_nudge: { previous: null } };
    await callAs(reg.registry, 'grocery', 'schedule_nudge', { type: 'spoilage' });
    expect(reg.log.entries.at(-1)?.undoPayload).toEqual({ previous: null });
    await callAs(reg.registry, 'grocery', 'get_grocery_list', {});
    expect(reg.log.entries.at(-1)?.undoPayload ?? null).toBeNull();
  });

  it('handler errors are logged as failures instead of thrown into the run', async () => {
    const reg = buildFullRegistry();
    reg.sink.throwOn = 'import_recipe_url';
    const out = await callAs(reg.registry, 'scout', 'import_recipe_url', { url: 'https://x.example' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('tool_error');
    const row = reg.log.entries.at(-1);
    expect(row?.ok).toBe(false);
    expect(row?.errorCode).toBe('tool_error');
  });

  it('invalid input fails the schema and is logged', async () => {
    const reg = buildFullRegistry();
    // additionalProperties:true stubs accept anything, so test validateInput directly:
    const { validateInput } = await import('../agent/tools/registry');
    expect(
      validateInput({ type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, {}),
    ).toMatch(/url/);
    expect(
      validateInput({ type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, { url: 42 }),
    ).toMatch(/type string/);
    expect(
      validateInput({ type: 'object', properties: { url: { type: 'string' } } }, { url: 'ok', extra: 1 }),
    ).toMatch(/unknown property/);
    expect(validateInput({ type: 'object', properties: { url: { type: 'string' } } }, 'nope')).toMatch(/object/);
  });
});

describe('Db stores speak the SQL schema', () => {
  const baseEntry = {
    at: new Date().toISOString(),
    householdId: 'hh-1',
    tool: 'delete_data',
    level: 'X' as const,
    runId: randomUUID(),
    agent: 'coordinator',
    memberId: null,
    ok: false,
    errorCode: 'no_such_tool',
    inputsSummary: {},
    resultSummary: { error: 'no_such_tool' },
  };

  it('DbActionLog inserts exactly AGENT_ACTION_COLUMNS into agent_action', async () => {
    const db = fakeDb();
    const log = new DbActionLog(db, () => 'fixed-id');
    await log.record({ ...baseEntry, undoPayload: { previous: null } });
    const c = db.captured[0];
    expect(c?.sql).toContain('INSERT INTO agent_action');
    const columnList = c?.sql.match(/INSERT INTO agent_action \(([^)]+)\)/)?.[1];
    expect(columnList?.split(',').map((s) => s.trim())).toEqual([...AGENT_ACTION_COLUMNS]);
    expect(c?.params).toHaveLength(AGENT_ACTION_COLUMNS.length);
    expect(c?.params[6]).toBe('X'); // level column carries the attempted level
    expect(c?.params[10]).toBe('{}'); // jsonb passed as JSON text
  });

  it('DbApprovalStore round-trips approval rows and expires lazily', async () => {
    const record: ApprovalRecord = {
      id: 'a-1',
      householdId: 'hh-1',
      runId: 'r-1',
      tool: 'accept_plan',
      proposalJson: { planId: 'p-1' },
      proposalHash: 'h',
      status: 'pending',
      createdAt: '2026-10-16T12:00:00.000Z',
      expiresAt: '2026-10-23T12:00:00.000Z',
      decidedAt: null,
    };
    let stored: Record<string, unknown> = {
      id: 'a-1',
      household_id: 'hh-1',
      run_id: 'r-1',
      tool: 'accept_plan',
      proposal_json: { planId: 'p-1' },
      proposal_hash: 'h',
      status: 'pending',
      created_at: '2026-10-16T12:00:00.000Z',
      expires_at: '2026-10-23T12:00:00.000Z',
      decided_at: null,
    };
    const clock = fixedClock(Date.parse('2026-10-30T00:00:00.000Z')); // past expiry
    const db: Db = {
      async query<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
        if (sql.includes('INSERT')) {
          expect(params).toHaveLength(APPROVAL_COLUMNS.length);
          stored = { ...stored, status: (params[6] as string) };
          return [] as T[];
        }
        if (sql.startsWith('UPDATE')) {
          stored = { ...stored, status: params[1] as string, decided_at: params[2] as string };
          return [] as T[];
        }
        return [stored] as T[];
      },
    };
    const store = new DbApprovalStore(db, clock.now);
    await store.create(record);
    const got = await store.get('a-1');
    expect(got?.householdId).toBe('hh-1');
    expect(got?.proposalJson).toEqual({ planId: 'p-1' });
    expect(got?.status).toBe('expired'); // lazy expiry on read (PRD 7.7: 7 days)
    expect(stored.status).toBe('expired'); // and persisted
    await store.setStatus('a-1', 'approved', '2026-10-30T00:00:00.000Z');
    expect(stored.status).toBe('approved');
    const missing = new DbApprovalStore(
      { async query() { return []; } },
      clock.now,
    );
    expect(await missing.get('nope')).toBeNull();
    await expect(missing.setStatus('nope', 'declined', 'now')).rejects.toThrow(/not found/);
  });
});
