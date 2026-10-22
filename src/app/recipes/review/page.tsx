"use client";

/** Recipes from imports that need a check before they join the recipe box (RE02). */
import { useCallback, useEffect, useState } from "react";
import { UnsureReview, type ReviewView } from "@/components/recipes/UnsureReview";

export default function RecipeReviewPage() {
  const [list, setList] = useState<ReviewView[] | null>(null);
  const [active, setActive] = useState<ReviewView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const apply = useCallback((body: { recipes: ReviewView[] }) => {
    setList(body.recipes);
    setActive((cur) => (cur && body.recipes.find((r) => r.id === cur.id)) || body.recipes[0] || null);
  }, []);

  type Refresh = { error: string } | { body: { recipes: ReviewView[] } };
  const refresh = useCallback(async (): Promise<Refresh> => {
    const res = await fetch("/api/recipes/review");
    if (res.status === 401) return { error: "Please sign in to check your recipes." };
    if (!res.ok) return { error: "We could not load your recipes just now. Please try again." };
    return { body: (await res.json()) as { recipes: ReviewView[] } };
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh().then((r) => {
      if (cancelled) return;
      if ("error" in r) setMessage(r.error);
      else apply(r.body);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh, apply]);

  async function act(payload: Record<string, unknown>) {
    if (!active) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/recipes/${active.id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) return setMessage("That change was not saved. Please try again.");
    const r = await refresh();
    if ('error' in r) setMessage(r.error);
    else apply(r.body);
  }

  if (message) return <main><p role="alert">{message}</p></main>;
  if (list === null) return <main><p>Loading your recipes…</p></main>;
  if (list.length === 0) return <main><p>Nothing needs a check right now.</p></main>;
  if (!active) return null;

  return (
    <main>
      <UnsureReview
        recipe={active}
        busy={busy}
        onConfirm={(field) => void act({ action: "confirm", field })}
        onEdit={(edits) => void act({ action: "edit", ...edits })}
        onAddToBox={() => setMessage("Added to your recipe box.")}
      />
    </main>
  );
}
