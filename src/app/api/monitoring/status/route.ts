/**
 * GET /api/monitoring/status — operational status, guarded by a shared secret.
 *
 * Scope, stated plainly because the scope is the interesting limitation: this
 * runs on serverless functions, so every number here describes THIS instance
 * since it last cold-started. It is not a view of the deployment. Anything that
 * needs to be true across requests has to be persisted, and nothing is
 * persisted today — see `errorReporting` below.
 *
 * What this deliberately does NOT do: report a dashboard of collected metrics.
 * `src/lib/monitoring.ts` (and `analytics.ts`, `audit.ts`) were deleted in
 * ADR-118 rather than wired up here: no production callers, no tests, a Sentry
 * call to the placeholder URL "https://sentry.io/api/...", PagerDuty alerts
 * fired without await, health checks using a relative URL that cannot resolve
 * server-side, and `errorRate`/`uptime` computed from in-memory arrays that read
 * healthy on every cold start. Surfacing those would have made dead scaffolding
 * look like observability - and their household-keyed in-memory stores would
 * have been invisible to PV03 erasure.
 *
 * Privacy: no household, member, or user data is read or returned.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

/** Compared via SHA-256 so the check is constant-time regardless of length. */
function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const expected = process.env.MONITORING_TOKEN;
  if (!expected) {
    // Fail closed and say why: an unset token means no client can ever be
    // authorised, which is a configuration problem, not a caller error.
    return NextResponse.json(
      { error: "monitoring_not_configured" },
      { status: 501 },
    );
  }

  const presented = request.headers.get("x-monitoring-token");
  if (!tokenMatches(presented, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  let db: { status: "ok" | "unreachable"; latencyMs?: number } = { status: "ok" };
  try {
    await getDb().execute(sql`select 1`);
    db = { status: "ok", latencyMs: Date.now() - started };
  } catch {
    // Reason withheld: driver errors carry host and user.
    db = { status: "unreachable" };
  }

  const degraded = db.status !== "ok";
  return NextResponse.json(
    {
      status: degraded ? "degraded" : "ok",
      generatedAt: new Date().toISOString(),
      scope: "instance",
      scopeNote:
        "Serverless: figures describe this instance since its last cold start, not the deployment.",
      uptimeSec: Math.round(process.uptime()),
      checks: { database: db },
      // Honest gaps, not future work that already exists. There is deliberately
      // no `integrations` presence block here: ADR-118 removed the only code
      // that would have used those keys, so advertising them as settable would
      // invite someone to configure alerting that cannot fire.
      errorReporting: "not_implemented",
      persistedMetrics: false,
      alerting: "not_implemented",
    },
    // Not 200 when degraded: a status probe that answers "OK" while reporting a
    // failure is worse than no probe, because automation reads the code.
    { status: degraded ? 503 : 200 },
  );
}
