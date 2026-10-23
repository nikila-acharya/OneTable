/**
 * RE03 step 3: per-serving nutrients from matched, weighed ingredient lines.
 * Estimate rule [Proposed, ADR-014]: an ingredient counts as complete when it is matched AND has a gram
 * weight. If fewer than 80% of lines are complete, the nutrients show as "estimate incomplete".
 * (The PRD's 20% rule is by weight; volume lines have no weight, so this rule is by line.)
 */
import type { ParsedIngredient } from "./ingredient-line";
import { NUTRIENT_NUMBERS, type FdcMatch } from "./fdc";

export const COMPLETE_SHARE = 0.8;

export const PER_SERVING_KEYS: Record<keyof typeof NUTRIENT_NUMBERS, string> = {
  energyKcal: "kcal",
  protein: "protein_g",
  fat: "fat_g",
  saturatedFat: "saturated_fat_g",
  carbs: "carbs_g",
  fiber: "fiber_g",
  sugarTotal: "sugar_g",
  sodium: "sodium_mg",
};

export interface LineMatch {
  line: ParsedIngredient;
  match: FdcMatch | null;
}

export interface RollUp {
  perServing: Record<string, number>;
  completeness: number;
  estimateIncomplete: boolean;
  unmatched: string[];
  unweighed: string[];
}

export function rollUp(lines: LineMatch[], servings: number): RollUp {
  const totals: Record<string, number> = {};
  const unmatched: string[] = [];
  const unweighed: string[] = [];
  let complete = 0;
  for (const { line, match } of lines) {
    if (!match) { unmatched.push(line.rawText); continue; }
    if (line.grams === null) { unweighed.push(line.rawText); continue; }
    complete++;
    for (const [name, key] of Object.entries(PER_SERVING_KEYS)) {
      const per100 = match.per100g[name as keyof typeof NUTRIENT_NUMBERS];
      if (typeof per100 === "number") totals[key] = (totals[key] ?? 0) + (per100 * line.grams) / 100;
    }
  }
  const share = lines.length === 0 ? 0 : complete / lines.length;
  const perServing: Record<string, number> = {};
  for (const [k, v] of Object.entries(totals)) perServing[k] = Math.round((v / Math.max(servings, 1)) * 10) / 10;
  return {
    perServing,
    completeness: Math.round(share * 100) / 100,
    estimateIncomplete: share < COMPLETE_SHARE,
    unmatched,
    unweighed,
  };
}
