/**
 * Agent-layer persistence (WP-5.5 plumbing).
 *
 * Maps the M4 agent objects onto the tables that already exist in db/schema.ts
 * (agent_conversation, agent_message, agent_run, agent_action, approval).
 * Nothing here invents a new table: the schema aggregate is the source of truth,
 * and every query is scoped by householdId so one household can never read
 * another's rows (tenant isolation comes from the session, not the request body).
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  activityCheckin,
  agentAction,
  agentConversation,
  agentMessage,
  agentRun,
  approval,
  member,
} from "../../../db/schema";
import type { Db } from "../db";
import type { ActionLogEntry, AgentRole, ApprovalCard, RunMode } from "@/agent/runtime";

/** agent_run_mode is chat|scheduled|event; the runtime calls the user path "conversational". */
export function toRunMode(mode: RunMode): "chat" | "scheduled" | "event" {
  return mode === "conversational" ? "chat" : mode;
}

/** WP-0.5: sha256 over canonically key-sorted JSON, so equal proposals hash equal. */
export function canonicalProposalHash(proposal: Record<string, unknown>): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, val]) => [k, canonical(val)]),
        )
      : v;
  return createHash("sha256").update(JSON.stringify(canonical(proposal))).digest("hex");
}

/** The household's chat thread, created on first use. */
export async function conversationFor(db: Db, householdId: string): Promise<string> {
  const [existing] = await db
    .select({ id: agentConversation.id })
    .from(agentConversation)
    .where(eq(agentConversation.householdId, householdId))
    .orderBy(desc(agentConversation.createdAt))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(agentConversation)
    .values({ householdId })
    .returning({ id: agentConversation.id });
  return created!.id;
}

export async function recordMessage(
  db: Db,
  args: { conversationId: string; householdId: string; role: "user" | "assistant"; content: string },
): Promise<void> {
  await db.insert(agentMessage).values({
    conversationId: args.conversationId,
    householdId: args.householdId,
    role: args.role,
    content: args.content,
  });
}

export async function startRun(
  db: Db,
  args: { householdId: string; agent: AgentRole; mode: RunMode; triggerRef?: string },
): Promise<string> {
  const [row] = await db
    .insert(agentRun)
    .values({
      householdId: args.householdId,
      agent: args.agent,
      mode: toRunMode(args.mode),
      triggerRef: args.triggerRef ?? null,
      status: "running",
    })
    .returning({ id: agentRun.id });
  return row!.id;
}

export async function finishRun(
  db: Db,
  runId: string,
  status: "completed" | "failed" | "blocked",
  tokens = 0,
  toolCalls = 0,
): Promise<void> {
  await db
    .update(agentRun)
    .set({ status, tokens, toolCalls, endedAt: new Date() })
    .where(eq(agentRun.id, runId));
}

/** Persist the proposal the user must decide on. Returns the row id (a UUID), not the card's local id. */
export async function saveApproval(
  db: Db,
  args: { householdId: string; runId: string | null; card: ApprovalCard },
): Promise<string> {
  const proposal = {
    summary: args.card.summary,
    tool: args.card.tool,
    proposedBy: args.card.proposedBy,
    diff: args.card.diff ?? {},
    expiresAt: args.card.expiresAt,
  };
  const [row] = await db
    .insert(approval)
    .values({
      householdId: args.householdId,
      runId: args.runId,
      tool: args.card.tool,
      proposalJson: proposal,
      proposalHash: canonicalProposalHash(proposal),
      status: "pending",
    })
    .returning({ id: approval.id });
  return row!.id;
}

export interface ApprovalView {
  id: string;
  tool: string;
  status: "pending" | "approved" | "declined" | "expired";
  summary: string;
  proposal: Record<string, unknown>;
  createdAt: string;
  decidedAt: string | null;
}

