/** Starter foods are inserted once, with no household (live DB). */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { isNull } from "drizzle-orm";
import { foodItem } from "../../db/schema";
import { openDb, type Db } from "../../db/index";
import { seedStarterFoods } from "../../src/lib/nutrition/food-seed-db";
import { STARTER_FOODS } from "../../src/lib/nutrition/food-seed";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("starter food seed (live DB)", () => {
  let db: Db;
  beforeAll(() => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
  });
  it("running it twice adds each starter food once, with no household", async () => {
    const first = await seedStarterFoods(db);
    const second = await seedStarterFoods(db);
    expect(first.inserted + first.existing).toBe(STARTER_FOODS.length);
    expect(second.inserted).toBe(0);
    expect(second.existing).toBe(STARTER_FOODS.length);
    const rows = await db.select().from(foodItem).where(isNull(foodItem.householdId));
    const names = rows.map((r) => r.name);
    for (const f of STARTER_FOODS) expect(names.filter((n) => n === f.name)).toHaveLength(1);
  });
});
