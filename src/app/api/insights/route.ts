/**
 * GET /api/insights — member list with activity check-in history (WP-5.3 data
 * source). Health values are deliberately absent: NF-P6 keeps raw measurements
 * out of every reporting path, and they are encrypted at rest anyway (NF-P1).
 */
import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { householdInsights } from "@/lib/agents/persistence";

export async function GET() {
  try {
    const { householdId } = await requireUser();
    return NextResponse.json({ members: await householdInsights(getDb(), householdId) });
  } catch (e) {
    if (e instanceof AuthenticationError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
