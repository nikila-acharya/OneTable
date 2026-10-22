/** WP-2.2 — schema.org Recipe parser (RE01). Synthetic pages only: no third-party recipe text in the repo. */
import { describe, expect, it } from "vitest";
import { parseSchemaOrgRecipe, isoDurationMinutes, cleanText, flattenSteps } from "../../src/lib/recipes/schema-org";

const page = (ld: unknown, extra = "") =>
  `<!doctype html><html><head>${extra}<script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>x</body></html>`;

const URL = "https://blog.example.test/lentil-soup";

describe("durations", () => {
  it.each([
    ["PT15M", 15],
    ["PT1H30M", 90],
    ["P1DT2H", 1560],
    ["PT0.5H", 30],
    ["PT", null],
    ["PT1H", 60],
    ["soon", null],
    [undefined, null],
  ])("%s -> %s", (iso, minutes) => {
    expect(isoDurationMinutes(iso)).toBe(minutes);
  });
});

describe("text cleaning", () => {
  it("decodes entities and collapses whitespace", () => {
    expect(cleanText("  Salt &amp; pepper&#39;s\n  &#x2713;  ")).toBe("Salt & pepper's \u2713");
  });
});

describe("steps", () => {
  it("handles a string with line breaks, HowToStep, HowToSection and arrays", () => {
    expect(flattenSteps("Chop.\nFry.")).toEqual(["Chop.", "Fry."]);
    expect(
      flattenSteps([
        { "@type": "HowToSection", name: "Base", itemListElement: [{ "@type": "HowToStep", text: "Chop onion." }] },
        { "@type": "HowToStep", text: "Simmer." },
      ]),
    ).toEqual(["Chop onion.", "Simmer."]);
  });
});

describe("parseSchemaOrgRecipe", () => {
  it("reads a plain Recipe", () => {
    const r = parseSchemaOrgRecipe(
      page({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "Lentil Soup",
        recipeIngredient: ["1 cup lentils", "1 onion, diced"],
        recipeInstructions: [{ "@type": "HowToStep", text: "Rinse lentils." }, { "@type": "HowToStep", text: "Simmer 20 minutes." }],
        recipeYield: ["4 servings", "4"],
        prepTime: "PT10M",
        cookTime: "PT25M",
        recipeCategory: "Dinner",
        recipeCuisine: ["Indian", "Global"],
        author: { "@type": "Person", name: "Asha" },
      }),
      URL,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe).toMatchObject({
      title: "Lentil Soup",
      ingredients: ["1 cup lentils", "1 onion, diced"],
      steps: ["Rinse lentils.", "Simmer 20 minutes."],
      yieldText: "4 servings",
      prepMinutes: 10,
      cookMinutes: 25,
      totalMinutes: 35,
      category: ["Dinner"],
      cuisine: ["Indian", "Global"],
      author: "Asha",
      sourceUrl: URL,
      parseMethod: "markup",
      warnings: [],
    });
  });

  it("finds a Recipe inside @graph next to other nodes", () => {
    const r = parseSchemaOrgRecipe(
      page({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage", name: "Page" }, { "@type": ["Recipe", "Thing"], name: "Graph Soup", recipeIngredient: ["water"], recipeInstructions: "Boil." }] }),
      URL,
    );
    expect(r.ok && r.recipe.title).toBe("Graph Soup");
    expect(r.ok && r.recipe.steps).toEqual(["Boil."]);
  });

  it("reads totalTime when given, and keeps sections in order", () => {
    const r = parseSchemaOrgRecipe(
      page({ "@type": "Recipe", name: "Sectioned", totalTime: "PT1H", recipeIngredient: ["rice"], recipeInstructions: [{ "@type": "HowToSection", itemListElement: [{ text: "Wash rice." }, { text: "Cook." }] }] }),
      URL,
    );
    expect(r.ok && r.recipe.totalMinutes).toBe(60);
    expect(r.ok && r.recipe.steps).toEqual(["Wash rice.", "Cook."]);
  });

  it("a broken JSON-LD block is skipped and the valid one is used", () => {
    const html = `<script type="application/ld+json">{ broken</script>` +
      `<script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Still Found", recipeIngredient: ["egg"], recipeInstructions: "Cook." })}</script>`;
    const r = parseSchemaOrgRecipe(`<html>${html}</html>`, URL);
    expect(r.ok && r.recipe.title).toBe("Still Found");
  });

  it("keeps a recipe with missing steps and says so in warnings", () => {
    const r = parseSchemaOrgRecipe(page({ "@type": "Recipe", name: "Just Ingredients", recipeIngredient: ["salt"] }), URL);
    expect(r.ok && r.recipe.warnings).toEqual(["no method steps found"]);
  });

  it("refuses a page with no recipe data", () => {
    const r = parseSchemaOrgRecipe(page({ "@type": "Article", name: "A story about soup" }), URL);
    expect(r).toEqual({ ok: false, reason: "no schema.org Recipe data on this page" });
  });

  it("refuses a recipe node that has neither ingredients nor steps", () => {
    const r = parseSchemaOrgRecipe(page({ "@type": "Recipe", name: "Empty" }), URL);
    expect(r.ok).toBe(false);
  });

  it("a page with no JSON-LD at all is refused, not crashed on", () => {
    expect(parseSchemaOrgRecipe("<html><body>plain</body></html>", URL).ok).toBe(false);
  });
});
