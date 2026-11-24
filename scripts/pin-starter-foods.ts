/**
 * scratch: hand-pin USDA records for the starter library ingredients (ADR-123).
 *
 * Why pins instead of the fuzzy matcher: probe runs showed chooseMatch resolving
 * "tomato" -> "Tomato powder", "onion" -> "DENNY'S, onion rings", "idli rice" ->
 * "Rice crackers", "sambar powder" -> "Baobab powder". Those are real USDA
 * records, just not the foods a recipe means, and their per-100g energy is
 * wildly different (tomato powder is ~20x fresh tomato). Feeding those into
 * calories would produce numbers that look authoritative and are wrong.
 *
 * The expectations below are the "picked by hand" step, encoded: each term names
 * the description pattern the record MUST match and the dataTypes that are
 * acceptable. A term that cannot be pinned makes the build fail rather than
 * silently ship a guess - the same rule STARTER_FOODS follows ("picked by hand
 * from recorded search results ... need a dietitian check").
 *   npx tsx scripts/pin-starter-foods.ts > .vercel/starter-pins.json
 */
import fs from "node:fs";
import { createFdcClient, FDC_BASE } from "../src/lib/nutrition/fdc";

type NutrientRow = { nutrientNumber?: string | number; value?: number };
type DescribedFood = { fdcId: number; description?: string; dataType?: string; foodNutrients?: NutrientRow[] };

const env: Record<string, string> = {};
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l.trim());
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}

type Pin = { query: string; must: RegExp; dataTypes: string[] };

