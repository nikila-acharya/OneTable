# ADR 123 — the starter library ships as a data migration, with hand-pinned USDA records

Date: 2026-11-24
Status: Implemented (PR pending owner merge)
Touches: PRD §5.0 (AC "plan from our recipe starter library"), §5.1 (RE03 calories from USDA),
  §5.3 (verbatim method only from household-added sources), ADR-119 (pool from real rows),
  ADR-121 (intake), ADR-122 (step 6 runs the pipeline)
Code: `drizzle/migrations/0008_starter_library.sql`, `scripts/build-starter-library.ts`,
  `scripts/pin-starter-foods.ts`, `scripts/starter-food-pins.json`,
  `tests/planning/starter-library.test.ts`

## Context

Since ADR-119 the planner has read real `recipe` rows, and since ADR-122 step 6
calls it. Both were correct and both were unusable, for one reason: **`recipe` is
empty in every environment.** No household has ever been able to get a plan.

The repository already contained two attempts at a starter library, and both are
dead:

- `scripts/seed.ts` is a 26-line placeholder nothing calls;
- `src/lib/nutrition/food-seed.ts` + `seedStarterFoods()` define 13 hand-picked
  USDA *foods*, and `plan_slot` even has a `food_item_id` column — but **no caller
  of the seeder exists and `src/lib/planner` contains zero references to
  `foodItem`**, so the schema half and the data half were never joined up.

Meanwhile PRD §5.0's onboarding AC states the app will "plan from our recipe
starter library", and the UI prints that sentence today (flagged in ADR-122 as a
contradiction the owner had to resolve). This ADR resolves it in favour of
building the thing rather than editing the promise.

## Decision

**1. Ship it as migration `0008_starter_library.sql`, not as a seed script.**
`npm run db:migrate` already runs on every deploy against staging and production
(`deploy.yml`), so a data migration means the library exists everywhere the
schema exists — including CI's throwaway Postgres, which is where the planning
tests get their candidates. A seed script would have created the classic split
state: works locally because somebody remembered, empty everywhere else. The SQL
is `ON CONFLICT DO NOTHING` so re-application is safe.

**2. The content is 14 original recipes, not scraped ones.** They are written for
this file, so `source_url` stays NULL, `parse_method='manual'`, and PRD §5.3
(verbatim method text only from sources the household added) is not engaged.
Cuisine is Indian-vegetarian because that is what this household's linked sources
are, and every dish asserts `vegetarian` in `diet_tags` — an assertion I own as
the author, which is exactly what ADR-121 requires before a recipe can satisfy a
declared diet.

**3. Calories come from hand-pinned USDA records, deliberately bypassing the fuzzy
matcher.** A probe run showed what `chooseMatch` does with real Indian grocery
terms:

