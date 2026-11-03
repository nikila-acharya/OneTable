/**
 * POST /api/sources/:id/website {url} — CP04 "Add their website" flow.
 * Creates a website source linked to the trusted-creator card and queues
 * its import. Refuses non-website links in plain words.
 */
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { linkWebsite } from "@/lib/sources/service";
import { getBoss } from "@/lib/intake/boss";
import { enqueueImport } from "@/lib/intake/jobs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { householdId } = await requireUser();
    const { id } = await params;
    let body: { url?: unknown };
    try {
      body = (await req.json()) as { url?: unknown };
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    if (typeof body.url !== "string") return NextResponse.json({ error: "invalid_url" }, { status: 400 });

    const res = await linkWebsite(getDb(), householdId, id, body.url);
    if (!res.ok) {
      const status = res.reason === "not_found" ? 404 : 422;
      return NextResponse.json({ error: res.reason }, { status });
    }

    const boss = await getBoss();
    if (boss) {
      try {
        await enqueueImport(boss, { householdId, url: res.websiteUrl });
      } catch {
        // queued later or by hand; the source row is what matters
      }
    }
    return NextResponse.json({ card: res.card }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthenticationError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
