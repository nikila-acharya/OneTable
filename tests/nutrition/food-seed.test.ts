/** WP-2.4 food_item seed: each USDA id is in its recorded search result, with the same description (offline). */
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STARTER_FOODS } from "../../src/lib/nutrition/food-seed";

const slug: Record<string, string> = {
  "plain Greek yogurt": "greek-yogurt", banana: "banana", apple: "apple", "egg, whole": "egg", "rolled oats": "rolled-oats",
  "whole wheat bread": "whole-wheat-bread", "brown rice, cooked": "brown-rice", carrot: "carrot", cucumber: "cucumber",
  "chickpeas, cooked": "chickpeas", "spinach, raw": "spinach", tomato: "tomato", orange: "orange",
};

describe("starter food seed", () => {
  it("has 13 foods, each with a meal type and a positive default portion", () => {
    expect(STARTER_FOODS).toHaveLength(13);
    for (const f of STARTER_FOODS) {
      expect(f.mealTypes.length).toBeGreaterThan(0);
      expect(f.defaultPortionG).toBeGreaterThan(0);
    }
  });
  for (const f of STARTER_FOODS) {
    it(`${f.name}: USDA id ${f.fdcId} is in the recorded search result with the same description`, () => {
      const file = `tests/fixtures/fdc/food-seed/${slug[f.name]}.json`;
      expect(existsSync(file)).toBe(true);
      const foods = (JSON.parse(readFileSync(file, "utf8")) as { foods: { fdcId: number; description: string }[] }).foods;
      const hit = foods.find((x) => String(x.fdcId) === f.fdcId);
      expect(hit, `fdc ${f.fdcId} not in recorded results`).toBeDefined();
      expect(hit!.description).toBe(f.usdaDescription);
    });
  }
});
