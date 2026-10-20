// WP-0.5 — Tool permission levels (PRD 7.2, TR-TOOLS). Canonical home of this type;
// the WP-1.2 seam copy in lib/members/action-log.ts should be replaced by imports of
// this module at merge time.

/** The four data-permission levels of PRD 7.2. X means "never available to the
 * agent": an X-level action must never be registered as an agent tool (PRD 13.2). */
export type ToolPermissionLevel = 'R' | 'A' | 'P' | 'X';

/** `delegate` is the Team level of PRD 7.2 (Coordinator-only structural tool). It is
 * not a data permission level; it exists so the roster and registry can enforce
 * "specialists never delegate". Logged as level 'Team'. */
export const TEAM_LEVEL = 'Team' as const;

/** Every level string a tool or an action-log row may carry. */
export type ToolLevel = ToolPermissionLevel | typeof TEAM_LEVEL | 'unknown';

export const PERMISSION_LEVELS: readonly ToolPermissionLevel[] = ['R', 'A', 'P', 'X'];

/** AG06 (PRD 7.2): autonomy settings may move a tool DOWN only, A -> P.
 * Nothing moves up. Nothing ever leaves X. */
export function canChangeLevel(current: ToolLevel, target: ToolPermissionLevel): boolean {
  return current === 'A' && target === 'P';
}
