/**
 * POST /api/onboarding/complete  (household session required)
 * Body: the onboarding draft (version 1). 201 on success; 422 with the issues
 * list when the draft is refused (nothing is written); 401 without a session.
 */
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { completeOnboarding, OnboardingRejectedError } from "@/lib/onboarding/complete";
import type { OnboardingDraft } from "@/app/onboarding/store";

function looksLikeDraft(b: unknown): b is OnboardingDraft {
  if (typeof b !== "object" || b === null) return false;
  const d = b as Record<string, unknown>;
  return d.version === 1 && Array.isArray(d.members) && Array.isArray(d.meals) && typeof d.household === "object" && d.household !== null && typeof d.consent === "object" && d.consent !== null;
}

export async function POST(req: Request) {
  try {
    const { householdId } = await requireUser();
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    if (!looksLikeDraft(body)) return NextResponse.json({ error: "invalid_draft" }, { status: 400 });
    const res = await completeOnboarding(getDb(), householdId, body, new Date());
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    if (e instanceof AuthenticationError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (e instanceof OnboardingRejectedError) return NextResponse.json({ error: e.code, issues: e.issues }, { status: 422 });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
