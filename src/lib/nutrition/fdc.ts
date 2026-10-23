/**
 * RE03 step 2: USDA FoodData Central lookup. Foundation and SR Legacy foods are preferred over
 * Branded. The key is sent in the X-Api-Key header, never in a URL. Responses are cached by the caller.
 */

export const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";
export const MATCH_FLOOR = 0.5; // below this, the ingredient is unmatched [Proposed]

/** FDC nutrient numbers we roll up (per 100 g of food). */
export const NUTRIENT_NUMBERS = {
  energyKcal: "208",
  protein: "203",
  fat: "204",
  saturatedFat: "606",
  carbs: "205",
  fiber: "291",
  sugarTotal: "269",
  sodium: "307",
} as const;

export interface FdcFood {
  fdcId: number;
  description: string;
  dataType: string;
  foodNutrients?: { nutrientNumber?: string; value?: number }[];
}

export interface FdcMatch {
  fdcId: number;
  description: string;
  dataType: string;
  confidence: number;
  per100g: Partial<Record<keyof typeof NUTRIENT_NUMBERS, number>>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function createFdcClient(opts: { apiKey: string; fetchImpl?: FetchLike; baseUrl?: string }) {
  const f: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const base = opts.baseUrl ?? FDC_BASE;
  return {
    async search(query: string): Promise<FdcFood[]> {
      const url = `${base}/foods/search?query=${encodeURIComponent(query)}&pageSize=10&dataType=${encodeURIComponent("Foundation,SR Legacy,Branded")}`;
      const res = await f(url, { headers: { "X-Api-Key": opts.apiKey } });
      if (!res.ok) throw new Error(`fdc http ${res.status}`);
      const body = (await res.json()) as { foods?: FdcFood[] };
      return body.foods ?? [];
    },
  };
}

const WORDS = (s: string) => s.toLowerCase().replace(/[^a-z\u00C0-\u017F ]/g, " ").split(/\s+/).filter((w) => w.length > 1);
const PREF: Record<string, number> = { Foundation: 1, "SR Legacy": 1, Branded: 0.6 };

/** Confidence = word overlap between the food name and the FDC description, with a small preference for generic data types. */
export function chooseMatch(food: string, candidates: FdcFood[]): FdcMatch | null {
  const q = new Set(WORDS(food));
  if (q.size === 0) return null;
  let best: FdcMatch | null = null;
  for (const c of candidates) {
    const d = new Set(WORDS(c.description));
    if (d.size === 0) continue;
    let common = 0;
    for (const w of q) if (d.has(w)) common++;
    const overlap = common / Math.max(q.size, 1);
    const precision = common / d.size;
    const score = Math.min(1, (0.7 * overlap + 0.3 * precision) * (PREF[c.dataType] ?? 0.6) / (PREF.Foundation ?? 1));
    const conf = Math.round(score * 100) / 100;
    if (!best || conf > best.confidence) {
      const per100g: FdcMatch["per100g"] = {};
      for (const [name, num] of Object.entries(NUTRIENT_NUMBERS)) {
        const n = c.foodNutrients?.find((x) => x.nutrientNumber === num);
        if (n && typeof n.value === "number") per100g[name as keyof typeof NUTRIENT_NUMBERS] = n.value;
      }
      best = { fdcId: c.fdcId, description: c.description, dataType: c.dataType, confidence: conf, per100g };
    }
  }
  return best && best.confidence >= MATCH_FLOOR ? best : null;
}
