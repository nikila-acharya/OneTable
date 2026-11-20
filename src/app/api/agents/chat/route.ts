/**
 * POST /api/agents/chat — send one household message to the Coordinator.
 *
 * The household comes from the session (requireUser), never from the request
 * body, so a client cannot address another household's agents. The run, the
 * two chat messages, and any proposal the Coordinator raises are persisted to
 * the agent tables that already exist in db/schema.ts.
 */
import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AgentRuntime } from "@/agent/runtime";
import type { ApprovalCard } from "@/agent/runtime";
import { SafetyGuardian } from "@/agent/safety-guardian";
import { Coordinator } from "@/agent/coordinator";
import {
  conversationFor,
  finishRun,
  recordMessage,
  saveApproval,
  startRun,
} from "@/lib/agents/persistence";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "message_required" }, { status: 400 });

  try {
    const { userId, householdId } = await requireUser();
    const db = getDb();

    const conversationId = await conversationFor(db, householdId);
    await recordMessage(db, { conversationId, householdId, role: "user", content: message });

    const runId = await startRun(db, {
      householdId,
      agent: "coordinator",
      mode: "conversational",
      triggerRef: "user_message",
    });

    const runtime = new AgentRuntime(householdId, "household");
    const context = runtime.createContext(runId, "conversational", "user_message", userId);
    const guardian = new SafetyGuardian(context);
    const coordinator = new Coordinator(context, runtime, guardian);

    const response = await coordinator.handleUserRequest(message);

    // Persist the proposal so the inbox survives a reload, and return the row id:
    // the card's in-memory id is not a UUID and cannot address the table.
    let approvalId: string | null = null;
    if (response.approvalCard) {
      const card: ApprovalCard = {
        id: response.approvalCard.id,
        createdAt: new Date().toISOString(),
        expiresAt: response.approvalCard.expiresAt,
        householdId,
        proposedBy: "coordinator",
        tool: response.approvalCard.tool ?? "plan.propose",
        summary: response.approvalCard.summary,
        diff: response.approvalCard.diff,
      };
      approvalId = await saveApproval(db, { householdId, runId, card });
    }

    await recordMessage(db, {
      conversationId,
      householdId,
      role: "assistant",
      content: response.message,
    });
    await finishRun(
      db,
      runId,
      response.success ? "completed" : "failed",
      context.budget.tokensUsed,
      context.budget.toolCallsUsed,
    );

    return NextResponse.json({
      runId,
      message: response.message,
      cards: response.cards,
      approvalId,
      delegationsSummary: response.delegationsSummary ?? null,
      budgetStatus: response.budgetStatus ?? null,
    });
  } catch (e) {
    if (e instanceof AuthenticationError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
