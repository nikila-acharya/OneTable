// WP-0.5 — Tool registry (PRD 7.2 TR-TOOLS, 7.1a least privilege, 10.2 tool layer).
// The registry builds each agent's *registered tool context* from the roster. The
// security properties it enforces (each one is a 7.2/7.7 acceptance criterion):
//
// 1. X-level actions can never be registered for any agent (PRD 13.2). Attempts
//    fail server-side as `no_such_tool` and are logged (7.2 AC).
// 2. A tool not on the agent's roster entry is not registered in that agent's
//    context and fails the same way, logged (7.1a + 7.2 AC).
// 3. A tool's permission level is fixed by the manifest; an implementation
//    declaring a different level is rejected — the agent (and the code) cannot
//    raise a level. Autonomy settings may only move a tool DOWN, A -> P (AG06).
// 4. P-level tools never change data without a matching, unexpired approval whose
//    payload hash matches the exact input (7.2 AC, 7.7 AG05).
// 5. Every tool call — allowed, denied, executed, or approval-requested — is
//    written to the action log with NF-P6-safe summaries (7.7).

import { AGENT_ROSTER, isAgentId, type AgentId } from '../roster';
import { isToolName, levelOf, TOOL_MANIFEST, type ToolName } from './manifest';
import { canChangeLevel, type ToolLevel, type ToolPermissionLevel } from './levels';
import { summarize } from './redact';
import type { JsonValue, ToolJsonSchema } from './json';
import { newApproval, hashProposal, type ApprovalStore } from './approvals';
import type { ActionLog, ActionLogEntry } from './action-log';

export interface ToolHandlerResult {
  /** JSON-serializable structured result. User-facing text leaves this layer
   * only through the Safety Guardian (PRD 7.3) — the runtime, built in M4, wires that. */
  result: unknown;
  /** A-level actions should return the exact previous state needed for undo (7.7). */
  undoPayload?: JsonValue | null;
}

export interface ToolCallInfo {
  agent: AgentId;
  runId: string;
  householdId: string;
  now: () => Date;
}

export interface ToolImplementation {
  name: ToolName;
  /** Must match the manifest EXACTLY. Registration rejects any other value. */
  level: ToolLevel;
  jsonSchema: ToolJsonSchema;
  handler(input: Record<string, unknown>, call: ToolCallInfo): ToolHandlerResult | Promise<ToolHandlerResult>;
}

export type ToolCallError =
  | 'no_such_tool'
  | 'invalid_input'
  | 'approval_not_found'
  | 'approval_wrong_tool'
  | 'approval_wrong_household'
  | 'approval_expired'
  | 'approval_not_approved'
  | 'approval_payload_mismatch'
  | 'tool_error';

export type ToolCallOutcome =
  | { ok: true; outcome: 'executed'; tool: ToolName; result: unknown }
  | { ok: true; outcome: 'approval_requested'; tool: ToolName; approvalId: string; expiresAt: string }
  | { ok: false; error: ToolCallError; tool: string };

export type AutonomyOverrides = Readonly<Partial<Record<ToolName, ToolPermissionLevel>>>;

export interface RegistryOptions {
  approvals: ApprovalStore;
  actionLog: ActionLog;
  now?: () => Date;
  /** AG06: user autonomy settings. Only A -> P is accepted (7.2); anything else
   * throws at construction. */
  autonomy?: AutonomyOverrides;
}

interface RegisteredTool {
  impl: ToolImplementation;
  /** Manifest level, or 'P' when demoted by autonomy (never anything else). */
  effectiveLevel: ToolLevel;
}

const APPROVAL_ID_KEY = 'approvalId';

export class ToolRegistry {
  private readonly contexts = new Map<AgentId, Map<ToolName, RegisteredTool>>();
  private readonly autonomy: AutonomyOverrides;
  private readonly now: () => Date;

  constructor(private readonly opts: RegistryOptions) {
    this.now = opts.now ?? (() => new Date());
    this.autonomy = opts.autonomy ?? {};
    for (const [name, target] of Object.entries(this.autonomy)) {
      if (!isToolName(name)) throw new Error(`autonomy: unknown tool ${name}`);
      if (!canChangeLevel(levelOf(name), target)) {
        throw new Error(`autonomy: ${name} cannot move ${levelOf(name)} -> ${target}; only A -> P is allowed`);
      }
    }
  }

