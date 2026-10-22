/** WP-2.3 review card: unsure fields block adding; Looks right and Edit work. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UnsureReview, type ReviewView } from "../../src/components/recipes/UnsureReview";

const base: ReviewView = { id: "r1", title: "Chickpea Tacos", sourceDomain: "blog.example.test", unsureFields: [], ingredients: ["1 can chickpeas"], steps: ["Mash the chickpeas."] };

describe("UnsureReview", () => {
  afterEach(() => cleanup());
  it("while something is unsure, the recipe cannot be added and each field offers Looks right", () => {
    const onConfirm = vi.fn();
    render(<UnsureReview recipe={{ ...base, unsureFields: ["title", "steps"] }} onConfirm={onConfirm} onEdit={vi.fn()} onAddToBox={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Add to my recipe box" }) as HTMLButtonElement).disabled).toBe(true);
    const looks = screen.getAllByRole("button", { name: "Looks right" });
    expect(looks).toHaveLength(2);
    fireEvent.click(looks[0]!);
    expect(onConfirm).toHaveBeenCalledWith("title");
  });

  it("with nothing unsure, Add to my recipe box works", () => {
    const onAdd = vi.fn();
    render(<UnsureReview recipe={base} onConfirm={vi.fn()} onEdit={vi.fn()} onAddToBox={onAdd} />);
    const btn = screen.getByRole("button", { name: "Add to my recipe box" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onAdd).toHaveBeenCalled();
  });

  it("Edit opens the fields and saves the lines split by line", () => {
    const onEdit = vi.fn();
    render(<UnsureReview recipe={{ ...base, unsureFields: ["ingredients"] }} onConfirm={vi.fn()} onEdit={onEdit} onAddToBox={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const area = screen.getByLabelText(/Ingredients/) as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "1 can chickpeas\n2 tbsp oil" } });
    fireEvent.click(screen.getByRole("button", { name: "Save my changes" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ ingredients: ["1 can chickpeas", "2 tbsp oil"] }));
  });
});
