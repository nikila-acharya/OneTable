/**
 * CP01/CP02 single-link import: fetch one page (robots and rate limit apply), read schema.org markup,
 * else ask the tool-less LLM parser, else hand back a manual form prefilled with the link.
 * Every outcome carries a plain-words reason. Only the household's private copy is saved.
 */
import type { Db } from "../db";
import type { FetchOutcome } from "../intake/fetcher";
import { parseSchemaOrgRecipe } from "./schema-org";
import { parseWithLlm, type LlmClient, type ParsedFields } from "./llm-parser";
import { saveParsedRecipe } from "./review";

export interface ImportDeps {
  fetchPage: (url: string) => Promise<FetchOutcome>;
  llm?: { client: LlmClient; model: string };
}

export type ImportResult =
  | { status: "ready"; recipeId: string; parseMethod: "markup" | "llm" }
  | { status: "needs_review"; recipeId: string; unsure: string[] }
  | { status: "manual"; reason: string; prefill: { sourceUrl: string; title: string } }
  | { status: "skipped"; reason: string };

const SKIP_WORDS: Record<string, string> = {
  robots_disallowed: "The site asks robots not to read this page, so we have not imported it. You can enter the recipe by hand.",
  robots_unavailable: "We could not check the site's rules for robots just now, so we have not imported this page. Please try again later.",
  crawl_delay_too_long: "This site asks us to wait too long between pages, so we have not imported it.",
  not_html: "This link is not a web page we can read.",
  too_large: "This page is too large for us to read.",
  http_error: "The site did not return this page.",
  network_error: "We could not reach this page just now. Please try again.",
};

export function isWebUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export async function importRecipeFromUrl(db: Db, deps: ImportDeps, householdId: string, url: string): Promise<ImportResult> {
  if (!isWebUrl(url)) return { status: "manual", reason: "That does not look like a web address. You can enter the recipe by hand.", prefill: { sourceUrl: "", title: "" } };
  const page = await deps.fetchPage(url);
  if (page.status !== "ok") return { status: "skipped", reason: SKIP_WORDS[page.reason] ?? "We could not import this page." };

  const markup = parseSchemaOrgRecipe(page.body, page.url);
  if (markup.ok) {
    const r = markup.recipe;
    const recipeId = await saveParsedRecipe(db, householdId, {
      fields: toFields(r),
      confidence: {},
      unsure: [],
      sourceUrl: page.url,
      parseMethod: "markup",
    });
    return { status: "ready", recipeId, parseMethod: "markup" };
  }

  if (deps.llm) {
    const out = await parseWithLlm({ html: page.body, url: page.url, client: deps.llm.client, model: deps.llm.model });
    if (out.status === "ok") {
      const recipeId = await saveParsedRecipe(db, householdId, {
        fields: out.recipe,
        confidence: out.confidence,
        unsure: out.unsure,
        sourceUrl: page.url,
        parseMethod: "llm",
      });
      return out.unsure.length > 0
        ? { status: "needs_review", recipeId, unsure: out.unsure }
        : { status: "ready", recipeId, parseMethod: "llm" };
    }
    return { status: "manual", reason: out.reason, prefill: { sourceUrl: page.url, title: "" } };
  }

  return { status: "manual", reason: "We could not find a recipe on this page. You can enter it by hand.", prefill: { sourceUrl: page.url, title: "" } };
}

function toFields(r: { title: string; ingredients: string[]; steps: string[]; author: string | null; yieldText: string | null; prepMinutes: number | null; cookMinutes: number | null; totalMinutes: number | null; category: string[]; cuisine: string[] }): ParsedFields {
  return {
    title: r.title,
    ingredients: r.ingredients,
    steps: r.steps,
    author: r.author,
    yieldText: r.yieldText,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    totalMinutes: r.totalMinutes,
    category: r.category,
    cuisine: r.cuisine,
  };
}
