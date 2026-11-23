# ADR 121 — synchronous source intake with asserted diet provenance and over-flagged allergens

Date: 2026-11-23
Status: Implemented (PR pending owner merge)
Supersedes: nothing — it completes ADR-119's "next work package" and ADR-120's
  "nothing writes `uncertain_allergen_tags` yet"
Touches: PRD WP-2.1/2.2/2.3 (CP01 fetch, schema.org parse, RE02 review), WP-2.4
  (RE03 nutrition), WP-3.4 (hard filters), WP-4.7 (scout), §5.3 (copyright),
  NF-P2, ADR-015 (social platforms never read), ADR-119, ADR-120
Code: `src/lib/intake/importSources.ts`, `src/lib/intake/enrich.ts`,
  `src/app/api/sources/import/route.ts`, `src/lib/health/allergen-vocabulary.ts`,
  `src/lib/recipes/review.ts`, `src/lib/planning/pool.ts`,
  `db/schema.ts` + `drizzle/migrations/0007_*`

## Context

After ADR-119 the planner could build a week from real database rows, but every
household got 409 `no_recipes`: production had zero recipes, and three columns
the pool depends on had **no writer anywhere in the codebase** —
`recipe_ingredient.uncertain_allergen_tags`, `recipe_nutrients`, and (before this
ADR) any diet provenance at all. ADR-120 additionally left allergen attribution
unwritten, so the corrected comparison had nothing correct to compare.

Meanwhile a lot of intake already existed and was tested: `createFetcher`
(robots-first, 1 request/second/domain, 15s timeout, 2 MB cap, HTML only),
`parseSchemaOrgRecipe`, the LLM fallback parser, `saveParsedRecipe` (recipe +
ingredients + steps with RE02 `needs_review`), `mapRecipeNutrition` (FDC search +
cache + per-serving roll-up), and `POST /api/recipes/import` for one pasted
link. What did not exist was any orchestration over **linked sources**, and the
pg-boss worker that was supposed to do it has no runner on Vercel (its schema is
absent from the production database entirely — evidence it never started there).

## Decision

**1. Synchronous batch import, not a worker.** `importLinkedSources` composes the
existing pieces and runs inside the request. pg-boss is left alone: adding a
worker means the VPS in PRD §10, which is an owner decision and a spend, whereas
this unblocks the one household that exists. When a worker arrives, it should
call this same function per source rather than duplicate it.

**2. Bounded per call, and the bound is reported.** At most 5 URLs
(`IMPORT_CAP`, clamped 1..5 — a `limit` above the cap clamps rather than
overreaches), and the response carries `remaining`, `nutritionConfigured`,
`llmFallbackConfigured` and `plannerReady`. The fetcher sleeps 1s between
requests and honours `crawl-delay`, so an unbounded loop would burn the function
wall clock and be impolite to the site. Callers press again.

**3. Already-imported URLs are skipped from the database, before any network
call.** Repeating the request is cheap, cannot duplicate a recipe, and a test
asserts the recipe pages are not re-fetched (only robots probes occur).

**4. `checkPublicUrl` is re-applied at fetch time, not trusted from link entry.**
The bulk route fetches URLs read out of the `source` table. Rows written before
that guard existed, or by any future path that inserts a URL directly, would
otherwise send the app to `169.254.169.254`, `10.0.0.5` or `localhost:5432` and
hand the response body to a household. Refusal is recorded per URL and a test
proves the injected fetch was **never called** for those links. This is the
second choke point, matching how ADR-015 already handles social hosts.

**5. Diet provenance is asserted, never inferred — and it is now per recipe.**
New column `recipe.diet_tags text[]` (migration 0007, additive with a default, so
existing rows are unaffected). At save time it is filled from what the source
declared about itself (`ParsedFields.category`, i.e. schema.org `recipeCategory`),
mapped through a small assertion table (`vegetarian`, `vegan`, `plant-based` →
vegan, `halal`, `kosher`, `pescatarian`). No meat/animal word list exists
anywhere. The pool changed from ADR-119's household-wide veto to a per-recipe
check: a member declaring a provenance diet keeps only recipes asserting that
diet; `gluten_free` and `dairy_free` need no assertion at all because they are
checkable as wheat/milk exclusions, so they moved to the allergen path.