// `must` is matched against the USDA description; `dataTypes` excludes Branded
// unless a term genuinely has no Foundation/SR record.
const EXPECT: Record<string, Pin> = {
  // oats + peanuts are the two terms where USDA's non-branded records are unusable
  // from this endpoint: "Oats, puffed" (Foundation) carries minerals but no energy
  // in the search payload and its detail record 404s, and a plain "peanuts" search
  // returns no non-branded record in the first page at all. The branded single-
  // ingredient records do carry energy, and their values agree with the SR figures
  // (oats 375 vs ~389 per 100 g; peanuts 571 vs 567). Only fdc_id is stored - the UI
  // shows the ingredient text I author - so no brand name reaches a user.
  oats: { query: "oats", must: /^(OATS|Oats,)/i, dataTypes: ["Foundation", "SR Legacy", "Branded"] },
  peanuts: { query: "peanuts", must: /^(PEANUTS|Nuts, peanuts)/i, dataTypes: ["Foundation", "SR Legacy", "Branded"] },
  milk: { query: "milk whole 3.25", must: /^Milk, whole/i, dataTypes: ["Foundation", "SR Legacy"] },
  semolina: { query: "cream of wheat cereal", must: /^Cereals, CREAM OF WHEAT/i, dataTypes: ["Foundation", "SR Legacy"] },
  ghee: { query: "butter clarified ghee", must: /Clarified butter|Ghee/i, dataTypes: ["Foundation", "SR Legacy"] },
  "basmati rice": { query: "rice long-grain white raw", must: /^Rice, white, long-grain, (regular|parboiled), raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  "idli rice": { query: "rice white short grain raw", must: /^Rice, white, short-grain, raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  "toor dal": { query: "pigeon peas mature seeds raw", must: /Pigeon peas/i, dataTypes: ["Foundation", "SR Legacy"] },
  "kidney beans": { query: "kidney beans mature seeds raw", must: /^Beans, kidney, red, mature seeds, raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  chickpeas: { query: "chickpeas garbanzo", must: /^Chickpeas \(garbanzo beans, bengal gram\), mature seeds, raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  "moong dal": { query: "mung beans mature seeds raw", must: /^Mung beans, mature seeds, raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  "urad dal": { query: "beans black mature seeds raw", must: /^Beans, black, mature seeds, raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  besan: { query: "chickpea flour", must: /^Chickpea flour \(besan\)/i, dataTypes: ["Foundation", "SR Legacy"] },
  yogurt: { query: "yogurt whole milk plain", must: /^Yogurt, plain, whole milk/i, dataTypes: ["Foundation", "SR Legacy"] },
  paneer: { query: "cheese cottage creamed curd", must: /^Cheese, cottage, creamed, large or small curd/i, dataTypes: ["Foundation", "SR Legacy"] },
  spinach: { query: "spinach raw", must: /^Spinach, raw$/i, dataTypes: ["Foundation", "SR Legacy"] },
  cauliflower: { query: "cauliflower raw", must: /^Cauliflower, raw$/i, dataTypes: ["Foundation", "SR Legacy"] },
  potatoes: { query: "potatoes raw with skin", must: /^Potatoes, raw, skin/i, dataTypes: ["Foundation", "SR Legacy"] },
  onion: { query: "onions raw", must: /^Onions, raw$/i, dataTypes: ["Foundation", "SR Legacy"] },
  tomato: { query: "tomatoes red ripe raw", must: /^Tomatoes, red, ripe, raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  ginger: { query: "ginger root raw", must: /^Ginger root, raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  garlic: { query: "garlic raw", must: /^Garlic, raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  "green chilli": { query: "chili pepper green raw", must: /^Peppers, hot chili, green, raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  turmeric: { query: "spices turmeric ground", must: /^Spices, turmeric, ground/i, dataTypes: ["Foundation", "SR Legacy"] },
  "cumin seeds": { query: "spices cumin seed", must: /^Spices, cumin seed/i, dataTypes: ["Foundation", "SR Legacy"] },
  "mustard seeds": { query: "spices mustard seed ground", must: /^Spices, mustard seed/i, dataTypes: ["Foundation", "SR Legacy"] },
  "coriander powder": { query: "spices coriander seed ground", must: /^Spices, coriander seed/i, dataTypes: ["Foundation", "SR Legacy"] },
  "coriander leaves": { query: "coriander leaves fresh", must: /^Coriander \(cilantro\) leaves, raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  cream: { query: "cream fluid heavy whipping", must: /^Cream, fluid, (whole|heavy whipping|half and half)/i, dataTypes: ["Foundation", "SR Legacy"] },
  oil: { query: "oil soybean salad cooking", must: /^Oil, (soybean|sunflower|vegetable)/i, dataTypes: ["Foundation", "SR Legacy"] },
  rice: { query: "rice white long grain raw", must: /^Rice, white, long-grain, regular, raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  tomatoes: { query: "tomatoes red ripe raw", must: /^Tomatoes, red, ripe, raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  cashews: { query: "nuts cashews raw", must: /^Nuts, cashew nuts, raw/i, dataTypes: ["Foundation", "SR Legacy"] },
  "whole wheat flour": { query: "flour whole wheat", must: /^Flour, whole ?wheat/i, dataTypes: ["Foundation", "SR Legacy"] },
  "mixed vegetables": { query: "vegetables mixed frozen", must: /^Vegetables, mixed/i, dataTypes: ["Foundation", "SR Legacy"] },
  salt: { query: "salt table", must: /^Salt, table/i, dataTypes: ["Foundation", "SR Legacy"] },
  "chilli powder": { query: "spices pepper cayenne ground", must: /^Spices, pepper, red or cayenne/i, dataTypes: ["Foundation", "SR Legacy"] },
  water: { query: "water tap", must: /^Beverages, water, tap, drinking/i, dataTypes: ["Foundation", "SR Legacy"] },
};

/**
 * Several Foundation/SR records return protein/fat/carbs in the SEARCH payload but
 * no energy (nutrientNumber "208"). The detail record does carry it, so fall back
 * there rather than dropping a food we have already identified by hand. Same
 * per-100 g basis; values are read from nutrient.number/number when present.
 */
async function fdcEnergyFromDetail(fdcId: number, apiKey: string): Promise<number | null> {
  try {
    const res = await fetch(`${FDC_BASE}/foods/${fdcId}?format=full`, { headers: { "X-Api-Key": apiKey } });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      foodNutrients?: { nutrient?: { number?: string | number }; nutrientNumber?: string | number; value?: number }[];
    };
    for (const n of body.foodNutrients ?? []) {
      const code = String(n.nutrient?.number ?? n.nutrientNumber ?? "");
      if (code === "208" && typeof n.value === "number") return Math.round(n.value * 100) / 100;
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  const client = createFdcClient({ apiKey: env.FDC_API_KEY! });
  type PinRow = Record<string, string | number | null>;
  const out: Record<string, PinRow> = {};
  const failures: string[] = [];

  for (const [term, pin] of Object.entries(EXPECT)) {
    const foods = (await client.search(pin.query)) as unknown as DescribedFood[];
    const ok = foods.filter(
      (f) =>
        pin.dataTypes.includes(String(f.dataType)) &&
        pin.must.test(String(f.description ?? "")) &&
        // no nutrient requirement here: several valid Foundation/SR records return
        // an empty or value-less foodNutrients array in the search payload, and the
        // detail lookup below is what supplies energy. Requiring it here meant the
        // hand-picked record was filtered out before it could ever be checked.
        true,
    );
    const hasKcal = (f: DescribedFood) =>
      (f.foodNutrients ?? []).some((x) => String(x.nutrientNumber) === "208" && typeof x.value === "number");
    const best = ok.find(hasKcal) ?? ok[0];
    const energyFromSearch = (best?.foodNutrients ?? []).find(
      (x) => String(x.nutrientNumber) === "208" && typeof x.value === "number",
    )?.value as number | undefined;
    const energy =
      typeof energyFromSearch === "number"
        ? Math.round(energyFromSearch * 100) / 100
        : best
          ? await fdcEnergyFromDetail(best.fdcId, env.FDC_API_KEY!)
          : null;
    if (!best || typeof energy !== "number") {
      failures.push(term);
      console.error(
        `PIN FAILED ${term.padEnd(18)} candidates=${foods.length} shown: ${foods
          .slice(0, 3)
          .map((f) => `${String(f.description).slice(0, 40)}[${f.dataType}]`)
          .join(" | ")}`,
      );
      continue;
    }
    // nutrientNumber is a STRING code in the search API ("208" = energy kcal per
    // 100 g), exactly as NUTRIENT_NUMBERS in fdc.ts declares it. An earlier draft
    // asked for 1008 (the detail API's id) and so reported null for every record
    // while the app itself produced sensible calories - a probe bug, not an app bug.
    const byNum = (n: string) => {
      const hit = (best.foodNutrients ?? []).find((x) => String(x.nutrientNumber) === n);
      return typeof hit?.value === "number" ? Math.round(hit.value * 100) / 100 : null;
    };
    out[term] = {
      fdcId: String(best.fdcId),
      description: String(best.description),
      dataType: String(best.dataType),
      kcal: energy,
      protein: byNum("203"),
      fat: byNum("204"),
      satFat: byNum("606"),
      carbs: byNum("205"),
      fiber: byNum("291"),
      sugar: byNum("269"),
      sodium: byNum("307"),
    };
    console.log(`pinned ${term.padEnd(18)} ${String(out[term].kcal).padStart(6)} kcal/100g  ${String(out[term].description).slice(0, 52)}`);
  }

  if (failures.length) {
    console.error(`\n${failures.length} unpinned: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
  fs.writeFileSync(".vercel/starter-pins.json", JSON.stringify(out, null, 2));
  console.log(`\nwrote .vercel/starter-pins.json (${Object.keys(out).length} pins)`);
}

main().catch((e) => {
  console.error("PROBE FAILED:", String(e?.message ?? e).slice(0, 200));
  process.exitCode = 1;
});
