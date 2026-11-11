/**
 * GET /api/health — liveness + database reachability for the deploy pipeline.
 *
 * Deliberately unauthenticated but information-poor: it answers "is the app up
 * and can it reach Neon", nothing else. No household rows are read, no counts,
 * and the connection string never reaches the response.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

export async function GET() {
  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ status: "ok", db: "ok", latencyMs: Date.now() - started });
  } catch {
    // The reason is not echoed: a driver error can contain the host and user.
    return NextResponse.json({ status: "degraded", db: "unreachable" }, { status: 503 });
  }
}
