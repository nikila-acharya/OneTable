"use client";

/** Manual entry form (CP02): used when a page cannot be read. Prefilled with the link when there is one. */
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function ManualRecipePage() {
  const params = useSearchParams();
  const [title, setTitle] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [steps, setSteps] = useState("");
  const [sourceUrl] = useState(params.get("url") ?? "");
  const [reasons, setReasons] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setReasons([]);
    const res = await fetch("/api/recipes/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, ingredients: ingredients.split("\n"), steps: steps.split("\n"), sourceUrl }),
    });
    if (res.status === 401) return setReasons(["Please sign in to save your recipe."]);
    if (res.status === 422) {
      const body = (await res.json()) as { reasons?: string[] };
      return setReasons(body.reasons ?? ["Please check the recipe and try again."]);
    }
    if (!res.ok) return setReasons(["We could not save this recipe just now. Please try again."]);
    setSaved(true);
  }

  if (saved) return <main><p role="status">Saved to your recipe box.</p><p><Link href="/recipes">Open your recipe box</Link></p></main>;

  return (
    <main>
      <h1>Enter a recipe</h1>
      {sourceUrl ? <p className="ot-sub">From {sourceUrl}</p> : null}
      {reasons.length > 0 ? <ul role="alert">{reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
      <form onSubmit={submit}>
        <label style={{ display: "block", marginBottom: 8 }}>
          Name
          <input className="ot-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label style={{ display: "block", marginBottom: 8 }}>
          Ingredients (one per line)
          <textarea className="ot-input" rows={8} value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
        </label>
        <label style={{ display: "block", marginBottom: 8 }}>
          Method steps (one per line)
          <textarea className="ot-input" rows={8} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </label>
        <button type="submit">Save to my recipe box</button>
      </form>
    </main>
  );
}
