/**
 * RE01 schema.org parser: reads the Recipe data a page publishes as JSON-LD and
 * returns a normalised recipe. Deterministic; no LLM. Microdata is a follow-up.
 */
export interface ParsedRecipe {
  title: string;
  ingredients: string[];
  steps: string[];
  yieldText: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  category: string[];
  cuisine: string[];
  author: string | null;
  sourceUrl: string;
  parseMethod: "markup";
  warnings: string[];
}

export type ParseResult = { ok: true; recipe: ParsedRecipe } | { ok: false; reason: string };

// Named entities seen in real recipe pages (WP-2.6 first pass: &rsquo; and &frac12; were left undecoded).
const ENTITY: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
  rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201D", ldquo: "\u201C", sbquo: "\u201A", bdquo: "\u201E",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", bull: "\u2022", middot: "\u00B7", deg: "\u00B0",
  frac12: "\u00BD", frac14: "\u00BC", frac34: "\u00BE", frac13: "\u2153", frac23: "\u2154", times: "\u00D7",
  copy: "\u00A9", reg: "\u00AE", trade: "\u2122", euro: "\u20AC", pound: "\u00A3", cent: "\u00A2",
  ordm: "\u00BA", ordf: "\u00AA", iquest: "\u00BF", iexcl: "\u00A1", laquo: "\u00AB", raquo: "\u00BB",
  plusmn: "\u00B1", micro: "\u00B5", para: "\u00B6", sect: "\u00A7", yen: "\u00A5", Ccedil: "\u00C7",
  Ouml: "\u00D6", Uuml: "\u00DC", Auml: "\u00C4", Agrave: "\u00C0", Egrave: "\u00C8", Ecirc: "\u00CA",
  aacute: "\u00E1", eacute: "\u00E9", iacute: "\u00ED", oacute: "\u00F3", uacute: "\u00FA", ntilde: "\u00F1",
  Aacute: "\u00C1", Eacute: "\u00C9", Iacute: "\u00CD", Oacute: "\u00D3", Uacute: "\u00DA", Ntilde: "\u00D1",
  agrave: "\u00E0", egrave: "\u00E8", ugrave: "\u00F9", ccedil: "\u00E7", auml: "\u00E4", ouml: "\u00F6",
  uuml: "\u00FC", szlig: "\u00DF", acirc: "\u00E2", ecirc: "\u00EA", ocirc: "\u00F4", icirc: "\u00EE",
};

/** Decodes HTML entities (named and numeric) and collapses whitespace. */
export function cleanText(s: unknown): string {
  if (typeof s !== "string") return "";
  const decoded = s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, name) => ENTITY[name] ?? m);
  return decoded.replace(/\s+/g, " ").trim();
}

/**
 * Recipe titles from blogs often read "Recipe name | SEO words | site". The recipe name is the
 * first part. A title without a pipe is kept whole (WP-2.6 first pass: 3 of 38 had SEO text).
 */
export function cleanRecipeTitle(value: unknown): string {
  const whole = cleanText(value);
  const first = whole.split(/\s+\|\s+/)[0]?.trim() ?? "";
  return first.length >= 3 ? first : whole;
}

/** ISO 8601 duration (PT1H30M) to whole minutes; null when absent or unparseable. */
export function isoDurationMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(value.trim());
  if (!m || value.trim() === "P" || value.trim().endsWith("T")) return null;
  const days = Number(m[1] ?? 0), hours = Number(m[2] ?? 0), mins = Number(m[3] ?? 0), secs = Number(m[4] ?? 0);
  const total = days * 1440 + hours * 60 + mins + secs / 60;
  return total > 0 ? Math.round(total) : null;
}

function typesOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string");
}

/** Every Recipe object anywhere in a JSON-LD value (arrays, @graph, nested). */
export function collectRecipes(value: unknown, out: Record<string, unknown>[] = [], depth = 0): Record<string, unknown>[] {
  if (depth > 12 || value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const v of value) collectRecipes(v, out, depth + 1);
    return out;
  }
  const node = value as Record<string, unknown>;
  if (typesOf(node).some((t) => t === "Recipe")) out.push(node);
  for (const v of Object.values(node)) collectRecipes(v, out, depth + 1);
  return out;
}

function textList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return items.map(cleanText).filter((s) => s.length > 0);
}

function nameList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return items
    .map((v) => (typeof v === "object" && v !== null ? cleanText((v as Record<string, unknown>).name) : cleanText(v)))
    .filter((s) => s.length > 0);
}

/** Instructions: a string, HowToStep, HowToSection (nested itemListElement) or a list of these. */
export function flattenSteps(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === undefined || value === null) return [];
  if (typeof value === "string") return value.split(/\r?\n/).map(cleanText).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap((v) => flattenSteps(v, depth + 1));
  if (typeof value === "object") {
    const node = value as Record<string, unknown>;
    if (typesOf(node).includes("HowToSection") || node.itemListElement) return flattenSteps(node.itemListElement, depth + 1);
    const text = cleanText(node.text ?? node.name ?? "");
    return text ? [text] : [];
  }
  return [];
}

/** First readable text from a value that may be a string, an object with a name, or a list of either. */
function firstText(value: unknown): string | null {
  const items = Array.isArray(value) ? value : [value];
  for (const v of items) {
    const text = typeof v === "object" && v !== null ? cleanText((v as Record<string, unknown>).name) : cleanText(v);
    if (text) return text;
  }
  return null;
}

function toRecipe(node: Record<string, unknown>, sourceUrl: string): ParsedRecipe {
  const warnings: string[] = [];
  const ingredients = textList(node.recipeIngredient ?? node.ingredients);
  const steps = flattenSteps(node.recipeInstructions);
  if (ingredients.length === 0) warnings.push("no ingredient list found");
  if (steps.length === 0) warnings.push("no method steps found");
  const prep = isoDurationMinutes(node.prepTime);
  const cook = isoDurationMinutes(node.cookTime);
  let total = isoDurationMinutes(node.totalTime);
  if (total === null && (prep !== null || cook !== null)) total = (prep ?? 0) + (cook ?? 0) || null;
  return {
    title: cleanRecipeTitle(node.name),
    ingredients,
    steps,
    yieldText: firstText(node.recipeYield),
    prepMinutes: prep,
    cookMinutes: cook,
    totalMinutes: total,
    category: nameList(node.recipeCategory),
    cuisine: nameList(node.recipeCuisine),
    author: firstText(node.author),
    sourceUrl,
    parseMethod: "markup",
    warnings,
  };
}

function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse(m[1]!.trim()));
    } catch {
      // A broken block is skipped; the page may still carry a valid one.
    }
  }
  return out;
}

/** Parses the first Recipe with ingredients or steps. Refuses a page with no recipe markup. */
export function parseSchemaOrgRecipe(html: string, sourceUrl: string): ParseResult {
  const candidates = jsonLdBlocks(html).flatMap((v) => collectRecipes(v));
  if (candidates.length === 0) return { ok: false, reason: "no schema.org Recipe data on this page" };
  const scored = candidates
    .map((node) => ({ node, score: textList(node.recipeIngredient).length + flattenSteps(node.recipeInstructions).length }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  if (best.score === 0) return { ok: false, reason: "the recipe data on this page has no ingredients or steps" };
  return { ok: true, recipe: toRecipe(best.node, sourceUrl) };
}