function toApprovalView(row: typeof approval.$inferSelect): ApprovalView {
  return {
    id: row.id,
    tool: row.tool,
    status: row.status,
    summary:
      typeof row.proposalJson.summary === "string" ? row.proposalJson.summary : row.tool,
    proposal: row.proposalJson,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

/** Household-scoped by construction: householdId is part of the WHERE, never trusted from a client filter. */
export async function listApprovals(
  db: Db,
  householdId: string,
  status?: ApprovalView["status"],
): Promise<ApprovalView[]> {
  const rows = await db
    .select()
    .from(approval)
    .where(
      status
        ? and(eq(approval.householdId, householdId), eq(approval.status, status))
        : eq(approval.householdId, householdId),
    )
    .orderBy(desc(approval.createdAt));
  return rows.map(toApprovalView);
}

export type ApprovalOutcome = "approved" | "declined" | "not_found" | "already_decided";

export async function decideApproval(
  db: Db,
  householdId: string,
  approvalId: string,
  decision: "approve" | "decline",
): Promise<ApprovalOutcome> {
  const [row] = await db
    .select({ id: approval.id, status: approval.status })
    .from(approval)
    .where(and(eq(approval.id, approvalId), eq(approval.householdId, householdId)));
  if (!row) return "not_found";
  if (row.status !== "pending") return "already_decided";

  await db
    .update(approval)
    .set({ status: decision === "approve" ? "approved" : "declined", decidedAt: new Date() })
    .where(eq(approval.id, approvalId));
  return decision === "approve" ? "approved" : "declined";
}

export interface ActionView {
  id: string;
  runId: string;
  agent: string;
  tool: string;
  level: "R" | "A" | "P" | "X";
  inputsSummary: Record<string, unknown>;
  resultSummary: Record<string, unknown> | null;
  reversible: boolean;
  undoneAt: string | null;
  createdAt: string;
}

function toActionView(row: typeof agentAction.$inferSelect): ActionView {
  return {
    id: row.id,
    runId: row.runId,
    agent: row.agent,
    tool: row.tool,
    level: row.level,
    inputsSummary: row.inputsSummary,
    resultSummary: row.resultSummary,
    // Only A-level writes carry an undo payload, and only until they are undone.
    reversible: row.level === "A" && row.undoPayload !== null && row.undoneAt === null,
    undoneAt: row.undoneAt ? row.undoneAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function recordAction(db: Db, runId: string, entry: ActionLogEntry): Promise<void> {
  await db.insert(agentAction).values({
    runId,
    agent: entry.agentRole,
    tool: entry.tool,
    level: entry.permissionLevel,
    inputsSummary: { summary: entry.inputsSummary, tokensUsed: entry.tokensUsed },
    resultSummary: { summary: entry.resultSummary },
    undoPayload: entry.undoable ? { previousStateRef: entry.id } : null,
  });
}

export async function listActions(
  db: Db,
  householdId: string,
  opts: { level?: "R" | "A" | "P" | "X"; reversibleOnly?: boolean; since?: Date } = {},
): Promise<ActionView[]> {
  // Actions hang off a run, so household scoping is via the join to agent_run.
  const conditions = [eq(agentRun.householdId, householdId)];
  if (opts.level) conditions.push(eq(agentAction.level, opts.level));
  if (opts.since) conditions.push(gte(agentAction.createdAt, opts.since));

  const rows = await db
    .select({ a: agentAction, runId: agentRun.id })
    .from(agentAction)
    .innerJoin(agentRun, eq(agentAction.runId, agentRun.id))
    .where(and(...conditions))
    .orderBy(desc(agentAction.createdAt));

  const views = rows.map((r) => toActionView(r.a));
  return opts.reversibleOnly ? views.filter((v) => v.reversible) : views;
}

export type UndoOutcome = "undone" | "not_found" | "not_reversible" | "window_closed";

/** AG05 / PRD: an applied action may be reverted within 7 days. */
const UNDO_WINDOW_DAYS = 7;

export async function undoAction(db: Db, householdId: string, actionId: string): Promise<UndoOutcome> {
  const [found] = await db
    .select({ a: agentAction, runId: agentRun.id })
    .from(agentAction)
    .innerJoin(agentRun, eq(agentAction.runId, agentRun.id))
    .where(and(eq(agentAction.id, actionId), eq(agentRun.householdId, householdId)));
  if (!found) return "not_found";
  if (found.a.level !== "A" || found.a.undoPayload === null) return "not_reversible";

  const ageDays = (Date.now() - found.a.createdAt.getTime()) / 86_400_000;
  if (ageDays > UNDO_WINDOW_DAYS) return "window_closed";

  await db
    .update(agentAction)
    .set({ undoneAt: new Date() })
    .where(eq(agentAction.id, actionId));
  return "undone";
}

export interface InsightMember {
  memberId: string;
  name: string;
  birthYm: string;
  checkins: Array<{ weekStart: string; status: string; note: string | null }>;
}

/** Aggregate for the dashboard. Health values are never read here (NF-P6). */
export async function householdInsights(db: Db, householdId: string): Promise<InsightMember[]> {
  const members = await db
    .select({ id: member.id, name: member.name, birthYm: member.birthYm })
    .from(member)
    .where(eq(member.householdId, householdId));

  const checkins = await db
    .select({
      memberId: activityCheckin.memberId,
      weekStart: activityCheckin.weekStart,
      status: activityCheckin.status,
      note: activityCheckin.note,
    })
    .from(activityCheckin)
    .innerJoin(member, eq(activityCheckin.memberId, member.id))
    .where(eq(member.householdId, householdId));

  return members.map((m) => ({
    memberId: m.id,
    name: m.name,
    birthYm: m.birthYm,
    checkins: checkins
      .filter((c) => c.memberId === m.id)
      .map((c) => ({ weekStart: String(c.weekStart), status: c.status, note: c.note })),
  }));
}
