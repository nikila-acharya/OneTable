/** WP-2.6 first pass: SEO text after a pipe is dropped from recipe titles. */
import { describe, expect, it } from "vitest";
import { cleanRecipeTitle } from "../../src/lib/recipes/schema-org";

describe("cleanRecipeTitle", () => {
  it("keeps the recipe name before the pipe", () => {
    expect(cleanRecipeTitle("paneer bread roll recipe | bread paneer rolls | paneer stuffed bread rolls")).toBe("paneer bread roll recipe");
    expect(cleanRecipeTitle("khoya paneer recipe | how to make khoya paneer curry")).toBe("khoya paneer recipe");
  });
  it("keeps a title without a pipe whole", () => {
    expect(cleanRecipeTitle("Lentil Dal")).toBe("Lentil Dal");
    expect(cleanRecipeTitle("Mac & Cheese - Family Size")).toBe("Mac & Cheese - Family Size");
  });
  it("keeps the whole title when the first part is too short to be a name", () => {
    expect(cleanRecipeTitle("A | Soup Recipe")).toBe("A | Soup Recipe");
  });
  it("decodes entities as before", () => {
    expect(cleanRecipeTitle("Bob&rsquo;s Oats | Blog")).toBe("Bob\u2019s Oats");
  });
});
