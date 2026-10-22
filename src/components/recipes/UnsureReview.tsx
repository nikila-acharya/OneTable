"use client";

/** RE02 review card: unsure fields are listed, each with "Looks right" or "Edit". The recipe joins the box only when nothing is unsure. */
import { useState } from "react";
import { OtButton } from "@/components/ui/controls";

export interface ReviewView {
  id: string;
  title: string;
  sourceDomain: string | null;
  unsureFields: string[];
  ingredients: string[];
  steps: string[];
}

const LABEL: Record<string, string> = {
  title: "Title",
  ingredients: "Ingredients",
  steps: "Method steps",
  author: "Author",
  cuisine: "Cuisine",
};

export function UnsureReview({
  recipe,
  onConfirm,
  onEdit,
  onAddToBox,
  busy = false,
}: {
  recipe: ReviewView;
  onConfirm: (field: string) => void;
  onEdit: (edits: { title?: string; ingredients?: string[]; steps?: string[] }) => void;
  onAddToBox: () => void;
  busy?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(recipe.title);
  const [ingredients, setIngredients] = useState(recipe.ingredients.join("\n"));
  const [steps, setSteps] = useState(recipe.steps.join("\n"));
  const unsure = recipe.unsureFields;

  return (
    <section aria-label="Check this recipe" className="ot-review">
      <h2>{recipe.title}</h2>
      {recipe.sourceDomain ? <p className="ot-sub">From {recipe.sourceDomain}</p> : null}

      {unsure.length > 0 ? (
        <div role="group" aria-label="Fields to check">
          <p className="ot-sub">We were not sure about these. Please check them:</p>
          <ul>
            {unsure.map((f) => (
              <li key={f} style={{ marginBottom: 8 }}>
                <strong>{LABEL[f] ?? f}</strong>{" "}
                <OtButton kind="ghost" onClick={() => onConfirm(f)} disabled={busy}>
                  Looks right
                </OtButton>{" "}
                <OtButton kind="ghost" onClick={() => setEditing(true)} disabled={busy}>
                  Edit
                </OtButton>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="ot-sub">Everything has been checked.</p>
      )}

      {editing ? (
        <div aria-label="Edit recipe">
          <label style={{ display: "block", marginBottom: 8 }}>
            Title
            <input className="ot-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label style={{ display: "block", marginBottom: 8 }}>
            Ingredients (one per line)
            <textarea className="ot-input" rows={6} value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
          </label>
          <label style={{ display: "block", marginBottom: 8 }}>
            Method steps (one per line)
            <textarea className="ot-input" rows={6} value={steps} onChange={(e) => setSteps(e.target.value)} />
          </label>
          <OtButton
            onClick={() => {
              onEdit({ title, ingredients: ingredients.split("\n"), steps: steps.split("\n") });
              setEditing(false);
            }}
            disabled={busy}
          >
            Save my changes
          </OtButton>
        </div>
      ) : null}

      <h3>Ingredients</h3>
      <ul>{recipe.ingredients.map((i, n) => <li key={n}>{i}</li>)}</ul>
      <h3>Method</h3>
      <ol>{recipe.steps.map((s, n) => <li key={n}>{s}</li>)}</ol>

      <div className="ot-primary">
        <OtButton full onClick={onAddToBox} disabled={busy || unsure.length > 0}>
          Add to my recipe box
        </OtButton>
      </div>
      {unsure.length > 0 ? <p className="ot-sub">Check the items above to add this recipe to your box.</p> : null}
    </section>
  );
}
