/**
 * GET /api/monitoring/status — operational status, guarded by a shared secret.
 *
 * Scope, stated plainly because the scope is the interesting limitation: this
 * runs on serverless functions, so every number here describes THIS instance
 * since it last cold-started. It is not a view of the deployment. Anything that
 * needs to be true across requests has to be persisted, and nothing is
 * persisted today — see `errorReporting` below.
 *
 * What this deliberately does NOT do: report the dashboard from
 * `src/lib/monitoring.ts`. That module has no production callers and no tests,
 * its `getDashboard()` reads in-memory arrays that are empty on a fresh
 * instance (so `errorRate: 0, uptime: 100` would be a guess that always looks
 * healthy), `errorRate` is a count rather than a rate, and its Sentry call posts
 * to the placeholder URL "https://sentry.io/api/...". Surfacing those numbers
 * here would have made dead scaffolding look like observability.
 *
 * Privacy: no household, member, or user data is read or returned. Only whether
 * an integration's env var is SET — the value never leaves the environment.
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

  const set = (name: string) => Boolean(process.env[name]);

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
      integrations: {
        // Presence only. Unset means alerting and error reporting are inert.
        pagerduty: set("PAGERDUTY_KEY"),
        datadog: set("DATADOG_API_KEY"),
        sentry: set("SENTRY_DSN"),
      },
      errorReporting: "not_implemented",
      persistedMetrics: false,
    },
    // Not 200 when degraded: a status probe that answers "OK" while reporting a
    // failure is worse than no probe, because automation reads the code.
    { status: degraded ? 503 : 200 },
  );
}
