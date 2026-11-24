# ADR 124 — meal slots respect declared meal types, and a day never repeats a dish

Date: 2026-11-24
Status: Implemented (PR pending owner merge)
Supersedes: the calories-only banding in `createPlan` shipped with WP-3.1
Touches: PRD §5.1 (planner), ADR-119 (real recipe pool), ADR-121 (`meal_types` from sources),
  ADR-123 (starter library), ADR-122 (step 6 renders the week)
Code: `src/lib/planner/index.ts`, `src/lib/planning/pool.ts`, `tests/planning/slot-bands.test.ts`

## Context

For the first time this week there was a real production plan to look at, and
looking at it found two defects that no test could have caught, because every
suite either used fixtures designed to pass or asserted counts rather than content.

The first real week (21 slots, disposable household, seeded RNG) contained:

```
2026-11-23  breakfast: Aloo Gobi with Roti | lunch: Suji Upma | dinner: Suji Upma
2026-11-27  breakfast: Suji Upma           | lunch: Suji Upma | dinner: Aloo Gobi with Roti
```

Suji Upma twice in one day, and a roti-and-sabzi plate for breakfast.

The cause is three lines that were honest about energy and silent about everything
else:

```ts
const breakfastOptions = availableRecipes.filter((r) => r.caloriesPerServing < 400);
const lunchOptions = availableRecipes.filter((r) => r.caloriesPerServing >= 250 && r.caloriesPerServing < 450);
const dinnerOptions = availableRecipes.filter((r) => r.caloriesPerServing >= 300);
```

A 311 kcal upma satisfies `>= 300`, so it is a dinner candidate. A 363 kcal
aloo-gobi satisfies `< 400`, so it is a breakfast candidate. Nothing in the
selection consulted `recipe.meal_types`.

Worse, `meal_types` was not merely ignored — it was **structurally unreachable**.
The planner's domain `Recipe` interface has no `mealTypes` field at all, and
`planning/pool.ts` loaded the column from the database and then dropped it when
building the domain object. So the tag existed in the schema, was validated at
intake (ADR-121), was written by the starter library (ADR-123), and never reached
the one place that decides what a meal is. That is the same shape of defect as the
unrouted M6 modules (ADR-118) and the stub UI (ADR-122): a capability present in
the data and absent in the behaviour.

## Decision

**1. Bands are energy AND declared slots, with a per-band fallback.**

```ts
const forSlot = (slot) => {
  const byEnergy = availableRecipes.filter((r) => ENERGY_BANDS[slot](r.caloriesPerServing));
  const tagged = byEnergy.filter((r) => (r.mealTypes ?? []).includes(slot));
  return tagged.length > 0 ? tagged : byEnergy;
};
```

Energy stays a hard requirement — it is what the calorie bands exist to protect,
and a household's energy targets are the clinical part of the product. Declared
meal type is now a second requirement **whenever any candidate in that band
declares it**.

The fallback is per band, not global, and it exists for two reasons. First, every
planner fixture and every pre-ADR-124 caller passes no `mealTypes`; making tags
mandatory would empty their bands and throw on pools that are fine today. Second,
a household whose recipes are tagged only for *other* slots must still get a full
week — a hole in the week is a worse failure than a familiar dish. `Recipe.mealTypes`
is therefore optional by design, documented at the declaration, and
`pool.ts` always supplies it from `recipe.meal_types` so real data gets the new
behaviour.

**2. No recipe twice in one calendar day.**

`pick()` filters the band's candidates against the ids already used that day and
draws from the fresh set, falling back to the full band list only when nothing
fresh remains. Draw count per day is unchanged (still one per slot), so the seeded
sequence keeps its shape and determinism holds; only the candidate list shrinks as
the day fills. The last-resort repeat is deliberate: the alternative is a slot with
no recipe, which historically surfaced as `rng.choice([]) → undefined` — the exact
class of defect ADR-119 had to fix.

**3. Errors keep their names.** The existing `no candidate recipe left for <band>`
error is unchanged, and a new empty-after-dedupe path names the date and the pool
sizes rather than producing a silent `undefined`.

## Tests

`tests/planning/slot-bands.test.ts` (7, pure unit, no DB — these run regardless of
`DATABASE_URL`, because both defects are pure functions of pool and seed):

- a breakfast-tagged 311 kcal dish never appears in the dinner slot, and every
  dinner is drawn from the dinner-tagged set **derived from the pool**, not a
  hardcoded list (an earlier draft used a literal `Set(["d1","d2"])`, which would
  keep passing after someone edited `taggedPool`);
- an untagged pool still yields 21 slots — the legacy behaviour is pinned, so
  "optional" cannot quietly become "required" later;
- no calendar day repeats a recipe id, asserted per day across 7 days;
- when one dish is the only candidate for two slots, it may repeat but never
  three times in a day — the documented failure mode, not a hidden one;
- same pool + same seed ⇒ byte-identical week (determinism preserved by the new
  filtering);
- `requireOwnSourceDinners` still lands on own-source dinners after tagging;
- an empty dinner band still throws the named-band error.

Existing suites untouched and green: `tests/planning` + `plans-first` +
`meal-planner` = 53/53. Nothing asserted exact picks, which is why the fix was
possible without rewriting the planner's test history — but note what that also
means: **no prior test would have failed for either defect**, and "53 green" is
evidence of no regression, never evidence of correctness.

## Consequences

- Weeks drawn from the starter library will now be semantically sane: upma at
  breakfast, rajma/pulao/palak-paneer at dinner. Re-deriving an existing draft is
  not automatic — `firstPlan` is idempotent per household/week, so a household
  keeps its already-drafted week until the week rolls over. Fixing the current
  week for a real user is a deliberate act (delete-and-redraft), which is why the
  disposable household that exposed this should simply be erased rather than
  repaired.
- `meal_types` quality now matters. Sources without declared meal types fall back
  to energy, so intake'd recipes behave as before. The starter library declares
  them; imported recipes carry whatever the source exposed (ADR-121). If a source
  mislabels a dish, we obey the label — that is the intended provenance model,
  not guessing.
- Snack slots are still unbuilt (the planner only fills breakfast/lunch/dinner),
  unchanged by this ADR.
- This changed no schema, so there is no migration.
