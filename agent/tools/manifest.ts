// WP-0.5 — The tool manifest (PRD 7.2, TR-TOOLS). One source of truth for every
// tool name and its FIXED permission level. An agent cannot change a level; the
// registry refuses any implementation whose level disagrees with this manifest.

import { TEAM_LEVEL, type ToolLevel, type ToolPermissionLevel } from './levels';

/** X-level actions (PRD 7.2, last row). These names exist ONLY so the registry can
 * recognize attempts and log them. They are UI-only or not built; an implementation
 * for one of them can never be registered for an agent (PRD 13.2 "Never"). */
export const X_LEVEL_ACTIONS = [
  'confirm_allergen_safety',
  'set_allergies_or_conditions',
  'grant_or_withdraw_consent',
  'edit_rules_or_floors',
  'delete_data',
  'change_billing',
  'place_order',
  'send_message_outside_app',
] as const;

export const TOOL_MANIFEST = {
  // R — Read (runs freely)
  get_household: 'R',
  get_member_summary: 'R', // flags only, never raw health fields (NF-P5)
  list_recipes: 'R',
  get_recipe: 'R',
  get_plan: 'R',
  get_grocery_list: 'R',
  explain_rules_applied: 'R',
  get_tips: 'R',
  get_memory: 'R',
  list_outcomes: 'R',
  // Team — Coordinator only
  delegate: TEAM_LEVEL,
  // A — Act, then notify (reversible, low risk; logged with undo)
  import_recipe_url: 'A',
  draft_plan: 'A',
  propose_swap: 'A',
  reflow_week: 'A',
  draft_grocery_list: 'A',
  record_meal_outcome: 'A',
  record_checkin: 'A',
  write_memory: 'A',
  update_scoring_weights: 'A',
  schedule_nudge: 'A',
  // P — Propose, User approves (nothing changes until an approval record exists)
  create_approval: 'P',
  accept_plan: 'P',
  apply_reflow: 'P',
  bulk_import_source: 'P',
  create_or_update_member: 'P',
  set_attendance: 'P',
  set_activity_goal: 'P',
  send_to_instacart: 'P',
  change_household_settings: 'P',
  // X — Never available to the agent
  confirm_allergen_safety: 'X',
  set_allergies_or_conditions: 'X',
  grant_or_withdraw_consent: 'X',
  edit_rules_or_floors: 'X',
  delete_data: 'X',
  change_billing: 'X',
  place_order: 'X',
  send_message_outside_app: 'X',
} as const satisfies Record<string, ToolLevel>;

export type ToolName = keyof typeof TOOL_MANIFEST;

/** The manifest level of a name, or 'unknown' for a name that is not in the manifest. */
export function levelOf(name: string): ToolLevel {
  return (TOOL_MANIFEST as Record<string, ToolLevel | undefined>)[name] ?? 'unknown';
}

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_MANIFEST, name);
}

export function isPermissionLevel(level: string): level is ToolPermissionLevel {
  return level === 'R' || level === 'A' || level === 'P' || level === 'X';
}

/** Names by level, for roster/manifest consistency tests and coverage reports. */
export function toolNamesAtLevel(level: ToolLevel): ToolName[] {
  return (Object.keys(TOOL_MANIFEST) as ToolName[]).filter((n) => TOOL_MANIFEST[n] === level);
}