  /** Register one implementation into one agent's context. Every rule that must
   * fail closed fails here, loudly. */
  register(agent: AgentId, impl: ToolImplementation): void {
    if (!isAgentId(agent)) throw new Error(`register: unknown agent ${String(agent)}`);
    if (!isToolName(impl.name)) throw new Error(`register: ${impl.name} is not in the tool manifest`);

    const manifestLevel = TOOL_MANIFEST[impl.name];
    if (manifestLevel === 'X') {
      // PRD 13.2 "Never register an X-level action as an agent tool".
      throw new Error(`register: ${impl.name} is X-level and can never be an agent tool`);
    }
    if (impl.level !== manifestLevel) {
      throw new Error(`register: ${impl.name} declares level ${impl.level} but the manifest fixes ${manifestLevel}`);
    }
    if (!AGENT_ROSTER[agent].includes(impl.name)) {
      throw new Error(`register: ${impl.name} is not on the roster for agent ${agent}`);
    }

    const map = this.contexts.get(agent) ?? new Map<ToolName, RegisteredTool>();
    if (map.has(impl.name)) throw new Error(`register: ${impl.name} already registered for ${agent}`);
    map.set(impl.name, {
      impl,
      effectiveLevel: this.autonomy[impl.name] === 'P' ? 'P' : manifestLevel,
    });
    this.contexts.set(agent, map);
  }

  /** Register every implementation on an agent's roster that was provided.
   * `tools` must cover exactly the roster for that agent. */
  registerAgent(agent: AgentId, tools: readonly ToolImplementation[]): void {
    const roster = AGENT_ROSTER[agent];
    const provided = new Set(tools.map((t) => t.name));
    for (const name of roster) {
      if (!provided.has(name)) throw new Error(`registerAgent(${agent}): missing roster tool ${name}`);
    }
    for (const t of tools) this.register(agent, t);
  }

  /** The registered tool context handed to the LLM for this agent. X-level tools
   * are provably never present here (see tests/x-not-registered.test.ts). */
  toolsFor(agent: AgentId): readonly { name: ToolName; level: ToolLevel; jsonSchema: ToolJsonSchema }[] {
    const map = this.contexts.get(agent);
    if (!map) return [];
    return [...map.values()].map((r) => ({
      name: r.impl.name,
      level: r.effectiveLevel,
      jsonSchema: r.impl.jsonSchema,
    }));
  }

  /** Server-side dispatch for a model tool call. Denied calls are logged, too. */
  async call(
    agent: AgentId,
    name: string,
    input: Record<string, unknown>,
    call: { runId: string; householdId: string; memberId?: string | null },
  ): Promise<ToolCallOutcome> {
    const at = this.now().toISOString();
    const entry = (over: Partial<ActionLogEntry>): ActionLogEntry => ({
      at,
      householdId: call.householdId,
      tool: name,
      // The manifest level is recorded even for denied attempts, so the inbox can
      // show "agent tried an X-level action" (7.2 AC). Unknown names log 'unknown'.
      level: levelOf(name),
      runId: call.runId,
      agent: isAgentId(agent) ? agent : null,
      memberId: call.memberId ?? null,
      ok: true,
      errorCode: null,
      inputsSummary: summarize(input),
      resultSummary: {},
      ...over,
    });

    const fail = async (error: ToolCallError): Promise<ToolCallOutcome> => {
      await this.opts.actionLog.record(entry({ ok: false, errorCode: error, resultSummary: { error } }));
      return { ok: false, error, tool: name };
    };

    if (!isAgentId(agent)) return fail('no_such_tool');
    const registered = this.contexts.get(agent)?.get(name as ToolName);
    if (!registered) {
      // X-level, off-roster, unknown name, or not registered: same server-side
      // outcome ("no such tool is registered for that agent") + logged attempt.
      return fail('no_such_tool');
    }
    const impl = registered.impl;

    const invalid = validateInput(impl.jsonSchema, input);
    if (invalid) return fail('invalid_input');

    try {
      if (registered.effectiveLevel === 'P') {
        const approvalOutcome = await this.handleP(impl, input, call, at, entry);
        if (approvalOutcome.ok === false) return approvalOutcome;
        if (approvalOutcome.outcome === 'approval_requested') return approvalOutcome;
        // fall through with approved, exact input
        input = approvalOutcome.approvedInput;
      }

      const handlerResult = await impl.handler(input, {
        agent,
        runId: call.runId,
        householdId: call.householdId,
        now: this.now,
      });

      await this.opts.actionLog.record(
        entry({
          resultSummary: summarize(handlerResult.result),
          undoPayload: registered.effectiveLevel === 'A' ? (handlerResult.undoPayload ?? null) : null,
        }),
      );
      return { ok: true, outcome: 'executed', tool: impl.name, result: handlerResult.result };
    } catch (err) {
      await this.opts.actionLog.record(
        entry({ ok: false, errorCode: 'tool_error', resultSummary: { error: 'tool_error', reason: String(messageOf(err)) } }),
      );
      return { ok: false, error: 'tool_error', tool: name };
    }
  }

