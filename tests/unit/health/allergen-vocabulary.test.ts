/**
 * The allergen vocabulary is a safety boundary, not a nicety: recipe tags come
 * from scout's vocabulary and member allergies come from the canonical enum,
 * and comparing them verbatim misses the most common allergens. Each test below
 * is a case that used to match nothing.
 */
import { describe, expect, it } from "vitest";
import {
  PROVENANCE_DIETS,
  allergensFromIngredientLine,
  conditionAllergens,
  conflicts,
  dietExcludedAllergens,
  dietTagsFromAssertions,
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

describe("allergensFromIngredientLine (attribution)", () => {
  it("flags Indian and generic spellings that a wheat/milk list would miss", () => {
    expect(allergensFromIngredientLine("200 g paneer, cubed")).toContain("milk");
    expect(allergensFromIngredientLine("2 tbsp ghee")).toContain("milk");
    expect(allergensFromIngredientLine("1 cup atta")).toContain("wheat");
    expect(allergensFromIngredientLine("sooji for the upma")).toContain("wheat");
    expect(allergensFromIngredientLine("1 tbsp tahini")).toContain("sesame");
    expect(allergensFromIngredientLine("30 ml fish sauce")).toContain("fish");
    expect(allergensFromIngredientLine("200 g prawns")).toContain("crustacean shellfish");
    expect(allergensFromIngredientLine("firm tofu, pressed")).toContain("soy");
  });

  it("returns sorted canonical values, empty for plain foods", () => {
    expect(allergensFromIngredientLine("300 g spinach, washed")).toEqual([]);
    expect(allergensFromIngredientLine("1 cup rice")).toEqual([]);
    const out = allergensFromIngredientLine("cashew, peanut and sesame crunch");
    expect(out).toEqual(["peanuts", "sesame", "tree nuts"]);
  });

  it("deliberately over-flags rather than under-flags", () => {
    // "nut" inside a word flags tree nuts; a wrongly excluded recipe costs a
    // candidate, a wrongly cleared recipe can hospitalise someone.
    expect(allergensFromIngredientLine("coconut milk")).toEqual(["milk", "tree nuts"]);
    expect(allergensFromIngredientLine("butternut squash")).toContain("milk"); // "butter"
  });

  it("every emitted value is a member-declarable allergen", () => {
    for (const line of ["paneer", "tahini", "toor dal with soy", "prawn balachance"]) {
      for (const a2 of allergensFromIngredientLine(line)) expect(ALLERGENS).toContain(a2 as never);
    }
  });
});

describe("dietTagsFromAssertions", () => {
  it("records only what the source said about itself", () => {
    expect(dietTagsFromAssertions(["Vegetarian"], [])).toEqual(["vegetarian"]);
    expect(dietTagsFromAssertions(["vegan", "dinner"], undefined)).toEqual(["vegan"]);
    expect(dietTagsFromAssertions(["plant-based"], null)).toEqual(["vegan"]);
    expect(dietTagsFromAssertions(["gluten free"], ["Indian"])).toEqual([]);
    // not an assertion: a cuisine or a course name says nothing about diet
    expect(dietTagsFromAssertions(["Main Course"], ["Italian"])).toEqual([]);
    expect(dietTagsFromAssertions(["halal"], ["kosher"])).toEqual(["halal", "kosher"]);
  });

  it("never infers vegetarian from ingredients", () => {
    // If this ever changes, it becomes a hand-rolled meat detector - the thing
    // ADR-120 rejects. An unasserted recipe must stay unproven.
    expect(dietTagsFromAssertions([], ["1 cup rice, 1 tomato"])).toEqual([]);
  });

  it("lists the diets that need proof, and keeps exclusion-checkable diets out", () => {
    expect([...PROVENANCE_DIETS].sort()).toEqual(["halal", "kosher", "pescatarian", "vegan", "vegetarian"]);
    expect(PROVENANCE_DIETS.has("gluten_free" as never)).toBe(false);
    expect(PROVENANCE_DIETS.has("omnivore" as never)).toBe(false);
  });
});

describe("dietExcludedAllergens", () => {
  it("handles the two diets that are really ingredient exclusions", () => {
    expect(dietExcludedAllergens("gluten_free")).toEqual(["wheat"]);
    expect(dietExcludedAllergens("dairy_free")).toEqual(["milk"]);
    expect(dietExcludedAllergens("omnivore")).toEqual([]);
    expect(dietExcludedAllergens("unspecified")).toEqual([]);
    expect(dietExcludedAllergens(null)).toEqual([]);
  });

  it("makes a gluten_free household member exclude a 'gluten' tagged line", () => {
    const tags = allergensFromIngredientLine("1 cup maida");
    expect(conflicts(tags, dietExcludedAllergens("gluten_free"))).toBe(true);
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
