/**
 * WP-2.2 harness run: parse the 40 blog pages in docs/harness/url-set.json with the
 * schema.org parser, fetching through the CP01 fetcher (robots.txt, 1 req/s per domain).
 * Full extracted text goes to a local scratch file only (copyright, PRD 5.3).
 * Only counts go to docs/harness/parse-summary.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFetcher } from "../src/lib/intake/fetcher";
import { parseSchemaOrgRecipe } from "../src/lib/recipes/schema-org";

const root = process.cwd();
const set = JSON.parse(readFileSync(join(root, "docs/harness/url-set.json"), "utf8")) as { blog_pages: { url: string; creator_or_blog: string }[] };
const fetcher = createFetcher({
  fetchImpl: fetch,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});

async function main() {
  const full: unknown[] = [];
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < set.blog_pages.length; i++) {
    const item = set.blog_pages[i]!;
    const id = `blog-${String(i + 1).padStart(2, "0")}`;
    const page = await fetcher.fetchPage(item.url);
    if (page.status !== "ok") {
      rows.push({ id, fetch: "skipped", reason: page.reason });
      full.push({ id, url: item.url, fetch: "skipped", reason: page.message });
      continue;
    }
    const parsed = parseSchemaOrgRecipe(page.body, page.url);
    if (!parsed.ok) {
      rows.push({ id, fetch: "ok", parse: "no_recipe", reason: parsed.reason });
      full.push({ id, url: item.url, fetch: "ok", parse: "no_recipe", reason: parsed.reason });
      continue;
    }
    const r = parsed.recipe;
    rows.push({
      id,
      fetch: "ok",
      parse: "ok",
      has_title: r.title.length > 0,
      ingredient_count: r.ingredients.length,
      step_count: r.steps.length,
      has_yield: r.yieldText !== null,
      has_total_time: r.totalMinutes !== null,
      has_author: r.author !== null,
      warnings: r.warnings,
    });
    full.push({ id, url: item.url, fetch: "ok", parse: "ok", recipe: r });
    console.log(id, "done");
  }
  const scratch = "C:/Users/nacha/AppData/Local/hermes/cache/scratch/harness-parse-full.json";
  writeFileSync(scratch, JSON.stringify(full, null, 1));
  const ok = rows.filter((r) => r.parse === "ok").length;
  const summary = {
    pages: rows.length,
    fetched_ok: rows.filter((r) => r.fetch === "ok").length,
    recipe_markup_found: ok,
    no_recipe_markup: rows.filter((r) => r.parse === "no_recipe").length,
    skipped_by_fetch: rows.filter((r) => r.fetch === "skipped").length,
    pages_with_steps: rows.filter((r) => (r.step_count as number) > 0).length,
    pages_with_ingredients: rows.filter((r) => (r.ingredient_count as number) > 0).length,
    pages_with_warnings: rows.filter((r) => Array.isArray(r.warnings) && (r.warnings as string[]).length > 0).length,
    rows,
  };
  writeFileSync(join(root, "docs/harness/parse-summary.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ pages: summary.pages, recipe_markup_found: summary.recipe_markup_found, no_recipe_markup: summary.no_recipe_markup, skipped_by_fetch: summary.skipped_by_fetch, pages_with_steps: summary.pages_with_steps, pages_with_warnings: summary.pages_with_warnings }));
}
main().catch((e) => { console.error(e); process.exit(1); });
