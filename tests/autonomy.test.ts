// WP-0.5 — AG06 autonomy settings: tools may move DOWN only, A -> P.
// Nothing moves up. Nothing leaves X.

import { describe, expect, it } from 'vitest';
import { canChangeLevel } from '../agent/tools/levels';
import { ToolRegistry } from '../agent/tools/registry';
import { InMemoryApprovalStore } from '../agent/tools/approvals';
import { buildFullRegistry, callAs, makeRecordingActionLog } from './helpers';

describe('autonomy (AG06)', () => {
  it('canChangeLevel accepts exactly A -> P', () => {
    expect(canChangeLevel('A', 'P')).toBe(true);
    expect(canChangeLevel('P', 'A')).toBe(false);
    expect(canChangeLevel('R', 'P')).toBe(false);
    expect(canChangeLevel('P', 'R')).toBe(false);
    expect(canChangeLevel('A', 'R')).toBe(false);
    expect(canChangeLevel('X', 'A')).toBe(false);
    expect(canChangeLevel('X', 'P')).toBe(false);
    expect(canChangeLevel('X', 'R')).toBe(false);
    expect(canChangeLevel('R', 'A')).toBe(false);
    expect(canChangeLevel('A', 'X')).toBe(false);
    expect(canChangeLevel('Team', 'P')).toBe(false);
  });

  it('the registry constructor rejects any override that is not a demotion', () => {
    const mk = (autonomy: Record<string, never>) =>
      new ToolRegistry({ approvals: new InMemoryApprovalStore(), actionLog: makeRecordingActionLog(), autonomy });
    expect(() => mk({ accept_plan: 'A' } as never)).toThrow(/only A -> P/);
    expect(() => mk({ delete_data: 'P' } as never)).toThrow(/only A -> P/);
    expect(() => mk({ get_plan: 'A' } as never)).toThrow(/only A -> P/);
    expect(() => mk({ not_a_tool: 'P' } as never)).toThrow(/unknown tool/);
    expect(() => mk({ draft_plan: 'P' } as never)).not.toThrow();
  });

  it('a demoted A tool registers as P and gates behind approval before any execution', async () => {
    // "ask me before importing anything" => import_recipe_url A -> P.
    const { registry, sink } = buildFullRegistry({ autonomy: { import_recipe_url: 'P' } });
    const scouted = registry.toolsFor('scout').find((t) => t.name === 'import_recipe_url');
    expect(scouted?.level).toBe('P');

    const first = await callAs(registry, 'scout', 'import_recipe_url', { url: 'https://example.com/r' });
    expect(first.ok).toBe(true);
    if (first.ok && first.outcome === 'approval_requested') {
      // second phase handled in p-approval tests; here: nothing ran yet
    }
    expect(sink.calls).toHaveLength(0); // demoted tool must NOT execute on phase 1
  });

  it('the same tool with default autonomy still runs as A', async () => {
    const { registry, sink } = buildFullRegistry();
    const out = await callAs(registry, 'scout', 'import_recipe_url', { url: 'https://example.com/r' });
    expect(out.ok).toBe(true);
    expect(sink.calls).toHaveLength(1);
  });
});
