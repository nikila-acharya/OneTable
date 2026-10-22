/** The recipe box list. Private to the household; recipes waiting for a check are counted with a link. */
import { OtCard } from "@/components/ui/base";

export interface BoxListItem {
  id: string;
  title: string;
  sourceDomain: string | null;
  totalMinutes: number | null;
  cuisine: string | null;
  ingredientCount: number;
}

export function RecipeBox({ items, waitingForCheck }: { items: BoxListItem[]; waitingForCheck: number }) {
  return (
    <section aria-label="Recipe box">
      <h1>Your recipe box</h1>
      <p className="ot-sub">These are private copies for your household. They are never shown to other households.</p>

      {waitingForCheck > 0 ? (
        <p>
          <a href="/recipes/review">
            {waitingForCheck} {waitingForCheck === 1 ? "recipe" : "recipes"} to check before {waitingForCheck === 1 ? "it joins" : "they join"} your box
          </a>
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="ot-sub">No recipes yet. Recipes you add from blogs and recipe sites will appear here.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {items.map((r) => (
            <li key={r.id} style={{ marginBottom: 12 }}>
              <OtCard>
                <strong>{r.title}</strong>
                <div className="ot-sub">
                  {[r.sourceDomain, r.totalMinutes ? `${r.totalMinutes} min` : null, `${r.ingredientCount} ingredients`, r.cuisine]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </OtCard>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
