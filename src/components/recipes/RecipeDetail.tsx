/** One recipe from the box. The source link opens the original site in a new tab. */
import Link from "next/link";
export interface DetailView {
  title: string;
  author: string | null;
  sourceUrl: string | null;
  sourceDomain: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  cuisine: string | null;
  ingredients: string[];
  steps: string[];
}

export function RecipeDetail({ recipe }: { recipe: DetailView }) {
  const times = [
    recipe.prepMinutes ? `${recipe.prepMinutes} min prep` : null,
    recipe.cookMinutes ? `${recipe.cookMinutes} min cook` : null,
    recipe.totalMinutes ? `${recipe.totalMinutes} min total` : null,
  ].filter(Boolean);
  return (
    <article aria-label="Recipe">
      <p><Link href="/recipes">← Recipe box</Link></p>
      <h1>{recipe.title}</h1>
      <p className="ot-sub">
        {[recipe.author ? `By ${recipe.author}` : null, recipe.cuisine, times.join(" · ") || null].filter(Boolean).join(" · ")}
      </p>
      {recipe.sourceUrl ? (
        <p>
          Original recipe:{" "}
          <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer">
            {recipe.sourceDomain ?? recipe.sourceUrl}
          </a>
        </p>
      ) : null}
      <p className="ot-sub">Private to your household.</p>
      <h2>Ingredients</h2>
      <ul>{recipe.ingredients.map((i, n) => <li key={n}>{i}</li>)}</ul>
      <h2>Method</h2>
      <ol>{recipe.steps.map((s, n) => <li key={n}>{s}</li>)}</ol>
    </article>
  );
}
