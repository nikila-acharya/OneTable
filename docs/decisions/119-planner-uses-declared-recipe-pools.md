# ADR 119 — planning runs on declared recipe pools; hard filters live in the loader

Date: 2026-11-21
Status: Implemented (PR pending owner merge)
Supersedes: the implicit behaviour where `createPlan()` drew from a hardcoded
  mock recipe library inside `src/lib/planner/index.ts`
Touches: PRD WP-3.4 (hard filters), WP-3.5 (seeded determinism), WP-5.5 (API),
  NF-P2/PR03 (allergen confirmation), §6 safety; `plan`/`plan_slot`/`slot_member`
Code: `src/lib/planner/index.ts`, `src/lib/planning/pool.ts`,
  `src/lib/planning/firstPlan.ts`, `src/app/api/plans/first/route.ts`,
  `src/agent/meal-planner.ts`

## Context

The owner pressed "Plan our first week" on the only real household. Verification
against production showed the household persisted correctly — 4 members, 112
attendance rows, encrypted health, 8 consent rows, 4 sources — and:

```
plans: 0   plan_slot: 0   agent_run: 0   recipe: 0 (by household)
```

Nothing downstream of onboarding had ever run. Not a runtime failure: an absent
seam. The M3 planner and the M5 schema were both finished and green, but no
production code ever read a `recipe` row into the planner or wrote a `plan` out.
`firstPlanRequestedAt` is consumed only by `steps/review.tsx:101` to pick a UI
phase, so the button stored a client-side flag and waited for a server that was
never asked.

Reading `createPlan()` explained why the gap could survive every green suite:

```ts
const availableRecipes = Object.values(RECIPE_LIBRARY).filter(...)
```

`RECIPE_LIBRARY` is 16 hardcoded meals (Oatmeal, Grilled Chicken Breast, Salmon,
Caesar Salad, Apple Pie…). Planning worked, tests passed, and the output was
fiction — including meat meals for a household whose four linked sources are all
vegetarian. Worse, those ids (`recipe-007`) are not `recipe.id` values, so a plan
built from them **cannot be persisted**: `plan_slot.shared_recipe_id` FKs to
`recipe.id`. The mock was reachable only because nothing ever tried to save.

Two further defects surfaced while adding tests, both real and both pre-existing:

1. **`rng.choice([])` returns `undefined`.** When a calorie band ended up empty,
   a meal was pushed with `recipe: undefined` and something downstream threw a
   TypeError several frames away — or, through `draftPlan`, returned a "success"
   with a hole in the week.
2. **The planner ignores `options.dietPreferences` entirely.** It is accepted in
   the type and never used, so a vegetarian household would receive meat from any
   pool that contains it.

Also found: the DB `activity_level` enum (`sedentary|light|moderate|high|athlete`)
and the M4 `MemberProfile.activity` union (`…|active|very_active`) were written
independently and never met, which is why the mismatch survived.

## Decision

**1. `PlanOptions.pool: Recipe[]` is required, and `createPlan` throws on an
empty pool.** The mock library remains exported as `RECIPE_LIBRARY`, but only as
an explicitly declared test fixture — 26 call sites in `meal-planner.test.ts` and
`manual-test.ts` were updated to pass it by name, which keeps every existing
assertion meaningful (they were calibrated to that content) while making the
implicit fallback impossible. A production path can no longer plan fiction.

**2. `PlanRequest.pool` is required on the agent too.** `draftPlan` returns
`{success:false, error:"No recipe pool provided"}` rather than substituting
anything. The agent keeps ownership of preference extraction and the SG02 energy
floor, so planning logic is not duplicated in the new service.

**3. Hard filters live in `src/lib/planning/pool.ts`, not in the planner.** The
planner bands by calories and picks with the seeded RNG; it cannot see sources,
confirmation state or provenance. The loader therefore applies, in SQL where
possible:

- `status = 'ready'` and `takedown_at IS NULL` (filtered in the query)
- the household's own recipes **plus the shared starter library**
  (`household_id IS NULL`, legal only for `visibility='starter'` under the
  `recipe_visibility_household` check)
- allergens from `recipe_ingredient.uncertain_allergen_tags`, **treated as
  present** — failing safe on uncertainty — excluded unless a PR03
  `allergen_confirmation(recipe_id, member_id)` row exists for every affected
  member
- `recipe_nutrients.per_serving.kcal` required; a recipe with no nutrition
  rollup is excluded rather than planned as 0 kcal, because 0 would silently
  skew every calorie band

The planner keeps its allergen check as defence in depth, documented as such.

**4. Diets we cannot prove are refused with 501, not guessed.** `recipe` has no
diet tags, so vegetarian/vegan/pescatarian/halal/kosher suitability cannot be
established from stored data. Deriving it from ingredient strings would mean
hand-rolling a meat list — precisely what the safety rules forbid — so
`loadRecipePool` returns `blockedOn: 'diet_provenance_unavailable'` and the route
answers 501 `pool_blocked`. Refusing is honest; inventing a detection list to
produce a plausible plan is not. Intake must record tags, then this becomes a
filter instead of a refusal.

**5. Empty calorie bands are a stated failure.** `createPlan` now reports which
band ran out and how large the pool was, instead of returning a week with
`undefined` recipes. This is the normal outcome for a small household pool, so it
is a 409 `planner_refused`, not a mystery 500.

**6. Seed is derived, and pool order is fixed.** `seed = sha256(household_id +
week_start)` truncated into an int, so a retry reproduces the same week without
storing anything new. Because the seeded RNG indexes into the candidate array,
`loadRecipePool` orders by `recipe.id`: Postgres guarantees no order, and without
it two identical calls could plan two different weeks — breaking the
reproducibility WP-3.5 promises. A test asserts both stability and sortedness.

**7. Idempotency per week, checked explicitly.** `generateWeekPlan` returns the
existing plan for (household, week_start) with `created: false` / HTTP 200. The
schema has no unique index here, so the guard is in code; a future migration
adding `unique(household_id, week_start)` would make it airtight and is
recommended, not done here (it would fail on the duplicate weeks any existing
data might already hold, which needs its own check).

**8. Persistence is one transaction.** plan → slots → slot_member rows for every
member; a failure leaves no half-written week, matching ADR-008 as amended.

## Consequences

- The owner's household can now be planned *once recipes exist*. With
  `recipe = 0` it returns **409 `no_recipes`** — a truthful, actionable answer
  instead of silence or a fictional week. Filling the pool is the next work
  package (intake from their 4 linked sources), and it is where the diet tags
  for decision 4 must come from.
- 16 mock meals can never reach a user again by accident. Their removal from the
  implicit path is the point; the fixture remains only because tests name it.
- The M3↔M5 seam is now covered by tests that assert real DB reads and writes
  (`tests/planning/week-plan.test.ts`, 11 tests) and status mapping
  (`tests/unit/api/plans-first.test.ts`, 6 tests). One assertion — "household
  with no recipes errors" — was **deliberately dropped**: this database
  legitimately contains starter rows, so the expectation tested the fixture set
  rather than the code. That path is covered by the mocked route test instead,
  and the reason is recorded in the test file.
- Two pre-existing planner defects (empty band → `undefined`; unused
  `dietPreferences`) are now documented in code. The second is *mitigated* by the
  501 refusal, not solved; solving it belongs to intake.
- `POST /api/plans/first` has no body, so it cannot be aimed at another
  household. Household comes from the session, as everywhere else.
- Live-DB planning tests exceed vitest's 5000ms default comfortably — they
  insert 4-7 recipes plus ingredients and nutrients per test over a WAN. This
  file sets explicit `{ timeout: 30000 }` per test rather than leaving it to the
  default, which is the narrower version of the still-open "set test timeouts"
  infra item.
