/**
 * ADR-125: curated ingredient-name → pinned USDA record lookup, applied BEFORE
 * the fuzzy FDC matcher during enrichment. Two things it fixes at once:
 *
 * - the `cups` problem: a matched-but-unweighed line contributes nothing to the
 *   roll-up, so whole recipes landed in `no_nutrients`. A curated row carries
 *   USDA's own `foodPortions` grams per cup/tbsp/tsp/clove/slice/piece, so
 *   "1 cup cooked rice" becomes 158 g of a 123-kcal/100 g food — computed from
 *   the record, never estimated by us;
 * - the wrong-but-real problem: the fuzzy matcher resolves "tomato" to
 *   "Tomato powder" (ADR-123). A curated hit replaces that match entirely.
 *
 * A miss here is NOT an error: the caller falls back to the live fuzzy path,
 * exactly as before. Rows are global (household-less) by design; `reviewed`
 * stays false until the dietitian pass (ADR-125) flips it via a migration.
 */
import { eq } from "drizzle-orm";
import { fdcAlias } from "../../../db/schema";
import type { Db } from "../db";
import type { ParsedIngredient } from "./ingredient-line";
import type { FdcMatch } from "./fdc";

/** Same normalisation the fdc_cache uses, so lookups and cache keys cannot drift. */
export function normalizeFood(food: string): string {
  return food.trim().toLowerCase().replace(/\s+/g, " ");
}

export type AliasRow = {
  foodKey: string;
  fdcId: string;
  description: string;
  dataType: string;
  per100g: Partial<FdcMatch["per100g"]>;
  unitGrams: Record<string, number>;
  reviewed: boolean;
};

export async function lookupAlias(db: Db, food: string | null | undefined): Promise<AliasRow | null> {
  if (!food) return null;
  const key = normalizeFood(food);
  if (!key) return null;
  const [row] = await db
    .select({
      foodKey: fdcAlias.foodKey,
      fdcId: fdcAlias.fdcId,
      description: fdcAlias.description,
      dataType: fdcAlias.dataType,
      per100g: fdcAlias.per100g,
      unitGrams: fdcAlias.unitGrams,
      reviewed: fdcAlias.reviewed,
    })
    .from(fdcAlias)
    .where(eq(fdcAlias.foodKey, key));
  return row ?? null;
}

/** Curated records are pinned, not guessed: same confidence convention as the starter library. */
export const ALIAS_CONFIDENCE = 0.95;

export function aliasMatch(row: AliasRow): FdcMatch {
  return {
    fdcId: Number(row.fdcId),
    description: row.description,
    dataType: row.dataType,
    confidence: ALIAS_CONFIDENCE,
    per100g: row.per100g as FdcMatch["per100g"],
  };
}

/**
 * Grams from a curated unit weight when the line itself has none (volume/count
 * units). Returns null whenever the line already has grams, the alias has no
 * weight for that exact unit, or there is no quantity — an unweighed line
 * stays unweighed, which the roll-up reports honestly.
 */
export function gramsFromAlias(parsed: ParsedIngredient, row: AliasRow): number | null {
  if (parsed.grams !== null) return null;
  if (parsed.qty === null || !parsed.unit) return null;
  const per = row.unitGrams[parsed.unit];
  if (typeof per !== "number" || per <= 0) return null;
  return Math.round(parsed.qty * per * 10) / 10;
}
