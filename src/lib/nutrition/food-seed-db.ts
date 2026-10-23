/** Inserts the starter foods as household-less rows (the starter library). Safe to run twice. */
import { and, eq, isNull } from "drizzle-orm";
import { foodItem } from "../../../db/schema";
import type { Db } from "../db";
import { STARTER_FOODS } from "./food-seed";

export async function seedStarterFoods(db: Db): Promise<{ inserted: number; existing: number }> {
  let inserted = 0;
  let existing = 0;
  for (const f of STARTER_FOODS) {
    const [hit] = await db
      .select({ id: foodItem.id })
      .from(foodItem)
      .where(and(isNull(foodItem.householdId), eq(foodItem.name, f.name)));
    if (hit) { existing++; continue; }
    await db.insert(foodItem).values({ householdId: null, name: f.name, fdcId: f.fdcId, defaultPortionG: f.defaultPortionG, mealTypes: f.mealTypes });
    inserted++;
  }
  return { inserted, existing };
}
