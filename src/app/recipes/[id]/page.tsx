"use client";

/** One recipe from the box. */
import { useEffect, useState } from "react";
import { RecipeDetail, type DetailView } from "@/components/recipes/RecipeDetail";

export default function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<DetailView | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    params.then(async ({ id: rid }) => {
      if (cancelled) return;
      setId(rid);
      const res = await fetch(`/api/recipes/${rid}`);
      if (cancelled) return;
      if (res.status === 401) return setMessage("Please sign in to see this recipe.");
      if (res.status === 404) return setMessage("We could not find that recipe in your box.");
      if (!res.ok) return setMessage("We could not load this recipe just now. Please try again.");
      setRecipe((await res.json()) as DetailView);
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  if (message) return <main><p role="alert">{message}</p></main>;
  if (!id || !recipe) return <main><p>Loading recipe…</p></main>;
  return <main><RecipeDetail recipe={recipe} /></main>;
}
