/** WP-2.4 stage 2: per-serving roll-up and the estimate-incomplete rule (pure, recorded fixtures). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chooseMatch, type FdcFood } from "../../src/lib/nutrition/fdc";
import { parseIngredientLine } from "../../src/lib/nutrition/ingredient-line";
import { rollUp, type LineMatch } from "../../src/lib/nutrition/rollup";

const foods = (name: string) => (JSON.parse(readFileSync(`tests/fixtures/fdc/${name}.json`, "utf8")) as { foods: FdcFood[] }).foods;
function lm(raw: string, fixture: string, query: string): LineMatch {
  const line = parseIngredientLine(raw);
  return { line, match: chooseMatch(query, foods(fixture)) };
}

describe("rollUp", () => {
  it("per serving = per 100 g x grams / 100, divided by servings", () => {
    const chick = lm("200 g chickpeas", "chickpeas", "chickpeas");
    const r = rollUp([chick], 2);
    expect(r.perServing.protein_g).toBeCloseTo((chick.match!.per100g.protein! * 200) / 100 / 2, 0);
    expect(r.completeness).toBe(1);
    expect(r.estimateIncomplete).toBe(false);
  });

  it("a volume line with no gram weight is unweighed: estimate incomplete when it is most of the recipe", () => {
    const weighed = lm("200 g chickpeas", "chickpeas", "chickpeas");
    const volume = lm("1 cup soy milk (warm)", "soy-milk", "soy milk");
    const r = rollUp([weighed, volume], 2);
    expect(r.unweighed).toEqual(["1 cup soy milk (warm)"]);
    expect(r.completeness).toBe(0.5);
    expect(r.estimateIncomplete).toBe(true);
  });

  it("an unmatched line is listed and lowers completeness", () => {
    const weighed = lm("200 g chickpeas", "chickpeas", "chickpeas");
    const unknown: LineMatch = { line: parseIngredientLine("50 g unicorn dust"), match: null };
    const r = rollUp([weighed, unknown], 1);
    expect(r.unmatched).toEqual(["50 g unicorn dust"]);
    expect(r.estimateIncomplete).toBe(true);
  });

  it("four of five complete lines is 80% and not incomplete", () => {
    const ok = Array.from({ length: 4 }, () => lm("100 g chickpeas", "chickpeas", "chickpeas"));
    const bad: LineMatch = { line: parseIngredientLine("10 g unicorn dust"), match: null };
    const r = rollUp([...ok, bad], 1);
    expect(r.completeness).toBe(0.8);
    expect(r.estimateIncomplete).toBe(false);
  });

  it("no lines: nothing to show, marked incomplete", () => {
    const r = rollUp([], 1);
    expect(r.perServing).toEqual({});
    expect(r.estimateIncomplete).toBe(true);
  });
});