| food term | what the matcher picked |
|---|---|
| `tomato` | "Tomato powder" (~20× fresh tomato's energy) |
| `onion` | "DENNY'S, onion rings" |
| `idli rice` | "Rice crackers" |
| `sambar powder` | "Baobab powder" |
| `yogurt` | "Tofu yogurt" |

Those are real USDA records and the confidence maths is working as designed — they
are simply not the foods a recipe means, and the resulting numbers look
authoritative while being false. That is worse than no number, so
`scripts/pin-starter-foods.ts` selects each record against an explicit expected
description pattern (the "picked by hand" step, encoded), and
`scripts/starter-food-pins.json` is **committed next to the generator** so the
migration is reproducible and reviewable without network access. The rollup then
uses the app's own `rollUp()`, so the arithmetic is the product's arithmetic.

**4. Two pins are single-ingredient Branded records, on purpose.** USDA returns no
usable non-branded record for `peanuts` in the search page, and `Oats, puffed`
(Foundation) carries minerals but no energy, with its detail endpoint 404ing. The
branded records do carry energy and agree with the SR figures (oats 375 vs ~389
per 100 g; peanuts 571 vs 567). Only `fdc_id` is stored and the UI renders *my*
ingredient text, so no brand name reaches a user. This exception is commented at
the pin site rather than hidden.

**5. `paneer` has no generic USDA record** and is pinned to "Cheese, cottage,
creamed, large or small curd" as the nearest standard equivalent, and
`curry leaves` — which USDA does not carry at all — were replaced with coriander
leaves in the recipe text. Changing my own recipe is honest; inventing a
nutrient row is not. `garam masala` and `sambar powder` blends likewise have no
generic record, so the recipes now use coriander/cumin/chilli, which do.

**6. Recipes are authored in grams.** `parseIngredientLine` converts mass units
and refuses to guess volume — there is a test asserting *"volume without a weight
stays null"* — so a line like "1 cup oats" contributes zero calories by design.
My first draft used cups and got `Masala Oats = 0 kcal` and `Aloo Gobi = 24 kcal`,
which is arithmetically correct for the 400 g of cauliflower alone: **every
cup/tbsp/count line had silently vanished.** Since these are recipes I am
writing, grams are simply part of the recipe, not a claimed conversion.

That behaviour is still a production gap for *imported* recipes: food blogs are
written in cups, so their lines contribute nothing and the recipe is excluded as
`no_nutrients`. See Consequences.

**7. The generator refuses to emit unless the data is sound.** Its first guard only
checked that calorie bands were non-empty, which passed while 11 of 14 recipes had
zero usable calories. It now fails the build on: any ingredient without a pin, any
line that contributed nothing, any line without a gram weight, `kcal/serving`
outside 150–900, `completeness < 0.8`, or fewer than 3 candidates in any band the
planner uses (breakfast <400, lunch 250–450, dinner ≥300).

**8. Two existing tests had to change diet, and the reason is recorded rather than
papered over.** `week-plan.test.ts` and `import-sources.test.ts` asserted
`diet_provenance_unavailable` for a **vegetarian** member against an empty table.
Once the library asserts vegetarian, those tests would pass for the wrong reason
or fail for the right one — so the declared diet is now `vegan`, which nothing in
the library asserts. The property under test (an unproven diet excludes rather
than letting the planner infer it from the word "paneer") is preserved, not
weakened.

## Verification

`tests/planning/starter-library.test.ts` (5): rows are `visibility='starter'` with
`household_id IS NULL` (otherwise PV03 erasure would miss them) and kcal in range;
peanut/milk/tree-nut attribution present on shared rows; **a household with zero
own recipes gets all 21 slots** from the library with >3 distinct recipes; a
peanut-allergic member's pool and week exclude both peanut recipes with
`allergen:peanuts` while the ghee-only dal remains allowed; Veg Pulao is excluded
for `tree_nuts` although no nut appears in its title.

## Consequences

- The §5.0 AC sentence "we'll plan from our recipe starter library" is now true
  instead of pending, and ADR-122's flagged contradiction closes.
- **Imported recipes still get poor nutrition.** Two independent causes, both
  open: (a) volume/count units are refused by design, so "1 cup" lines contribute
  nothing; (b) the fuzzy matcher can pick a wrong-but-real record. The fix is a
  curated alias→FDC table (the shape `STARTER_FOODS` already implies) with a
  dietitian pass, plus optionally per-food density handling. Until then, intake
  results will often be excluded `no_nutrients`, and the UI says so plainly.
- `food_item` / `seedStarterFoods()` / `plan_slot.food_item_id` remain unused.
  Deleting them or finishing that design is a separate owner decision; this ADR
  chose recipes because the planner already consumes them.
- Dev databases that already applied an earlier 0008 need the file re-run manually
  (drizzle records the migration as applied and will not re-execute changed
  content). Done for `onetable_dev` in this session.
- CI is now *expected* to contain starter rows; planning tests must stay tolerant
  of them (the pattern established in ADR-122: assert membership/counts relative
  to the household's own ids, never absolute totals).
