/**
 * One allergen vocabulary, on purpose.
 *
 * Members store allergies from the canonical enum in `src/lib/health/enums.ts`
 * (`milk`, `egg`, `tree nuts`, `wheat`, `crustacean shellfish`, …) because
 * onboarding and the setup parser validate against it. Recipe-side tags come
 * from `ScoutAgent.extractAllergenTags`, which emits a DIFFERENT vocabulary
 * (`dairy`, `eggs`, `gluten`, `tree_nuts`, `shellfish`, plus EU-only tags like
 * `mustard`/`celery`/`lupin`/`molluscs`).
 *
 * Comparing those two sets verbatim silently misses the most common cases:
 *   member "milk"    vs recipe "dairy"    -> no match -> cheese planned anyway
 *   member "egg"     vs recipe "eggs"     -> no match
 *   member "wheat"   vs recipe "gluten"   -> no match -> barley/rye planned anyway
 *   member "tree nuts" vs recipe "tree_nuts" -> space vs underscore
 *   member "crustacean shellfish" vs "shellfish" -> no match
 * This module is the single place that translation happens, so any consumer
 * compares enum values on both sides. Found while building the planning pool
 * (ADR-120), before any recipe existed in production — which is the only reason
 * it was not live.
 */
import { ALLERGENS, GLUTEN_HARD_FILTER_CONDITION, type Allergen } from "./enums";

const CANONICAL = new Set<string>(ALLERGENS);

/** Recipe-side tag -> canonical allergen. Unmapped values are EU-only tags that
 *  no member can hold, so they are dropped rather than guessed at. */
const TAG_TO_ALLERGEN: Record<string, Allergen | undefined> = {
  peanuts: "peanuts",
  peanut: "peanuts",
  tree_nuts: "tree nuts",
  "tree nuts": "tree nuts",
  tree_nut: "tree nuts",
  nuts: "tree nuts",
  almond: "tree nuts",
  walnut: "tree nuts",
  cashew: "tree nuts",
  pistachio: "tree nuts",
  pecan: "tree nuts",
  hazelnut: "tree nuts",
  macadamia: "tree nuts",
  brazil_nut: "tree nuts",
  "brazil nut": "tree nuts",
  pine_nut: "tree nuts",
  chestnut: "tree nuts",
  milk: "milk",
  dairy: "milk",
  cheese: "milk",
  butter: "milk",
  cream: "milk",
  yogurt: "milk",
  whey: "milk",
  casein: "milk",
  lactose: "milk",
  ghee: "milk",
  paneer: "milk",
  egg: "egg",
  eggs: "egg",
  wheat: "wheat",
  gluten: "wheat",
  barley: "wheat",
  rye: "wheat",
  spelt: "wheat",
  kamut: "wheat",
  semolina: "wheat",
  soy: "soy",
  soya: "soy",
  tofu: "soy",
  tempeh: "soy",
  edamame: "soy",
  sesame: "sesame",
  tahini: "sesame",
  fish: "fish",
  salmon: "fish",
  tuna: "fish",
  cod: "fish",
  anchovy: "fish",
  sardine: "fish",
  shrimp: "crustacean shellfish",
  prawn: "crustacean shellfish",
  crab: "crustacean shellfish",
  lobster: "crustacean shellfish",
  shellfish: "crustacean shellfish",
  "crustacean shellfish": "crustacean shellfish",
  crustacean: "crustacean shellfish",
};

function key(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** Canonical allergen for any spelling we recognise, else null. */
export function toAllergen(value: unknown): Allergen | null {
  if (typeof value !== "string") return null;
  const k = key(value);
  if (!k) return null;
  const mapped = TAG_TO_ALLERGEN[k];
  if (mapped) return mapped;
  // Already canonical (the enum contains spaced values like "tree nuts").
  const spaced = k.replace(/_/g, " ");
  return CANONICAL.has(spaced) ? (spaced as Allergen) : null;
}

/** Normalise a mixed bag of tags to a sorted, deduplicated canonical set.
 *  Unknown tags are dropped: inventing an allergen a member cannot hold would
 *  only inflate exclusions, and silently mapping them to something broad would
 *  be a guess about food safety. */
export function toAllergens(values: readonly unknown[]): Allergen[] {
  const out = new Set<Allergen>();
  for (const v of values) {
    const a = toAllergen(v);
    if (a) out.add(a);
  }
  return [...out].sort();
}

/** True when the two sides overlap, compared in canonical space. */
export function conflicts(recipeTags: readonly unknown[], memberAllergens: readonly unknown[]): boolean {
  const recipe = new Set(toAllergens(recipeTags));
  return toAllergens(memberAllergens).some((a) => recipe.has(a));
}

/**
 * SG01 hard filter: celiac behaves like an allergen even though it is stored as
 * a condition, so a celiac member must be screened against wheat/gluten the same
 * way an allergy is. Anything else (diabetes, CKD, pregnancy) changes *advice
 * mode*, not which recipes are edible, and is handled by the consent/gate layer.
 */
export function conditionAllergens(conditions: readonly unknown[]): Allergen[] {
  const has = (c: unknown) => typeof c === "string" && c.trim().toLowerCase() === GLUTEN_HARD_FILTER_CONDITION;
  return conditions.some(has) ? ["wheat"] : [];
}

/** Allergens a household must avoid: declared allergies plus condition-derived hard filters. */
export function householdAllergens(
  members: readonly { allergens?: readonly unknown[]; conditions?: readonly unknown[] }[],
): Allergen[] {
  return toAllergens(
    members.flatMap((m) => [...(m.allergens ?? []), ...conditionAllergens(m.conditions ?? [])]),
  );
}
