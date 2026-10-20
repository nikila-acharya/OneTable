// THE WP-0.5 acceptance test: X-level tools are never registered for agents, and
// any attempt to call one fails server-side as `no_such_tool` AND is logged
// (PRD 7.2 AC + 13.2 "Never register an X-level action as an agent tool").

import { describe, expect, it } from 'vitest';
import { AGENT_IDS, AGENT_ROSTER } from '../agent/roster';
import { levelOf, TOOL_MANIFEST, X_LEVEL_ACTIONS, type ToolName } from '../agent/tools/manifest';
import { ToolRegistry } from '../agent/tools/registry';
import { ALL_X_NAMES, buildFullRegistry, callAs, stubTool, makeRecordingActionLog } from './helpers';
import { InMemoryApprovalStore } from '../agent/tools/approvals';

describe('X-level actions', () => {
  it('the manifest lists all eight X actions of PRD 7.2', () => {
    expect(ALL_X_NAMES.sort()).toEqual([...X_LEVEL_ACTIONS].sort());
  });

  it('no X-level tool appears in ANY agent tool context — even a fully built one', () => {
    const { registry } = buildFullRegistry();
    const xSet = new Set<string>(ALL_X_NAMES);
    for (const agent of AGENT_IDS) {
      const names = registry.toolsFor(agent).map((t) => t.name);
      const leaked = names.filter((n) => xSet.has(n));
      expect(leaked, `agent ${agent} context contains X tools`).toEqual([]);
    }
  });

  it('X-level names are not on any roster either (roster is the source of registration)', () => {
    for (const agent of AGENT_IDS) {
      for (const name of AGENT_ROSTER[agent]) {
        expect(levelOf(name)).not.toBe('X');
      }
    }
  });

  it('registering an X implementation throws for every agent (defense in depth)', () => {
    for (const agent of AGENT_IDS) {
      const registry = new ToolRegistry({ approvals: new InMemoryApprovalStore(), actionLog: makeRecordingActionLog() });
      for (const x of ALL_X_NAMES) {
        // A hostile caller hand-crafting an impl cannot get past the manifest check,
        // whether they declare the true level X or lie about it.
        expect(() => registry.register(agent, stubTool(x, { calls: [] })), `${agent}:${x} honest level`).toThrow(/X-level/);
        expect(
          () =>
            registry.register(agent, {
              ...stubTool(x, { calls: [] }),
              level: 'R',
            }),
          `${agent}:${x} lying level`,
        ).toThrow();
      }
    }
  });

  it('every agent calling every X tool gets no_such_tool AND a logged attempt', async () => {
    const { registry, log, sink } = buildFullRegistry();
    for (const agent of AGENT_IDS) {
      for (const x of ALL_X_NAMES) {
        const outcome = await callAs(registry, agent, x, { reason: 'test' });
        expect(outcome.ok, `${agent}.${x} must fail`).toBe(false);
        if (!outcome.ok) expect(outcome.error).toBe('no_such_tool');
        const rows = log.entries.filter((e) => e.agent === agent && e.tool === x);
        const row = rows[rows.length - 1];
        if (!row) throw new Error(`${agent}.${x} attempt must be logged`);
        expect(row.ok).toBe(false);
        expect(row.errorCode).toBe('no_such_tool');
        expect(row.level).toBe('X'); // the true manifest level is recorded
      }
    }
    expect(sink.calls.length, 'no handler executed for X attempts').toBe(0);
  });

  it('names absent from the manifest are also denied and logged as unknown', async () => {
    const { registry, log } = buildFullRegistry();
    const outcome = await callAs(registry, 'coordinator', 'delete_everything');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe('no_such_tool');
    const row = log.entries.at(-1);
    expect(row?.level).toBe('unknown');
    expect(row?.errorCode).toBe('no_such_tool');
  });

  it('an off-roster tool call from another agent fails identically and is logged with its true level', async () => {
    // 7.1a: the Coordinator cannot call a specialist's P-level tool itself.
    const { registry, log, sink } = buildFullRegistry();
    const outcome = await callAs(registry, 'coordinator', 'bulk_import_source');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe('no_such_tool');
    const row = log.entries.at(-1);
    expect(row?.level).toBe('P');
    expect(row?.ok).toBe(false);
    expect(sink.calls).toHaveLength(0);
  });

  it('a lying level on a legitimate roster tool cannot raise it (level is manifest-fixed)', () => {
    const { approvals } = buildFullRegistry();
    const registry = new ToolRegistry({ approvals, actionLog: makeRecordingActionLog() });
    expect(() =>
      registry.register('setup', {
        name: 'create_or_update_member',
        level: 'R', // claiming a read tool runs freely — must reject
        jsonSchema: { type: 'object' },
        handler: () => ({ result: {} }),
      }),
    ).toThrow(/manifest fixes P/);
    expect(() =>
      registry.register('planner', {
        name: 'accept_plan',
        level: 'A',
        jsonSchema: { type: 'object' },
        handler: () => ({ result: {} }),
      }),
    ).toThrow(/manifest fixes P/);
  });

  it('toolsFor exposes exactly the roster per agent, with manifest levels', () => {
    const { registry } = buildFullRegistry();
    for (const agent of AGENT_IDS) {
      const expected = [...AGENT_ROSTER[agent]];
      const actual = registry.toolsFor(agent).map((t) => t.name);
      expect(actual.sort(), agent).toEqual(expected.sort());
      for (const t of registry.toolsFor(agent)) {
        expect(t.level).toBe(TOOL_MANIFEST[t.name as ToolName]);
      }
    }
  });
});
