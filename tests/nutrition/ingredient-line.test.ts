/** WP-2.4 / RE03 step 1: ingredient lines to quantity, unit, food and grams. */
import { describe, expect, it } from "vitest";
import { parseIngredientLine } from "../../src/lib/nutrition/ingredient-line";

describe("parseIngredientLine", () => {
  it("reads quantity, unit and food for common English lines", () => {
    const r = parseIngredientLine("1 can chickpeas, drained");
    expect(r).toMatchObject({ qty: 1, unit: "can", food: "chickpeas", grams: null, gramsSource: null });
    expect(parseIngredientLine("2 tbsp olive oil")).toMatchObject({ qty: 2, unit: "tbsp", food: "olive oil" });
  });
  it("reads fractions, mixed numbers and unicode glyphs", () => {
    expect(parseIngredientLine("1/2 tbsp brown rice miso").qty).toBe(0.5);
    expect(parseIngredientLine("3 1/3 cups All-purpose flour").qty).toBeCloseTo(3.333, 2);
    expect(parseIngredientLine("\u00BD cup sugar").qty).toBe(0.5);
  });
  it("reads Spanish quantities and drops the connecting 'de'", () => {
    expect(parseIngredientLine("3\u00BD tazas de harina")).toMatchObject({ qty: 3.5, unit: "cup", food: "harina" });
  });
  it("takes an explicit gram weight from the line, including doubled brackets", () => {
    expect(parseIngredientLine("1/2 cup (120 g) sugar")).toMatchObject({ grams: 120, gramsSource: "line", food: "sugar" });
    expect(parseIngredientLine("3 1/3 cups All-purpose flour ((480 g))")).toMatchObject({ grams: 480, gramsSource: "line", food: "All-purpose flour" });
  });
  it("converts mass units to grams; volume without a weight stays null", () => {
    expect(parseIngredientLine("2 oz butter")).toMatchObject({ grams: 56.7, gramsSource: "mass_unit" });
    expect(parseIngredientLine("1 cup soy milk (warm)")).toMatchObject({ grams: null, food: "soy milk" });
  });
  it("keeps the food before a plus sign; 'pinch' has no quantity", () => {
    expect(parseIngredientLine("1 tsp psyllium husk + 6 tsp water").food).toBe("psyllium husk");
    expect(parseIngredientLine("Pinch fine sea salt")).toMatchObject({ qty: null, unit: "pinch", food: "fine sea salt" });
  });
  it("keeps the raw text exactly as written", () => {
    expect(parseIngredientLine("  1  can   chickpeas, drained ").rawText).toBe("1 can chickpeas, drained");
  });
});
