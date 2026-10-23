/**
 * WP-2.6 first pass: for each of the 40 blog pages, parse with the schema.org parser and check the
 * result against the VISIBLE page text (JSON-LD and scripts removed): title on page, title clean,
 * every ingredient and step on page, and plausible step counts. Writes flags and counts to
 * docs/harness/wp26-first-pass.json. Recipe text goes to a scratch file only (copyright, PRD 5.3).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFetcher } from "../src/lib/intake/fetcher";
import { parseSchemaOrgRecipe } from "../src/lib/recipes/schema-org";
import { cleanPageText } from "../src/lib/recipes/llm-parser";

const root = process.cwd();
const set = JSON.parse(readFileSync(join(root, "docs/harness/url-set.json"), "utf8")) as { blog_pages: { url: string }[] };
const fetcher = createFetcher({ fetchImpl: fetch, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
// Glyph fractions map to a/b first, so "½" on the page matches "1/2" in the schema data.
const FRACTIONS: [string, string][] = [["\u00BD", "1/2"], ["\u2153", "1/3"], ["\u2154", "2/3"], ["\u00BC", "1/4"], ["\u00BE", "3/4"], ["\u215B", "1/8"], ["\u215C", "3/8"], ["\u215D", "5/8"], ["\u215E", "7/8"]];
const alnum = (s: string) => {
  let x = s;
  for (const [g, f] of FRACTIONS) x = x.split(g).join(f);
  return x.toLowerCase().replace(/[^a-z0-9]/g, "");
};

async function main() {
  const rows: Record<string, unknown>[] = [];
  const scratch: unknown[] = [];
  for (let i = 0; i < set.blog_pages.length; i++) {
    const id = `blog-${String(i + 1).padStart(2, "0")}`;
    const url = set.blog_pages[i]!.url;
    const page = await fetcher.fetchPage(url);
    if (page.status !== "ok") { rows.push({ id, fetch: "skipped", reason: page.reason }); continue; }
    const parsed = parseSchemaOrgRecipe(page.body, page.url);
    if (!parsed.ok) { rows.push({ id, fetch: "ok", parse: "no_recipe" }); continue; }
    const r = parsed.recipe;
    const visible = alnum(cleanPageText(page.body));
    const ingOn = r.ingredients.filter((s) => visible.includes(alnum(s))).length;
    const stepOn = r.steps.filter((s) => visible.includes(alnum(s))).length;
    const titleOn = r.title.length > 0 && visible.includes(alnum(r.title));
    const flags: string[] = [];
    if (!titleOn) flags.push("title_not_on_page");
    if (r.title.includes("|") || r.title.length > 80) flags.push("title_looks_like_seo_or_label");
    if (ingOn < r.ingredients.length) flags.push("ingredient_not_on_page");
    if (stepOn < r.steps.length) flags.push("step_not_on_page");
    if (r.steps.length < 2) flags.push("steps_under_2_check_count");
    if (r.ingredients.length === 0) flags.push("no_ingredients");
    rows.push({ id, fetch: "ok", parse: "ok", ingredient_count: r.ingredients.length, step_count: r.steps.length, flags, pass: flags.length === 0 });
    scratch.push({ id, url, title: r.title, ingredients: r.ingredients, steps: r.steps, flags });
    console.log(id, flags.length === 0 ? "pass" : flags.join(","));
  }
  writeFileSync("C:/Users/nacha/AppData/Local/hermes/cache/scratch/wp26-first-pass-full.json", JSON.stringify(scratch, null, 1));
  const parsedRows = rows.filter((r) => r.parse === "ok");
  const summary = {
    pages: rows.length,
    fetched_ok: rows.filter((r) => r.fetch === "ok").length,
    parsed: parsedRows.length,
    passed_first_pass: parsedRows.filter((r) => r.pass === true).length,
    flagged: parsedRows.filter((r) => r.pass !== true).map((r) => ({ id: r.id, flags: r.flags })),
    skipped: rows.filter((r) => r.fetch === "skipped").map((r) => r.id),
  };
  writeFileSync(join(root, "docs/harness/wp26-first-pass.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ pages: summary.pages, parsed: summary.parsed, passed: summary.passed_first_pass, skipped: summary.skipped }));
}
main().catch((e) => { console.error(e); process.exit(1); });
