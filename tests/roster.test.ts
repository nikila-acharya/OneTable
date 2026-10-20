// WP-0.5 — Roster integrity against PRD 7.1 (TR-AGENTS). Transcribed independently
// from the PRD table so drift between roster.ts and 7.1 fails here.

import { describe, expect, it } from 'vitest';
import { AGENT_IDS, AGENT_ROSTER, UNASSIGNED_TOOL_ALLOWLIST, type AgentId } from '../agent/roster';
import { levelOf, TOOL_MANIFEST, toolNamesAtLevel, type ToolName } from '../agent/tools/manifest';

/** PRD 7.1 "Tools it may call", verbatim. */
const PRD_ROSTER: Record<AgentId, readonly string[]> = {
  coordinator: ['get_household', 'get_member_summary', 'get_plan', 'get_memory', 'delegate', 'create_approval'],
  setup: ['get_household', 'get_member_summary', 'create_or_update_member', 'set_attendance', 'change_household_settings'],
  scout: ['list_recipes', 'get_recipe', 'import_recipe_url', 'bulk_import_source'],
  planner: ['get_plan', 'list_recipes', 'explain_rules_applied', 'draft_plan', 'propose_swap', 'reflow_week', 'accept_plan', 'apply_reflow'],
  grocery: ['get_plan', 'get_grocery_list', 'draft_grocery_list', 'schedule_nudge', 'send_to_instacart'],
  activity: ['get_member_summary', 'get_tips', 'record_checkin', 'schedule_nudge', 'set_activity_goal'],
  reviewer: ['get_plan', 'get_memory', 'list_outcomes', 'write_memory', 'update_scoring_weights'],
  guardian: [],
};

describe('roster vs PRD 7.1', () => {
  it('matches the PRD table for every agent', () => {
    for (const agent of AGENT_IDS) {
      expect([...AGENT_ROSTER[agent]].sort(), agent).toEqual([...PRD_ROSTER[agent]].sort());
    }
  });

  it('every roster entry is a real manifest tool of the right family (never X)', () => {
    for (const agent of AGENT_IDS) {
      for (const tool of AGENT_ROSTER[agent]) {
        expect(TOOL_MANIFEST).toHaveProperty(tool);
        expect(levelOf(tool), `${agent}.${tool}`).not.toBe('X');
      }
    }
  });

  it('delegate is Team level and Coordinator-only', () => {
    expect(TOOL_MANIFEST.delegate).toBe('Team');
    const holders = AGENT_IDS.filter((a) => AGENT_ROSTER[a].includes('delegate'));
    expect(holders).toEqual(['coordinator']);
  });

  it('the Safety Guardian holds no tools (block-only, 7.1 row G)', () => {
    expect(AGENT_ROSTER.guardian).toEqual([]);
  });

  it('every R/A/P manifest tool is assigned to at least one agent, except the documented allowlist', () => {
    const assigned = new Set<ToolName>(AGENT_IDS.flatMap((a) => [...AGENT_ROSTER[a]]));
    const unassigned = [...toolNamesAtLevel('R'), ...toolNamesAtLevel('A'), ...toolNamesAtLevel('P'), ...toolNamesAtLevel('Team')].filter(
      (t) => !assigned.has(t),
    );
    expect(unassigned.sort()).toEqual([...UNASSIGNED_TOOL_ALLOWLIST].sort());
  });

  it('the Coordinator holds no specialist A-level tool (7.1a)', () => {
    const aTools = new Set(toolNamesAtLevel('A'));
    const violations = AGENT_ROSTER.coordinator.filter((t) => aTools.has(t as ToolName));
    expect(violations).toEqual([]);
  });
});
