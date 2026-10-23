/** One recipe in the household's box, with source and times. Scoped to the household; not for recipes still waiting for a check. */
import { and, asc, eq } from "drizzle-orm";
import { recipe, recipeIngredient, recipeStep } from "../../../db/schema";
import type { Db } from "../db";
import { RecipeNotFoundError } from "./review";

export interface RecipeDetail {
  id: string;
  title: string;
  author: string | null;
  sourceUrl: string | null;
  sourceDomain: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  cuisine: string | null;
  parseMethod: "markup" | "llm" | "manual";
  ingredients: string[];
  steps: string[];
}

export async function getRecipeDetail(db: Db, householdId: string, recipeId: string): Promise<RecipeDetail> {
  const [r] = await db
    .select()
    .from(recipe)
    .where(and(eq(recipe.id, recipeId), eq(recipe.householdId, householdId), eq(recipe.status, "ready")));
  if (!r) throw new RecipeNotFoundError();
  const ings = await db.select().from(recipeIngredient).where(eq(recipeIngredient.recipeId, recipeId)).orderBy(asc(recipeIngredient.position));
  const steps = await db.select().from(recipeStep).where(eq(recipeStep.recipeId, recipeId)).orderBy(asc(recipeStep.position));
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    sourceUrl: r.sourceUrl,
    sourceDomain: r.sourceDomain,
    prepMinutes: r.prepMin,
    cookMinutes: r.cookMin,
    totalMinutes: r.totalMin,
    cuisine: r.cuisine,
    parseMethod: r.parseMethod,
    ingredients: ings.map((i) => i.rawText),
    steps: steps.map((s) => s.text),
  };
}
