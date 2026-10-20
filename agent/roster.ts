// WP-0.5 — Agent roster (PRD 7.1, 7.1a "Least privilege"). Fixed in code: a tool
// not on an agent's list is not registered in that agent's context. The registry
// validates every registration against this file.

import type { ToolName } from './tools/manifest';

export const AGENT_IDS = [
  'coordinator',
  'setup',
  'scout',
  'planner',
  'grocery',
  'activity',
  'reviewer',
  'guardian',
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export function isAgentId(name: string): name is AgentId {
  return (AGENT_IDS as readonly string[]).includes(name);
}

export const AGENT_ROSTER: Record<AgentId, readonly ToolName[]> = {
  // Front door and orchestrator (AG01, AG02, AG05).
  coordinator: ['get_household', 'get_member_summary', 'get_plan', 'get_memory', 'delegate', 'create_approval'],
  // Household Setup agent (PR01-PR03).
  setup: ['get_household', 'get_member_summary', 'create_or_update_member', 'set_attendance', 'change_household_settings'],
  // Recipe Scout (CP01, CP02, RE01-RE03).
  scout: ['list_recipes', 'get_recipe', 'import_recipe_url', 'bulk_import_source'],
  // Meal Planner agent (MP01, MP02, AG03 reflow).
  planner: ['get_plan', 'list_recipes', 'explain_rules_applied', 'draft_plan', 'propose_swap', 'reflow_week', 'accept_plan', 'apply_reflow'],
  // Grocery & Pantry agent (GL01, GL02, IC01).
  grocery: ['get_plan', 'get_grocery_list', 'draft_grocery_list', 'schedule_nudge', 'send_to_instacart'],
  // Activity & Tips agent (EX01, EX02, HT01, HT02).
  activity: ['get_member_summary', 'get_tips', 'record_checkin', 'schedule_nudge', 'set_activity_goal'],
  // Weekly Reviewer (AG04, plan learner).
  reviewer: ['get_plan', 'get_memory', 'list_outcomes', 'write_memory', 'update_scoring_weights'],
  // Safety Guardian — block-only. "None that change data" (PRD 7.1 row G): it
  // returns pass/block/replace decisions and holds no tools at all.
  guardian: [],
};

/** Tools that are in the 7.2 manifest but deliberately on NO agent's roster.
 * `record_meal_outcome` is A-level in 7.2 yet assigned to no specialist in 7.1
 * (it comes from explicit User statements via the UI/event flow). Every other
 * non-X manifest tool must appear on at least one roster — enforced by tests. */
export const UNASSIGNED_TOOL_ALLOWLIST: readonly ToolName[] = ['record_meal_outcome'];
