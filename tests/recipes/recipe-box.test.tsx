/** The recipe box list: private note, count of waiting recipes, empty state. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RecipeBox } from "../../src/components/recipes/RecipeBox";

const item = { id: "1", title: "Bean Soup", sourceDomain: "blog.example.test", totalMinutes: 40, cuisine: "Mexican", ingredientCount: 2 };

describe("RecipeBox", () => {
  afterEach(() => cleanup());

  it("shows the private-copy note and each recipe", () => {
    render(<RecipeBox items={[item]} waitingForCheck={0} />);
    expect(screen.getByText(/never shown to other households/)).toBeTruthy();
    expect(screen.getByText("Bean Soup")).toBeTruthy();
    expect(screen.getByText(/blog\.example\.test · 40 min · 2 ingredients · Mexican/)).toBeTruthy();
  });

  it("links to the review queue when recipes are waiting for a check", () => {
    render(<RecipeBox items={[item]} waitingForCheck={2} />);
    const link = screen.getByRole("link", { name: /2 recipes to check/ });
    expect(link.getAttribute("href")).toBe("/recipes/review");
  });

  it("no link when nothing is waiting; an empty box says so", () => {
    render(<RecipeBox items={[]} waitingForCheck={0} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/No recipes yet/)).toBeTruthy();
  });
});
