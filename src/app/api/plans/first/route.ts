/**
 * POST /api/plans/first — draft this household's plan for the current week.
 *
 * No body: everything (household, members, health, pool) is derived from the
 * session, so a request cannot name another household. Idempotent per week —
 * pressing twice returns the plan that already exists with `created: false`
 * and HTTP 200 rather than duplicating a week.
 *
 * Status codes:
 *   201  plan created
 *   200  plan already existed for this week (nothing written)
 *   401  no session
 *   409  nothing to plan for / every candidate excluded (members, allergens,
 *        nutrition) — a state problem, not a server fault
 *   501  the app cannot plan this household safely yet (diet provenance missing)
 */
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { generateWeekPlan, PlanError } from "@/lib/planning/firstPlan";
import { serverError } from "../../../../lib/api/errors";

export async function POST() {
  try {
    const { householdId } = await requireUser();
    const res = await generateWeekPlan(getDb(), householdId, new Date());
    return NextResponse.json(res, { status: res.created ? 201 : 200 });
  } catch (e) {
    if (e instanceof AuthenticationError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    if (e instanceof PlanError) {
      // 501 for a capability the product does not have yet, 409 for a household
      // state that blocks planning. Both are honest; neither is a mystery 500.
      const status = e.code === "pool_blocked" ? 501 : 409;
      return NextResponse.json(
        { error: e.code, message: e.message, ...(e.detail ? { detail: e.detail } : {}) },
        { status },
      );
    }
    return serverError("api/plans/first", e);
  }
}
