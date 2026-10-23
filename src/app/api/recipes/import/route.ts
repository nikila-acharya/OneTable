/** POST /api/recipes/import {url}: import one recipe link into the household's box (session required). */
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createFetcher } from "@/lib/intake/fetcher";
import { importRecipeFromUrl } from "@/lib/recipes/import";
import { openRouterClient } from "@/lib/recipes/openrouter-client";
import { DEFAULT_PARSER_MODEL } from "@/lib/recipes/llm-parser";

export async function POST(req: Request) {
  let body: { url?: unknown };
  try {
    body = (await req.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    const { householdId } = await requireUser();
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const fetcher = createFetcher({ fetchImpl: fetch, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
    const key = process.env.LLM_API_KEY;
    const result = await importRecipeFromUrl(getDb(), {
      fetchPage: (u) => fetcher.fetchPage(u),
      llm: key ? { client: openRouterClient({ apiKey: key }), model: process.env.PARSER_MODEL || DEFAULT_PARSER_MODEL } : undefined,
    }, householdId, url);
    return NextResponse.json(result, { status: result.status === "ready" || result.status === "needs_review" ? 201 : 200 });
  } catch (e) {
    if (e instanceof AuthenticationError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
