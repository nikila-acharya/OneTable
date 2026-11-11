/**
 * GET /api/approvals — the household's approval inbox.
 * Optional ?status=pending|approved|declined|expired. Household comes from the session.
 */
import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listApprovals, type ApprovalView } from "@/lib/agents/persistence";

const STATUSES: ApprovalView["status"][] = ["pending", "approved", "declined", "expired"];

export async function GET(req: Request) {
  try {
    const { householdId } = await requireUser();
    const raw = new URL(req.url).searchParams.get("status");
    const status = STATUSES.includes(raw as ApprovalView["status"])
      ? (raw as ApprovalView["status"])
      : undefined;

    return NextResponse.json({ approvals: await listApprovals(getDb(), householdId, status) });
  } catch (e) {
    if (e instanceof AuthenticationError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
