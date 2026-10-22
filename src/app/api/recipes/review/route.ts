/** GET /api/recipes/review: this household's recipes waiting for a check (session required). */
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listNeedsReview } from "@/lib/recipes/review";

export async function GET() {
  try {
    const { householdId } = await requireUser();
    return NextResponse.json({ recipes: await listNeedsReview(getDb(), householdId) });
  } catch (e) {
    if (e instanceof AuthenticationError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
