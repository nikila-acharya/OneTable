// ActionLog — seam to WP-0.5 (`agent_action` table).
// NF-P6: the log never contains health values. Summaries are built field-name-first
// here, before anything reaches the port.

export type ToolPermissionLevel = 'R' | 'A' | 'P' | 'X';

export interface ActionLogEntry {
  at: string;
  householdId: string;
  tool: string;
  level: ToolPermissionLevel;
  runId: string | null;
  agent: string | null;
  memberId: string | null;
  /** Field names + counts only. Never raw values for name, health or measurement fields. */
  inputsSummary: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
}

export interface ActionLog {
  record(entry: ActionLogEntry): Promise<void>;
}

export class InMemoryActionLog implements ActionLog {
  readonly entries: ActionLogEntry[] = [];

  async record(entry: ActionLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

export const noActionLog: ActionLog = {
  async record() {
    /* dev default: discard */
  },
};
