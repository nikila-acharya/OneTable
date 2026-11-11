/**
 * POST /api/actions/[id]/undo — revert one applied (A-level) action (AG05).
 * 7-day window; only rows carrying an undo payload qualify, and a row that is
 * already undone cannot be undone twice.
 */
import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { undoAction } from "@/lib/agents/persistence";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { householdId } = await requireUser();
    const { id } = await ctx.params;
    if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const outcome = await undoAction(getDb(), householdId, id);
    if (outcome === "undone") return NextResponse.json({ id, undoneAt: new Date().toISOString() });
    if (outcome === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (outcome === "window_closed") {
      return NextResponse.json({ error: "undo_window_closed" }, { status: 410 });
    }
    return NextResponse.json({ error: "not_reversible" }, { status: 409 });
  } catch (e) {
    if (e instanceof AuthenticationError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
