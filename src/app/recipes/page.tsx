"use client";

/** The household's recipe box (PRD 5.3). */
import { useEffect, useState } from "react";
import { RecipeBox, type BoxListItem } from "@/components/recipes/RecipeBox";

export default function RecipesPage() {
  const [data, setData] = useState<{ items: BoxListItem[]; waitingForCheck: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/recipes/box").then(async (res) => {
      if (cancelled) return;
      if (res.status === 401) return setMessage("Please sign in to see your recipe box.");
      if (!res.ok) return setMessage("We could not load your recipe box just now. Please try again.");
      setData((await res.json()) as { items: BoxListItem[]; waitingForCheck: number });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (message) return <main><p role="alert">{message}</p></main>;
  if (!data) return <main><p>Loading your recipe box…</p></main>;
  return (
    <main>
      <RecipeBox items={data.items} waitingForCheck={data.waitingForCheck} />
    </main>
  );
}
