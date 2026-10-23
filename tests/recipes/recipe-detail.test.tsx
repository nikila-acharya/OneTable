/** Recipe detail view: lines in order, external source link opens in a new tab, private note. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RecipeDetail, type DetailView } from "../../src/components/recipes/RecipeDetail";

const recipe: DetailView = { title: "Lentil Dal", author: "A. Cook", sourceUrl: "https://blog.example.test/dal", sourceDomain: "blog.example.test", prepMinutes: 5, cookMinutes: 25, totalMinutes: 30, cuisine: "Indian", ingredients: ["1 cup lentils", "1 onion"], steps: ["Rinse the lentils.", "Simmer for 20 minutes."] };

describe("RecipeDetail", () => {
  afterEach(() => cleanup());

  it("shows title, times, lines in order and the private note", () => {
    render(<RecipeDetail recipe={recipe} />);
    expect(screen.getByRole("heading", { level: 1, name: "Lentil Dal" })).toBeTruthy();
    expect(screen.getByText(/By A\. Cook · Indian · 5 min prep · 25 min cook · 30 min total/)).toBeTruthy();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["1 cup lentils", "1 onion", "Rinse the lentils.", "Simmer for 20 minutes."]);
    expect(screen.getByText("Private to your household.")).toBeTruthy();
  });

  it("the source link opens in a new tab, safely", () => {
    render(<RecipeDetail recipe={recipe} />);
    const link = screen.getByRole("link", { name: "blog.example.test" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("no source line when there is no source", () => {
    render(<RecipeDetail recipe={{ ...recipe, sourceUrl: null, sourceDomain: null }} />);
    expect(screen.queryByText(/Original recipe/)).toBeNull();
  });
});
