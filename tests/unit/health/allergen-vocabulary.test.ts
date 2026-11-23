/**
 * The allergen vocabulary is a safety boundary, not a nicety: recipe tags come
 * from scout's vocabulary and member allergies come from the canonical enum,
 * and comparing them verbatim misses the most common allergens. Each test below
 * is a case that used to match nothing.
 */
import { describe, expect, it } from "vitest";
import {
  conditionAllergens,
  conflicts,
  householdAllergens,
  toAllergen,
  toAllergens,
} from "@/lib/health/allergen-vocabulary";
import { ALLERGENS } from "@/lib/health/enums";

describe("toAllergen", () => {
  it("maps the spellings that used to miss", () => {
    expect(toAllergen("dairy")).toBe("milk");
    expect(toAllergen("eggs")).toBe("egg");
    expect(toAllergen("gluten")).toBe("wheat");
    expect(toAllergen("tree_nuts")).toBe("tree nuts");
    expect(toAllergen("shellfish")).toBe("crustacean shellfish");
    expect(toAllergen("shrimp")).toBe("crustacean shellfish");
    expect(toAllergen("tahini")).toBe("sesame");
    expect(toAllergen("tofu")).toBe("soy");
    expect(toAllergen("paneer")).toBe("milk");
    expect(toAllergen("barley")).toBe("wheat");
  });

  it("accepts its own canonical values back", () => {
    for (const a of ALLERGENS) expect(toAllergen(a)).toBe(a);
  });

  it("is spelling-insensitive about separators", () => {
    expect(toAllergen("Tree Nuts")).toBe("tree nuts");
    expect(toAllergen("tree-nuts")).toBe("tree nuts");
    expect(toAllergen("  CRUSTACEAN SHELLFISH ")).toBe("crustacean shellfish");
  });

  it("returns null rather than guessing for things members cannot declare", () => {
    expect(toAllergen("mustard")).toBeNull();
    expect(toAllergen("celery")).toBeNull();
    expect(toAllergen("lupin")).toBeNull();
    expect(toAllergen("molluscs")).toBeNull();
    expect(toAllergen("sulfites")).toBeNull();
    expect(toAllergen(undefined)).toBeNull();
    expect(toAllergen(42)).toBeNull();
    expect(toAllergen("")).toBeNull();
    // and critically: it must not silently broaden
    expect(toAllergen("okara-unknown")).toBeNull();
  });

  it("every value it emits is a real member-declarable allergen", () => {
    for (const probe of ["dairy", "eggs", "gluten", "tree_nuts", "shellfish", "peanut", "soya", "semolina", "ghee"]) {
      const out = toAllergen(probe);
      expect(ALLERGENS).toContain(out as never);
    }
  });
});

describe("conflicts", () => {
  it("catches the pairs that verbatim comparison missed", () => {
    expect(conflicts(["dairy"], ["milk"])).toBe(true);
    expect(conflicts(["eggs"], ["egg"])).toBe(true);
    expect(conflicts(["gluten"], ["wheat"])).toBe(true);
    expect(conflicts(["tree_nuts"], ["tree nuts"])).toBe(true);
    expect(conflicts(["shrimp"], ["crustacean shellfish"])).toBe(true);
    expect(conflicts(["peanuts"], ["peanuts"])).toBe(true);
  });

  it("does not invent a conflict where there is none", () => {
    expect(conflicts(["gluten"], ["peanuts"])).toBe(false);
    expect(conflicts(["mustard"], ["milk"])).toBe(false);
    expect(conflicts([], ["milk"])).toBe(false);
    expect(conflicts(["dairy"], [])).toBe(false);
  });

  it("deduplicates and sorts, so the value can be stored and compared", () => {
    expect(toAllergens(["milk", "dairy", "butter", "gluten", "wheat", "cheese"])).toEqual(["milk", "wheat"]);
  });
});

describe("conditionAllergens", () => {
  it("treats celiac as a hard gluten filter (SG01)", () => {
    expect(conditionAllergens(["celiac disease"])).toEqual(["wheat"]);
    expect(conflicts(["gluten"], conditionAllergens(["celiac disease"]))).toBe(true);
    expect(conflicts(["barley"], conditionAllergens(["celiac disease"]))).toBe(true);
  });

  it("does NOT turn other conditions into food exclusions", () => {
    // These change advice mode (general guidance) or targets, not which recipes
    // are edible. Over-excluding would quietly starve the pool.
    for (const c of ["type 2 diabetes", "chronic kidney disease", "pregnancy", "hypertension", "high cholesterol"]) {
      expect(conditionAllergens([c])).toEqual([]);
    }
  });
});

describe("householdAllergens", () => {
  it("unions allergies across members and folds in the celiac filter", () => {
    const out = householdAllergens([
      { allergens: ["peanuts"], conditions: [] },
      { allergens: ["dairy"], conditions: ["celiac disease"] },
      { allergens: [], conditions: ["type 2 diabetes"] },
    ]);
    expect(out).toEqual(["milk", "peanuts", "wheat"]);
  });

  it("tolerates missing fields rather than throwing on a fresh member", () => {
    expect(householdAllergens([{ }, {}, ] as never)).toEqual([]);
  });
});
