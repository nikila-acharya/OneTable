/**
 * GET /api/actions — the household's audit trail (WP-5.2 data source).
 * Optional: ?level=R|A|P|X &reversibleOnly=true &since=YYYY-MM-DD
 * Household comes from the session; rows are scoped through agent_run.
 */
import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listActions, type ActionView } from "@/lib/agents/persistence";

const LEVELS: ActionView["level"][] = ["R", "A", "P", "X"];

export async function GET(req: Request) {
  try {
    const { householdId } = await requireUser();
    const q = new URL(req.url).searchParams;

    const level = LEVELS.includes(q.get("level") as ActionView["level"])
      ? (q.get("level") as ActionView["level"])
      : undefined;

    const sinceRaw = q.get("since");
    const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw) : undefined;

    const actions = await listActions(getDb(), householdId, {
      level,
      reversibleOnly: q.get("reversibleOnly") === "true",
      since,
    });
    return NextResponse.json({ actions });
  } catch (e) {
    if (e instanceof AuthenticationError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
