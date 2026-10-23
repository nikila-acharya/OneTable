/**
 * RE03 step 1: split an ingredient line into quantity, unit and food (en and es basics).
 * Grams come only from an explicit gram weight on the line, or from a mass unit.
 * Volume units without a gram weight leave grams null (the recipe then shows the estimate as incomplete).
 */

export interface ParsedIngredient {
  rawText: string;
  qty: number | null;
  unit: string | null;
  food: string;
  grams: number | null;
  gramsSource: "line" | "mass_unit" | null;
}

const UNITS: Record<string, string> = {
  g: "g", gram: "g", grams: "g", gramo: "g", gramos: "g",
  kg: "kg", kilo: "kg", kilogram: "kg", kilograms: "kg",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  ml: "ml", milliliter: "ml", milliliters: "ml",
  l: "l", liter: "l", liters: "l",
  cup: "cup", cups: "cup", taza: "cup", tazas: "cup",
  tbsp: "tbsp", tbs: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", cucharada: "tbsp", cucharadas: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", cucharadita: "tsp", cucharaditas: "tsp",
  pinch: "pinch", pinches: "pinch",
  can: "can", cans: "can", clove: "clove", cloves: "clove", slice: "slice", slices: "slice",
  stick: "stick", sticks: "stick", piece: "piece", pieces: "piece",
};
const MASS_TO_G: Record<string, number> = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
const FRACTIONS: Record<string, number> = { "\u00BD": 0.5, "\u2153": 1 / 3, "\u2154": 2 / 3, "\u00BC": 0.25, "\u00BE": 0.75, "\u215B": 0.125 };

/** Reads "3", "1/2", "3 1/3", "3½", "½". Returns null when no leading quantity. */
function leadingQuantity(s: string): { qty: number; rest: string } | null {
  const t = s.trim();
  for (const [g, v] of Object.entries(FRACTIONS)) {
    const m = new RegExp(`^(\\d+)?\\s*${g}`).exec(t);
    if (m) return { qty: (m[1] ? Number(m[1]) : 0) + v, rest: t.slice(m[0].length).trim() };
  }
  const mixed = /^(\d+)\s+(\d+)\/(\d+)\b/.exec(t);
  if (mixed) return { qty: Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]), rest: t.slice(mixed[0].length).trim() };
  const frac = /^(\d+)\/(\d+)\b/.exec(t);
  if (frac && Number(frac[2]) !== 0) return { qty: Number(frac[1]) / Number(frac[2]), rest: t.slice(frac[0].length).trim() };
  const num = /^(\d+(?:[.,]\d+)?)\b/.exec(t);
  if (num) return { qty: Number(num[1].replace(",", ".")), rest: t.slice(num[0].length).trim() };
  return null;
}

export function parseIngredientLine(raw: string): ParsedIngredient {
  const rawText = raw.replace(/\s+/g, " ").trim();
  let text = rawText;

  // explicit gram weight in parentheses or after the line, e.g. "(480 g)", "(120g)", "((480 g))"
  let grams: number | null = null;
  const gm = /\(+\s*(\d+(?:[.,]\d+)?)\s*(g|gr|grams?|gramos?)\.?\s*\)+/i.exec(text);
  if (gm) {
    grams = Number(gm[1].replace(",", "."));
    text = (text.slice(0, gm.index) + " " + text.slice(gm.index + gm[0].length)).replace(/\s+/g, " ").trim();
  }
  // drop other parentheticals from the food name, keep the words
  text = text.replace(/\(([^()]*)\)/g, " ").replace(/\s+/g, " ").trim();

  const q = leadingQuantity(text);
  const qty: number | null = q ? q.qty : null;
  let rest = q ? q.rest : text;

  let unit: string | null = null;
  const um = /^([A-Za-z\u00C0-\u017F.]+)\b\.?\s*/.exec(rest);
  if (um) {
    const key = um[1].toLowerCase().replace(/\.$/, "");
    if (UNITS[key]) {
      unit = UNITS[key];
      rest = rest.slice(um[0].length).trim();
    }
  }
  // "de" in Spanish: "3 tazas de harina" -> "harina"
  rest = rest.replace(/^de\s+/i, "");

  // trailing notes after a comma are preparation notes, not the food
  let food = rest.split(",")[0]!.replace(/\b(optional|to taste|or more if needed|more if needed|divided)\b/gi, "").replace(/\s+/g, " ").trim();
  food = food.replace(/[-–:;]\s*$/, "").trim();
  // "psyllium husk + 6 tsp water": keep the food before a plus sign
  food = food.split(/\s\+\s/)[0]!.trim();

  let gramsSource: ParsedIngredient["gramsSource"] = null;
  if (grams !== null) gramsSource = "line";
  else if (qty !== null && unit && MASS_TO_G[unit]) {
    grams = qty * MASS_TO_G[unit]!;
    gramsSource = "mass_unit";
  }
  return { rawText, qty, unit, food, grams: grams === null ? null : Math.round(grams * 10) / 10, gramsSource };
}
