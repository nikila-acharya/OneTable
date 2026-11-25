# ADR 125 — curated FDC alias table weighs volume lines; intake proved live in production

Date: 2026-11-24
Status: Implemented (PR pending owner merge) — dietitian pass COMPLETE 2026-11-25 (migrations 0010 + 0011)
Supersedes: the "curated alias→FDC table … until then intake results will often be
  excluded no_nutrients" consequence left open by ADR-123
Touches: PRD §5.3 (RE03), ADR-119 (planner pools), ADR-121 (synchronous intake),
  ADR-123 (starter library as data migration), ADR-014 (estimate rule)
Code: `db/schema.ts` (`fdc_alias`), `drizzle/migrations/0009_common_martin_li.sql`,
  `scripts/fdc-alias-seed.json`, `scripts/build-fdc-aliases.ts`,
  `src/lib/nutrition/aliases.ts`, `src/lib/nutrition/store.ts`,
  `src/lib/nutrition/fdc.ts`, `src/lib/nutrition/ingredient-line.ts`,
  `tests/nutrition/fdc-alias.test.ts`, `tests/nutrition/store.test.ts`

## Context

Task 2 of the 2026-11-24 queue was live intake on the owner's four trusted sites.
It was executed against production over HTTP through a disposable
`hermes-verify-intake-*@onetable.test` household — deliberately **not** the owner's
household, so no unreviewed recipes entered their box, and not a forged session:
the same signup/credentials seam (PR #49) the first-plan verification used.

What production showed:

* The pipeline works: 8 candidate URLs → **7 imported** (6 schema.org markup, 1
  LLM fallback), 1 roundup page honestly skipped ("This page has no recipe we
  could read"), idempotent re-runs report `already_imported`.
* The nutrition gap is exactly as ADR-123 predicted: per recipe 16–44 lines,
  **24 of 44** (paneer tikka) to **24 of 24** (baingan masala) contributed nothing
  because `parseIngredientLine` refuses to invent weights for volume/count units.
* The unweighed histogram across the seven real recipes: 75 lines with no parsed
  unit at all (leading markdown bullets, "1 medium onion" descriptors, "2 cups of
  milk"), 37 tsp, 17 cup, 16 tbsp, 6 clove, 1 can.
* A second, previously undocumented cause: FDC renumbered nutrients for the
  Foundation set (energy 208 → 1008, Atwater 957). The runtime extracted only
  legacy numbers, so a *matched* Foundation food often carried **no kcal at all**.
  That is part of why paneer tikka — a recipe full of gram lines — still
  reported `mapped` with completeness 0.02.

## Decision

1. **`fdc_alias` table, shipped as migration 0009** (the ADR-123 mechanism):
   global rows (`food_key` primary, no `household_id` — PV03 never has to reach
   it), carrying a pinned FDC record, per-100g nutrients, `unit_grams`
   (canonical parser unit → grams per one unit), `source_note`, and
   `reviewed=false`.
2. **Every number comes from USDA, resolved live at build time.**
   `scripts/build-fdc-aliases.ts` reads a seed of *names only*
   (`scripts/fdc-alias-seed.json` — no nutrition values), searches FDC, demands
   the described record, then extracts nutrients and unit weights from the
   record's own `foodPortions` ("1 cup cooked rice = 158 g" is USDA #169708's
   portion entry, not our estimate). A food USDA gives no portion for keeps no
   unit weights — its volume lines stay `unweighed`, and a food FDC lacks (garam
   masala, kasuri methi, black salt) is absent from the seed entirely. The seed
   is curated from the production gap profile; the first pass ships
   `reviewed=false` **pending the dietitian pass** (WP-3.3 `reviewed:false`
   precedent). The planner does not consult `reviewed`; the dietitian review
   report does, and the flip happens by migration, in review order.
3. **Enrichment consults the alias table first** (`src/lib/nutrition/aliases.ts`
   via `mapRecipeNutrition`): a hit replaces the fuzzy match at confidence 0.95
   (the starter-library convention for pinned records) and skips the FDC call;
   grams come from `qty × unit_grams[unit]` only when the line has no grams of
   its own. Explicit grams always win; a miss falls through to the fuzzy path
   untouched. 610 curated keys now resolve without the network.
4. **The runtime extracts both nutrient id spaces** (`NUTRIENT_IDS` in
   `fdc.ts`, shared with the builder): fixes Foundation matches silently
   carrying no energy.
5. **Parser hygiene from the real-data profile**: leading bullet/dash stripping,
   numeric ranges read at the lower bound ("3-4 scallions" → 3), size
   descriptors becoming count units ("1 medium onion" → 1 piece / "onion"), and
   "cups of milk" no longer eating the food name. No semantic invention: these
   were always-parseable lines the current parser mangled.

## Consequences

**Better**

* Imported recipes can actually reach the pool: a cup/tbsp/count line for any
  curated food now contributes real USDA calories, and the fuzzy matcher can no
  longer override a curated record with "Tomato powder".
* Intake is proven end-to-end in production, including skip-reason honesty and
  import idempotency; the owner's household remains untouched.
* One alias table serves every household (global rows), so the dietitian pass is
  a data migration, not a code change.

**Accepted, knowingly**

* Seed curation is *my* pass, not a dietitian's: every row ships
  `reviewed=false`. **Owner gate:** the dietitian review must happen before the
  "nutrition reviewed" claim anywhere in the UI; nothing claims it today.
* The 75 "no unit" lines beyond the mangled ones (section headers like
  "For the Creamy Cilantro Sauce:" stored as ingredient rows, foods with
  unparseable structure) are a **known import-hygiene gap** recorded here, not
  fixed here: headers belong to the parser's fixtures, and the alias table must
  not be used to launder unparseable text into calories.
* Long-tail foods not in the seed still go `no_nutrients`/incomplete; the UI
  already says so plainly (ADR-121/123).
* `fdc_cache` rows written before this ADR may hold Foundation responses
  without extracted nutrients; enrichment re-runs (import is idempotent and
  re-enriches) rewrite `recipe_nutrients` with the alias path, so stale
  estimates converge on the next enrich, not silently persist.
* Two prior-session artifacts changed behaviour on purpose: the `store.test.ts`
  fixture now proves alias-preference + density + cache-fallback in one run, and
  the intake household `hermes-verify-intake-mwv6sct9` waits in production for
  the post-deploy before/after measurement, then deletion on the owner's word.

## Addendum — RD review sheet outcome (2026-11-25, migration 0010)

The review sheet (203 pinned records / 610 keys) was returned marked "ok",
initials "nk", dated 2026-11-25 on every row. Cross-checking the sheet against
the records before acting on it found four genuine mispins that the sweep had
missed — proof the machine-side check earns its keep even under a clean sheet:

* `wheat flour / atta / chapati flour / whole wheat flour` → **Crackers,
  whole-wheat** (a cracker record, with cracker cup weights, answering flour);
* `milk powder / dry milk / skimmed milk powder` → a **babyfood rice cereal**
  record (its description contains "dry, instant");
* `kiwi / kiwis` → **Kiwi-strawberry juice drink**;
* `khoya / mawa` → **1% fluid milk** (≈8× energy understatement against milk
  solids).

Migration `0010_rd_alias_fixes` repins the first three groups to
SR/Foundation records fetched live (flour 790085 — no USDA portions, so atta
cups honestly stay unweighed; all-purpose 168936 for the bare "wheat flour"
US-blog sense; dry milk 171272; kiwifruit 168153) and **removes** khoya/mawa,
since FDC has no milk-solids record. `scripts/fdc-alias-seed.json` and
`fdc-alias-pins.json` were updated to match, so a future full rebuild lands on
the same final state; 0009 itself was not rewritten (already applied
everywhere — patched forward instead, per the ADR-123 journal pitfall).

`reviewed` was NOT flipped by the first return of this sheet: every row still
said `false`, because the signature's provenance (owner self-review vs
dietitian) was unconfirmed. **Resolved 2026-11-25:** the owner confirmed "nk"
is the dietitian; migration `0011_rd_pass` flips all surviving 608 keys to
`reviewed=true`. The repinned records hold the same food identity the RD
signed for (flour→flour, milk powder→dry milk, kiwi→kiwifruit), so the flip
covers the repaired table honestly; nothing claimed "reviewed" before the
repairs existed. The PRD 13.3 dietitian gate is CLOSED.
