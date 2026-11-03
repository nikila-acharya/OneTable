/**
 * /api/sources — WP-2.7 CP04/CP01 source list + multi-link paste.
 * GET  -> every household source with its §16.5 status chip.
 * POST {links: string} -> add links (one row per link, platform detected
 * server-side); website links are queued as CP01 background imports;
 * social links create rows with NO network request (ADR-015 guard).
 */
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { addLinks, listSources } from "@/lib/sources/service";
import { getBoss } from "@/lib/intake/boss";
import { enqueueImport } from "@/lib/intake/jobs";

export async function GET() {
  try {
    const { householdId } = await requireUser();
    return NextResponse.json({ sources: await listSources(getDb(), householdId) });
  } catch (e) {
    if (e instanceof AuthenticationError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { householdId } = await requireUser();
    let body: { links?: unknown };
    try {
      body = (await req.json()) as { links?: unknown };
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    const links = typeof body.links === "string" ? body.links.slice(0, 20_000) : "";
    const result = await addLinks(getDb(), householdId, links);

    // CP01: website links go to the background queue through the guarded
    // enqueue (social links never reach here: addLinks only returns website
    // kind in websiteUrls, and enqueueImport re-checks the guard itself).
    let queued = 0;
    if (result.websiteUrls.length > 0) {
      try {
        const boss = await getBoss();
        if (boss) {
          for (const url of result.websiteUrls) {
            const enq = await enqueueImport(boss, { householdId, url });
            if (enq.ok) queued++;
          }
        }
      } catch {
        // rows are saved; the import can be retried from the card later
      }
    }

    return NextResponse.json(
      { added: result.added, rejected: result.rejected, queued },
      { status: result.added.length > 0 ? 201 : 200 },
    );
  } catch (e) {
    if (e instanceof AuthenticationError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
