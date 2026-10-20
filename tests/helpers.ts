// Test fixtures and helpers for WP-0.5 tool-layer tests.

import { randomUUID } from 'node:crypto';
import { AGENT_IDS, AGENT_ROSTER, type AgentId } from '../agent/roster';
import { TOOL_MANIFEST, type ToolName } from '../agent/tools/manifest';
import { ToolRegistry, type ToolImplementation } from '../agent/tools/registry';
import { InMemoryApprovalStore } from '../agent/tools/approvals';
import type { ActionLog, ActionLogEntry } from '../agent/tools/action-log';
import type { JsonValue } from '../agent/tools/json';

/** Fixed clock so expiry math is deterministic. */
export const T0 = Date.parse('2026-10-16T12:00:00.000Z');

export function fixedClock(start: number = T0) {
  const state = { ms: start };
  return {
    now: () => new Date(state.ms),
    advance: (days: number) => {
      state.ms += days * 24 * 60 * 60 * 1000;
    },
    at: (ms: number) => {
      state.ms = ms;
    },
  };
}

export interface RecordingActionLog extends ActionLog {
  readonly entries: (ActionLogEntry & { id: string })[];
  record(entry: ActionLogEntry): Promise<void>;
  byTool(tool: string): (ActionLogEntry & { id: string })[];
}

export function makeRecordingActionLog(): RecordingActionLog {
  const entries: (ActionLogEntry & { id: string })[] = [];
  return {
    entries,
    async record(entry) {
      entries.push({ ...entry, id: randomUUID() });
    },
    byTool(tool: string) {
      return entries.filter((e) => e.tool === tool);
    },
  };
}

/** Execution counter shared by stub handlers — proves "nothing changed". */
export interface ExecutionSink {
  calls: { tool: string; input: Record<string, unknown> }[];
  /** When set, the handler for this tool throws. */
  throwOn?: string;
  /** When set, returned as the undoPayload of A-level results. */
  undoFor?: Partial<Record<ToolName, unknown>>;
}

export function stubTool(name: ToolName, sink: ExecutionSink): ToolImplementation {
  return {
    name,
    level: TOOL_MANIFEST[name],
    jsonSchema: { type: 'object', additionalProperties: true },
    handler(input) {
      if (sink.throwOn === name) throw new Error('handler exploded');
      sink.calls.push({ tool: name, input });
      return { result: { stubbed: name }, undoPayload: (sink.undoFor?.[name] ?? null) as JsonValue | null };
    },
  };
}

/** A registry with every non-X roster tool registered for its agent. */
export function buildFullRegistry(
  overrides: { autonomy?: ConstructorParameters<typeof ToolRegistry>[0]['autonomy']; clock?: ReturnType<typeof fixedClock> } = {},
): {
  registry: ToolRegistry;
  approvals: InMemoryApprovalStore;
  log: RecordingActionLog;
  sink: ExecutionSink;
  clock: ReturnType<typeof fixedClock>;
} {
  const approvals = new InMemoryApprovalStore();
  const log = makeRecordingActionLog();
  const sink: ExecutionSink = { calls: [] };
  const clock = overrides.clock ?? fixedClock();
  const registry = new ToolRegistry({ approvals, actionLog: log, now: clock.now, autonomy: overrides.autonomy });
  for (const agent of AGENT_IDS) {
    for (const name of AGENT_ROSTER[agent]) {
      registry.register(agent, stubTool(name, sink));
    }
  }
  return { registry, approvals, log, sink, clock };
}

export function callAs(
  registry: ToolRegistry,
  agent: AgentId,
  tool: string,
  input: Record<string, unknown> = {},
  opts: { runId?: string; householdId?: string; memberId?: string | null } = {},
) {
  return registry.call(agent, tool, input, {
    runId: opts.runId ?? 'run-1',
    householdId: opts.householdId ?? 'hh-demo',
    memberId: opts.memberId ?? null,
  });
}

export const ALL_X_NAMES = Object.keys(TOOL_MANIFEST).filter((n) => TOOL_MANIFEST[n as ToolName] === 'X') as ToolName[];
