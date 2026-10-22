/**
 * RE02 review: a parsed recipe with unsure fields waits in the household's box as
 * needs_review. The User confirms or edits each unsure field; only ready recipes
 * enter the planning pool (PRD 5.3). Every query is scoped to the household.
 */
import { and, asc, eq } from "drizzle-orm";
import { recipe, recipeIngredient, recipeStep } from "../../../db/schema";
import type { Db } from "../db";
import type { ParsedFields } from "./llm-parser";

export class RecipeNotFoundError extends Error {
  readonly code = "not_found" as const;
  constructor() {
    super("recipe not found");
    this.name = "RecipeNotFoundError";
  }
}

export interface SaveParsedInput {
  fields: ParsedFields;
  confidence: Record<string, number>;
  unsure: string[];
  sourceUrl: string;
  parseMethod: "markup" | "llm";
}

export interface ReviewRecipe {
  id: string;
  title: string;
  sourceDomain: string | null;
  status: "ready" | "needs_review";
  unsureFields: string[];
  ingredients: string[];
  steps: string[];
  confidence: Record<string, number>;
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Saves the recipe as the household's private copy. Unsure fields make it needs_review. */
export async function saveParsedRecipe(db: Db, householdId: string, input: SaveParsedInput): Promise<string> {
  const status = input.unsure.length > 0 ? "needs_review" : "ready";
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(recipe)
      .values({
        householdId,
        visibility: "household_private",
        sourceUrl: input.sourceUrl,
        sourceDomain: domainOf(input.sourceUrl),
        author: input.fields.author,
        title: input.fields.title || "Untitled recipe",
        prepMin: input.fields.prepMinutes,
        cookMin: input.fields.cookMinutes,
        totalMin: input.fields.totalMinutes,
        cuisine: input.fields.cuisine[0] ?? null,
        parseMethod: input.parseMethod,
        status,
        unsureFields: input.unsure,
        parseConfidence: input.confidence,
      })
      .returning({ id: recipe.id });
    const id = row!.id;
    if (input.fields.ingredients.length > 0) {
      await tx.insert(recipeIngredient).values(input.fields.ingredients.map((rawText, i) => ({ recipeId: id, position: i, rawText })));
    }
    if (input.fields.steps.length > 0) {
      await tx.insert(recipeStep).values(input.fields.steps.map((text, i) => ({ recipeId: id, position: i + 1, text })));
    }
    return id;
  });
}

async function load(db: Db, householdId: string, recipeId: string): Promise<ReviewRecipe> {
  const [r] = await db
    .select()
    .from(recipe)
    .where(and(eq(recipe.id, recipeId), eq(recipe.householdId, householdId)));
  if (!r) throw new RecipeNotFoundError();
  const ings = await db.select().from(recipeIngredient).where(eq(recipeIngredient.recipeId, recipeId)).orderBy(asc(recipeIngredient.position));
  const steps = await db.select().from(recipeStep).where(eq(recipeStep.recipeId, recipeId)).orderBy(asc(recipeStep.position));
  return {
    id: r.id,
    title: r.title,
    sourceDomain: r.sourceDomain,
    status: r.status,
    unsureFields: [...r.unsureFields],
    ingredients: ings.map((i) => i.rawText),
    steps: steps.map((s) => s.text),
    confidence: (r.parseConfidence as Record<string, number> | null) ?? {},
  };
}

export async function listNeedsReview(db: Db, householdId: string): Promise<ReviewRecipe[]> {
  const rows = await db.select({ id: recipe.id }).from(recipe).where(and(eq(recipe.householdId, householdId), eq(recipe.status, "needs_review")));
  const out: ReviewRecipe[] = [];
  for (const r of rows) out.push(await load(db, householdId, r.id));
  return out;
}

export async function getForReview(db: Db, householdId: string, recipeId: string): Promise<ReviewRecipe> {
  return load(db, householdId, recipeId);
}

/** The User looked at one unsure field and says it is right. */
export async function confirmField(db: Db, householdId: string, recipeId: string, field: string): Promise<ReviewRecipe> {
  const current = await load(db, householdId, recipeId);
  const remaining = current.unsureFields.filter((f) => f !== field);
  await db
    .update(recipe)
    .set({ unsureFields: remaining, status: remaining.length === 0 ? "ready" : "needs_review" })
    .where(and(eq(recipe.id, recipeId), eq(recipe.householdId, householdId)));
  return load(db, householdId, recipeId);
}

/** The User edits the title, ingredient lines or steps. Edited fields count as confirmed. */
export async function editFields(
  db: Db,
  householdId: string,
  recipeId: string,
  edits: { title?: string; ingredients?: string[]; steps?: string[] },
): Promise<ReviewRecipe> {
  const current = await load(db, householdId, recipeId);
  const title = edits.title?.trim();
  const ingredients = edits.ingredients?.map((s) => s.trim()).filter(Boolean).slice(0, 100).map((s) => s.slice(0, 300));
  const steps = edits.steps?.map((s) => s.trim()).filter(Boolean).slice(0, 100).map((s) => s.slice(0, 2000));
  const touched = new Set<string>();
  await db.transaction(async (tx) => {
    if (title) { await tx.update(recipe).set({ title: title.slice(0, 200) }).where(and(eq(recipe.id, recipeId), eq(recipe.householdId, householdId))); touched.add("title"); }
    if (ingredients) {
      await tx.delete(recipeIngredient).where(eq(recipeIngredient.recipeId, recipeId));
      if (ingredients.length) await tx.insert(recipeIngredient).values(ingredients.map((rawText, i) => ({ recipeId, position: i, rawText })));
      touched.add("ingredients");
    }
    if (steps) {
      await tx.delete(recipeStep).where(eq(recipeStep.recipeId, recipeId));
      if (steps.length) await tx.insert(recipeStep).values(steps.map((text, i) => ({ recipeId, position: i + 1, text })));
      touched.add("steps");
    }
    const remaining = current.unsureFields.filter((f) => !touched.has(f));
    await tx
      .update(recipe)
      .set({ unsureFields: remaining, status: remaining.length === 0 ? "ready" : "needs_review" })
      .where(and(eq(recipe.id, recipeId), eq(recipe.householdId, householdId)));
  });
  return load(db, householdId, recipeId);
}

/** Only ready recipes enter the planning pool (PRD 5.3). */
export function inPlanningPool(r: { status: "ready" | "needs_review" }): boolean {
  return r.status === "ready";
}
