/**
 * Building the real candidate pool for planning.
 *
 * The planner used to ignore the database entirely and pick from 16 hardcoded
 * mock meals. This module is what replaces that: it reads `recipe` rows the
 * household may actually eat and applies the hard filters (PRD WP-3.4) that the
 * stored data can support, leaving calorie banding and seeded choice to the
 * planner.
 *
 * Known limits, stated rather than hidden:
 * - `recipe` has no diet tags, so suitability for vegetarian/vegan/pescatarian/
 *   halal/kosher cannot be PROVEN from stored data. Guessing from ingredient
 *   strings is exactly the hand-rolled word list the safety rules forbid, so a
 *   household declaring any of those gets an empty pool with reason
 *   `diet_provenance_unavailable` and the caller reports it honestly. Adding the
 *   column is part of recipe intake (next work package).
 * - `recipe_nutrients` may be absent for a recipe. Rather than invent a calorie
 *   figure, such recipes are excluded: the planner bands meals by
 *   caloriesPerServing, and a 0 would silently skew every slot.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import {
  allergenConfirmation,
  recipe,
  recipeIngredient,
  recipeNutrients,
} from "../../../db/schema";
import type { Db } from "../db";
import type { Recipe } from "../planner";
import { conditionAllergens, toAllergens } from "../health/allergen-vocabulary";

/** Diets that need ingredient-level provenance we do not store yet. */
const PROVENANCE_REQUIRED = new Set(["vegetarian", "vegan", "pescatarian", "halal", "kosher"]);

export type ExcludeReason =
  | "allergen"
  | "allergen_unconfirmed"
  | "diet_provenance_unavailable"
  | "no_nutrients";

export interface PoolMember {
  id: string;
  /** Canonical `ALLERGENS` values from the decrypted health blob. */
  allergens: string[];
  /** Free text by design (PRD lets a user name anything), so it cannot be
   *  enum-matched: compared as a case-insensitive substring of the ingredient. */
  otherAllergens: string[];
  /** Conditions, because celiac is a hard gluten filter (SG01), not an advice flag. */
  conditions: string[];
  diet: string;
}

export interface PoolOutcome {
  recipes: Recipe[];
  /** recipe title -> reasons, for the honest error message and future UI. */
  excluded: Array<{ title: string; reasons: ExcludeReason[] }>;
  blockedOn: ExcludeReason | null;
}

