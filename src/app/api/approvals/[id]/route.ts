/**
 * POST /api/approvals/[id] — record the user's decision on one proposal.
 * Body: { decision: "approve" | "decline" }.
 *
 * Only stores the decision. Applying an approved proposal is the agent's job
 * (and is what writes an undoable A-level action); this route never executes a
 * tool itself, so an approval cannot be replayed into a side effect here.
 */
import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { decideApproval } from "@/lib/agents/persistence";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const decision = body.decision;
  if (decision !== "approve" && decision !== "decline") {
    return NextResponse.json({ error: "decision_required" }, { status: 400 });
  }

  try {
    const { householdId } = await requireUser();
    const { id } = await ctx.params;
    if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const outcome = await decideApproval(getDb(), householdId, id, decision);
    if (outcome === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (outcome === "already_decided") {
      return NextResponse.json({ error: "already_decided" }, { status: 409 });
    }
    return NextResponse.json({ id, status: outcome });
  } catch (e) {
    if (e instanceof AuthenticationError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
