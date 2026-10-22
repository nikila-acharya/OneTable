/** GET /api/onboarding/summary (household session): what the server stored. 401 without a session. */
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getOnboardingSummary } from "@/lib/onboarding/summary";

export async function GET() {
  try {
    const { householdId } = await requireUser();
    return NextResponse.json(await getOnboardingSummary(getDb(), householdId));
  } catch (e) {
    if (e instanceof AuthenticationError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