export async function loadRecipePool(
  db: Db,
  householdId: string,
  members: PoolMember[],
): Promise<PoolOutcome> {
  // Own recipes plus the shared starter library (household_id IS NULL is legal
  // only for visibility='starter', per the recipe_visibility_household check).
  const rows = await db
    .select()
    .from(recipe)
    .where(
      and(
        or(eq(recipe.householdId, householdId), isNull(recipe.householdId)),
        eq(recipe.status, "ready"),
        isNull(recipe.takedownAt),
      ),
    )
    // Ordered, deliberately: the planner's seeded RNG indexes into this array,
    // so an unordered read (Postgres gives no guaranteed order) would make the
    // same household + seed produce a different week on another call. That
    // breaks the reproducibility WP-3.5 promises and would corrupt retries.
    .orderBy(recipe.id);

  const excluded = new Map<string, Set<ExcludeReason>>();
  const note = (title: string, reason: ExcludeReason) => {
    if (!excluded.has(title)) excluded.set(title, new Set());
    excluded.get(title)!.add(reason);
  };

  if (!rows.length) return { recipes: [], excluded: [], blockedOn: null };

  const ids = rows.map((r) => r.id);

  const [ingredientRows, nutrientRows, confirmationRows] = await Promise.all([
    db
      .select({
        recipeId: recipeIngredient.recipeId,
        rawText: recipeIngredient.rawText,
        uncertainAllergenTags: recipeIngredient.uncertainAllergenTags,
      })
      .from(recipeIngredient)
      .where(inArray(recipeIngredient.recipeId, ids)),
    db
      .select({
        recipeId: recipeNutrients.recipeId,
        perServing: recipeNutrients.perServing,
      })
      .from(recipeNutrients)
      .where(inArray(recipeNutrients.recipeId, ids)),
    members.length
      ? db
          .select({ recipeId: allergenConfirmation.recipeId, memberId: allergenConfirmation.memberId })
          .from(allergenConfirmation)
          .where(
            and(
              inArray(allergenConfirmation.recipeId, ids),
              inArray(allergenConfirmation.memberId, members.map((m) => m.id)),
            ),
          )
      : Promise.resolve([] as Array<{ recipeId: string; memberId: string }>),
  ]);

  const ingredients = new Map<string, { rawText: string; tags: string[] }[]>();
  for (const i of ingredientRows) {
    if (!ingredients.has(i.recipeId)) ingredients.set(i.recipeId, []);
    ingredients.get(i.recipeId)!.push({ rawText: i.rawText, tags: i.uncertainAllergenTags ?? [] });
  }
  const kcal = new Map<string, number>();
  for (const n of nutrientRows) {
    const v = (n.perServing as Record<string, number> | null)?.kcal;
    if (typeof v === "number" && v > 0) kcal.set(n.recipeId, Math.round(v));
  }
  // PR03: allergen confirmations are written only from the UI.
  const confirmed = new Set(confirmationRows.map((c) => `${c.recipeId}|${c.memberId}`));

  // Diet provenance is a household-level blocker, not a per-recipe one.
  const needsProvenance = members.some((m) => PROVENANCE_REQUIRED.has(m.diet));

  // Pre-computed per member, in canonical space. Comparing recipe tags and
  // member allergies verbatim used to miss milk/dairy, egg/eggs, wheat/gluten
  // and "tree nuts"/"tree_nuts" - see src/lib/health/allergen-vocabulary.ts.
  const memberFilters = members.map((m) => ({
    canonical: new Set<string>(toAllergens([...m.allergens, ...conditionAllergens(m.conditions)])),
    freeText: m.otherAllergens.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 1),
  }));

  const recipes: Recipe[] = [];
  for (const r of rows) {
    const ings = ingredients.get(r.id) ?? [];
    // Uncertain tags are treated as PRESENT: fail safe, not fail open. Stored
    // tags arrive in scout's vocabulary, so they are normalised here and the
    // planner receives canonical values on both sides of its own check.
    const rawTags = ings.flatMap((i) => i.tags);
    const allergens = toAllergens(rawTags);
    const rawHay = ings.map((i) => i.rawText.toLowerCase()).join(" | ");

    if (needsProvenance) {
      note(r.title, "diet_provenance_unavailable");
      continue;
    }

    const blocked = members.some((m, i) => {
      const f = memberFilters[i]!;
      const enumHit = allergens.some((a) => f.canonical.has(a));
      const freeTextHit = f.freeText.some((t) => rawHay.includes(t));
      return (enumHit || freeTextHit) && !confirmed.has(`${r.id}|${m.id}`);
    });
    if (blocked) {
      note(r.title, "allergen_unconfirmed");
      continue;
    }

    const energy = kcal.get(r.id);
    if (!energy) {
      note(r.title, "no_nutrients");
      continue;
    }

    const own = Boolean(r.sourceUrl) || r.visibility === "household_private";
    recipes.push({
      id: r.id,
      name: r.title,
      servings: r.yieldServings,
      prepMinutes: r.prepMin ?? 0,
      cookMinutes: r.cookMin ?? 0,
      ingredients: ings.map((i) => i.rawText),
      caloriesPerServing: energy,
      allergens,
      // "Own source" in PRD terms means it came from a creator the household
      // linked; a recipe they typed themselves is also theirs.
      isOwnSource: own,
    });
  }

  const blockedOn: ExcludeReason | null =
    recipes.length === 0 && excluded.size > 0
      ? [...new Set([...excluded.values()].flatMap((s) => [...s]))][0] ?? null
      : null;

  return {
    recipes,
    excluded: [...excluded].map(([title, reasons]) => ({ title, reasons: [...reasons] })),
    blockedOn,
  };
}
