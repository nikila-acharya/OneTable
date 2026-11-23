/**
 * POST /api/sources/import — import the household's linked sources in bulk.
 * Body (optional): { limit?: number }  (clamped 1..5 server-side)
 *
 * Thin by design: the work lives in `src/lib/intake/importSources.ts`, which is
 * where the DB access belongs and what the tests exercise. Every route in this
 * app follows that shape, and none of them import `db/schema` directly.
 *
 * Status codes:
 *   200  the run completed (some URLs may individually have been skipped)
 *   401  no session
 *   409  the household has no active website sources to import
 *   500  unexpected, logged via serverError and described only as server_error
 */
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { importLinkedSources, NoSourcesError } from "@/lib/intake/importSources";
import { serverError } from "../../../../lib/api/errors";

export async function POST(req: Request) {
  let limit: number | undefined;
  try {
    const body = (await req.json()) as { limit?: unknown };
    if (typeof body?.limit === "number" && Number.isFinite(body.limit)) limit = body.limit;
  } catch {
    // No body is a normal call: the default cap applies.
  }

  try {
    const { householdId } = await requireUser();
    const summary = await importLinkedSources(getDb(), householdId, { limit });
    return NextResponse.json(summary);
  } catch (e) {
    if (e instanceof AuthenticationError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    if (e instanceof NoSourcesError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: 409 });
    }
    return serverError("api/sources/import", e);
  }
}