Why this matters more than it looks: an inferred "vegetarian" from ingredient
names is exactly the hand-rolled detection that produced the ADR-120 vocabulary
bug, and a wrong "vegetarian" flag serves meat. Empty now means *unproven*, and
unproven means excluded for anyone who needs proof.

**6. Allergen attribution over-flags, deliberately.**
`allergensFromIngredientLine` matches ingredient text against a keyword→canonical
table (including transliterated Indian terms: `paneer`, `ghee`, `khoya`, `atta`,
`maida`, `sooji`, `semolina`, `til`, `toor`/`tnr` soy, `fish sauce`). An
over-flagged recipe costs one candidate; an under-flagged one can hospitalise a
child. Consequences of that choice are pinned in tests, including the ugly ones:
`coconut milk` → `milk` + `tree nuts`, and `butternut squash` → `milk` (because
it contains "butter"). `["nut", "tree nuts"]` is kept precisely so that
"peanut" also flags tree nuts. This is not subtlety for its own sake: the
alternative is under-flagging.

Tags are stored as **canonical enum values**, so the pool and the planner compare
without translation. Scout still emits its own vocabulary and is untouched;
adopting this function there is a deliberate follow-up (it changes scout's public
tag values and therefore its tests).

**7. Nutrition is never estimated.** With no `FDC_API_KEY`, enrichment reports
`{status:"skipped", reason:"no_fdc_key"}` and `plannerReady` is 0 — the recipe
stays excluded as `no_nutrients` rather than receiving an invented kcal figure
that would silently skew every calorie band. FDC failures are captured and
reported per recipe instead of swallowed.

**8. Enrichment is a separate step from import.** `importRecipeFromUrl` keeps its
existing contract and tests; `enrichRecipe(db, householdId, recipeId, {fdc})`
does the tag + nutrition work. Split so the importer stays testable without a
nutrition client, and so a future worker can enrich independently of fetching.

## Consequences

**Better**
- The pipeline can now reach a planable state: import → tags → diet assertion →
  nutrition → pool. Verified end to end in tests against real rows, including a
  case where the pool still refuses, and refuses *for the right per-recipe
  reason* (asserted recipe excluded only by `no_nutrients`; unasserted one by
  `diet_provenance_unavailable`).
- SSRF exposure reduced to a defence-in-depth second check at the only place that
  fetches on a household's behalf.
- Nothing new was invented where a tested component already existed; the diff is
  composition plus one column.

**Worse / accepted**
- Still no plan for the owner's household from this PR alone: production needs
  `FDC_API_KEY` present (it is) and the import to actually run against the four
  real sites, which this PR does not do — running it is an action on live data,
  not a code change.
- Real sites may return no JSON-LD, block robots, or be social hosts; each becomes
  a plain-language `skipped` reason, so a run can legitimately import zero
  recipes. That is the honest outcome, not a silent failure.
- Five URLs per call is small; a household with many links needs several presses.
  Correct for one household now, and a worker (with the VPS) is the eventual answer.
- Free-text `otherAllergens` remains substring-matched, which can over- or
  under-match ("nut" in "coconut"); acceptable because it is a member-specific
  value the enum cannot express, and over-matching only excludes.
- The over-flagging table is a second allergen keyword list in the codebase (the
  first being scout's). That is temporary and named: the follow-up is scout
  calling `allergensFromIngredientLine` and its tests moving to canonical values.

## Verification

tsc 0 · lint 0 errors / 63 warnings (baseline) · `next build` exit 0 with
`ƒ /api/sources/import` mounted · migration 0007 applied to the dev DB and the
`diet_tags ARRAY` column confirmed by reading `information_schema` (not trusting
the migrate summary) · targeted suites 112/112 across intake, vocabulary,
planning and recipes. Full suite and CI numbers are reported in the PR body.

Two bugs this ADR owes to testing rather than reasoning: my first intake test
asserted a `yogurt` line from a page that test never imports (a `find()` miss
reads as "tags are empty", which looked exactly like a code failure), and I left
out the per-test timeout that live-DB tests need here. Both were test bugs; the
reproduction against the dev DB showed the production code writing
`["milk"]`, `["sesame"]`, `[]` correctly before either was changed.
