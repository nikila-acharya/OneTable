/**
 * CP02 manual entry: the User types a recipe in (PRD 5.3). It is saved as that household's private copy,
 * with the User's own method text. Validation gives plain reasons.
 */
import type { Db } from "../db";
import { saveParsedRecipe } from "./review";

export interface ManualInput {
  title: string;
  ingredients: string[];
  steps: string[];
  sourceUrl?: string | null;
  author?: string | null;
}

export type ManualCheck = { ok: true } | { ok: false; reasons: string[] };

export function checkManual(input: ManualInput): ManualCheck {
  const reasons: string[] = [];
  const title = (input.title ?? "").trim();
  const ingredients = (input.ingredients ?? []).map((s) => s.trim()).filter(Boolean);
  const steps = (input.steps ?? []).map((s) => s.trim()).filter(Boolean);
  if (title.length === 0) reasons.push("Please give the recipe a name.");
  if (title.length > 200) reasons.push("The name is too long (200 characters at most).");
  if (ingredients.length === 0) reasons.push("Please add at least one ingredient.");
  if (ingredients.length > 100) reasons.push("Please keep to 100 ingredient lines.");
  if (steps.length === 0) reasons.push("Please add at least one method step.");
  if (steps.length > 100) reasons.push("Please keep to 100 method steps.");
  if (ingredients.some((s) => s.length > 300)) reasons.push("An ingredient line is too long (300 characters at most).");
  if (steps.some((s) => s.length > 2000)) reasons.push("A method step is too long (2000 characters at most).");
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export async function saveManualRecipe(db: Db, householdId: string, input: ManualInput): Promise<string> {
  const check = checkManual(input);
  if (!check.ok) throw new ManualRecipeError(check.reasons);
  return saveParsedRecipe(db, householdId, {
    fields: {
      title: input.title.trim(),
      author: input.author?.trim() || null,
      ingredients: input.ingredients.map((s) => s.trim()).filter(Boolean),
      steps: input.steps.map((s) => s.trim()).filter(Boolean),
      yieldText: null,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      category: [],
      cuisine: [],
    },
    confidence: {},
    unsure: [],
    sourceUrl: input.sourceUrl?.trim() || "",
    parseMethod: "manual",
  });
}

export class ManualRecipeError extends Error {
  readonly code = "invalid_recipe" as const;
  constructor(readonly reasons: string[]) {
    super(reasons.join(" "));
    this.name = "ManualRecipeError";
  }
}