  /** Two-phase P execution (7.2 AC). Nothing changes data without a matching
   * approved record whose hash binds the exact payload. */
  private async handleP(
    impl: ToolImplementation,
    input: Record<string, unknown>,
    call: { runId: string; householdId: string },
    at: string,
    entry: (over: Partial<ActionLogEntry>) => ActionLogEntry,
  ): Promise<
    | { ok: false; error: ToolCallError; tool: string }
    | { ok: true; outcome: 'approval_requested'; tool: ToolName; approvalId: string; expiresAt: string }
    | { ok: true; outcome: 'executed'; approvedInput: Record<string, unknown> }
  > {
    const approvalId = typeof input[APPROVAL_ID_KEY] === 'string' ? (input[APPROVAL_ID_KEY] as string) : null;
    const payload = stripKey(input, APPROVAL_ID_KEY);

    if (!approvalId) {
      const record = newApproval({
        householdId: call.householdId,
        runId: call.runId,
        tool: impl.name,
        proposalJson: payload as JsonValue,
        now: this.now(),
      });
      await this.opts.approvals.create(record);
      await this.opts.actionLog.record(
        entry({ resultSummary: { outcome: 'approval_requested', approvalId: record.id, status: 'pending' } }),
      );
      return {
        ok: true,
        outcome: 'approval_requested',
        tool: impl.name,
        approvalId: record.id,
        expiresAt: record.expiresAt,
      };
    }

    const store = this.opts.approvals;
    const record = await store.get(approvalId);
    if (!record) return { ok: false, error: 'approval_not_found', tool: impl.name };
    if (record.tool !== impl.name) return { ok: false, error: 'approval_wrong_tool', tool: impl.name };
    if (record.householdId !== call.householdId) return { ok: false, error: 'approval_wrong_household', tool: impl.name };
    if (record.status === 'expired') return { ok: false, error: 'approval_expired', tool: impl.name };
    if (record.status !== 'approved') return { ok: false, error: 'approval_not_approved', tool: impl.name };
    if (Date.parse(record.expiresAt) <= this.now().getTime()) {
      // DB stores expire lazily on read; cover in-memory stores too (7.7: 7 days).
      await store.setStatus(record.id, 'expired', this.now().toISOString());
      return { ok: false, error: 'approval_expired', tool: impl.name };
    }
    if (hashProposal(payload) !== record.proposalHash) {
      return { ok: false, error: 'approval_payload_mismatch', tool: impl.name };
    }
    return { ok: true, outcome: 'executed', approvedInput: payload };
  }
}

function stripKey(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const { [key]: _drop, ...rest } = obj;
  return rest;
}

function messageOf(err: unknown): unknown {
  return err instanceof Error ? err.message : err;
}

const JSON_TYPE_CHECKS: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
};

/** Minimal schema validation for the skeleton: object, required keys, declared
 * types, no unknown keys when properties are declared (approvalId is always
 * tolerated on P-level calls). */
export function validateInput(schema: ToolJsonSchema, input: unknown): string | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'input must be an object';
  const obj = input as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (obj[key] === undefined) return `missing required property '${key}'`;
  }
  const props = schema.properties;
  if (props) {
    for (const [key, value] of Object.entries(obj)) {
      if (key === APPROVAL_ID_KEY) continue;
      const decl = props[key];
      if (!decl) return schema.additionalProperties === true ? null : `unknown property '${key}'`;
      if (!JSON_TYPE_CHECKS[decl.type]?.(value)) return `property '${key}' must be of type ${decl.type}`;
    }
  }
  return null;
}
