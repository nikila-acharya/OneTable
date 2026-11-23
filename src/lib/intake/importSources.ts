/**
 * Bulk import of a household's LINKED sources.
 *
 * `/api/recipes/import` handles one pasted link; this covers the sources a
 * household already saved and never read. It composes the existing pieces
 * rather than reimplementing them: `importRecipeFromUrl` (robots-aware fetch,
 * schema.org parse, LLM fallback, save) then `enrichRecipe` (allergen
 * attribution + USDA nutrition roll-up), which are together the last mile that
 * made the planning pool unable to return anything.
 *
 * Boundaries, all deliberate:
 * - at most 5 URLs per call, because this runs inside a serverless request while
 *   the fetcher is politely sleeping 1s between hits and honouring crawl-delay;
 *   `remaining` lets the caller press again;
 * - already-imported links are skipped without a network call, so repeating is
 *   cheap and cannot duplicate a recipe;
 * - no pg-boss. The queue's worker has no runner on Vercel (ADR-118/119
 *   context), which is the reason this path exists synchronously.
 */
import { and, eq } from "drizzle-orm";
import { recipe, source } from "../../../db/schema";
import type { Db } from "../db";
import { createFetcher } from "./fetcher";
import { checkPublicUrl } from "./url";
import { importRecipeFromUrl } from "../recipes/import";
import { openRouterClient } from "../recipes/openrouter-client";
import { DEFAULT_PARSER_MODEL } from "../recipes/llm-parser";
import { createFdcClient } from "../nutrition/fdc";
import { enrichRecipe } from "./enrich";

export const IMPORT_CAP = 5;

export type ImportOutcome =
  | { url: string; status: "imported"; recipeId: string; parseMethod: string; nutrition: string; allergenFlaggedLines: number; dietTags: string[] }
  | { url: string; status: "needs_review"; recipeId: string; unsure: string[]; nutrition: string }
  | { url: string; status: "already_imported" }
  | { url: string; status: "skipped"; reason: string };

export interface ImportSummary {
  imported: ImportOutcome[];
  skipped: ImportOutcome[];
  alreadyImported: number;
  remaining: number;
  /** Reported rather than hidden: without these keys the run is deliberately partial. */
  llmFallbackConfigured: boolean;
  nutritionConfigured: boolean;
  plannerReady: number;
}

export class NoSourcesError extends Error {
  readonly code = "no_sources" as const;
  constructor() {
    super("this household has no active website sources to import from");
    this.name = "NoSourcesError";
  }
}

export async function importLinkedSources(
  db: Db,
  householdId: string,
  opts: { limit?: number; fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {},
): Promise<ImportSummary> {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const limit = Math.min(IMPORT_CAP, Math.max(1, Math.trunc(opts.limit ?? IMPORT_CAP)));

  const rows = await db
    .select({ url: source.url, status: source.status, kind: source.kind })
    .from(source)
    .where(eq(source.householdId, householdId));

  const linked = [
    ...new Set(
      rows
        .filter((s) => s.kind === "website" && s.status === "active" && typeof s.url === "string" && s.url.length > 0)
        .map((s) => s.url as string),
    ),
  ];
  if (!linked.length) throw new NoSourcesError();

  // The SSRF gate is re-applied HERE, at fetch time, and not trusted from link
  // entry. `source` rows written before checkPublicUrl existed, or by any future
  // path that inserts a URL directly, would otherwise send the app to
  // 169.254.169.254 / 10.0.0.5 / http://localhost - and this is a route that
  // fetches on a household's behalf, so the response body becomes theirs.
  const candidates: string[] = [];
  const refused: ImportOutcome[] = [];
  for (const u of linked) {
    const pub = checkPublicUrl(u);
    if (pub.ok) candidates.push(pub.url);
    else refused.push({ url: u, status: "skipped", reason: "That link is not a public web page, so it was not fetched." });
  }
  if (!candidates.length) {
    return {
      imported: [],
      skipped: refused,
      alreadyImported: 0,
      remaining: 0,
      llmFallbackConfigured: false,
      nutritionConfigured: false,
      plannerReady: 0,
    };
  }

  // Skip anything already saved from this URL: no network, no duplicate recipe.
  const known = await db
    .select({ sourceUrl: recipe.sourceUrl })
    .from(recipe)
    .where(and(eq(recipe.householdId, householdId)));
  const already = new Set(known.map((k) => k.sourceUrl).filter(Boolean) as string[]);

  const fetcher = createFetcher({
    fetchImpl: opts.fetchImpl ?? fetch,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });

  const llmKey = env.LLM_API_KEY;
  const fdcKey = env.FDC_API_KEY;
  const deps = {
    fetchPage: (u: string) => fetcher.fetchPage(u),
    llm: llmKey ? { client: openRouterClient({ apiKey: llmKey }), model: env.PARSER_MODEL || DEFAULT_PARSER_MODEL } : undefined,
  };
    const fdc = fdcKey ? createFdcClient({ apiKey: fdcKey }) : undefined;

  const outcomes: ImportOutcome[] = [];
  let attempted = 0;
  for (const url of candidates) {
    if (already.has(url)) {
      outcomes.push({ url, status: "already_imported" });
      continue;
    }
    if (attempted >= limit) continue;
    attempted++;

    const res = await importRecipeFromUrl(db, deps, householdId, url);
    if (res.status === "skipped" || res.status === "manual") {
      outcomes.push({ url, status: "skipped", reason: res.reason });
      continue;
    }

    const e = await enrichRecipe(db, householdId, res.recipeId, { fdc });
    outcomes.push(
      res.status === "ready"
        ? {
            url,
            status: "imported",
            recipeId: res.recipeId,
            parseMethod: res.parseMethod,
            nutrition: e.nutrition.status,
            allergenFlaggedLines: e.flaggedLines,
            dietTags: e.dietTags,
          }
        : { url, status: "needs_review", recipeId: res.recipeId, unsure: res.unsure, nutrition: e.nutrition.status },
    );
  }

  const fresh = candidates.filter((u) => !already.has(u));
  const importedList = outcomes.filter((o) => o.status === "imported" || o.status === "needs_review");
  return {
    imported: importedList,
    skipped: outcomes.filter((o) => o.status === "skipped"),
    alreadyImported: outcomes.filter((o) => o.status === "already_imported").length,
    remaining: Math.max(0, fresh.length - attempted),
    llmFallbackConfigured: Boolean(llmKey),
    nutritionConfigured: Boolean(fdcKey),
    plannerReady: importedList.filter((o) => o.status === "imported" && o.nutrition === "mapped").length,
  };
}
