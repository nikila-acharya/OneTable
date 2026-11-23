# ADR 120 — one canonical allergen vocabulary; recipe tags are translated, not compared verbatim

Date: 2026-11-23
Status: Implemented (PR pending owner merge)
Touches: PRD §6 (SG-A allergens never placed, SG01 celiac hard filter), WP-3.4
  (hard filters), WP-4.7 (scout tags), NF-P1 (health data), ADR-119 (planning pool)
Code: `src/lib/health/allergen-vocabulary.ts` (new),
  `src/lib/planning/pool.ts`, `src/lib/planning/firstPlan.ts`

## Context

While building the planning pool (ADR-119) I had to state, in code, when a
recipe is unsafe for a member. Writing that comparison surfaced two
independent vocabularies that had never been put next to each other:

| Side | Source | Values |
| --- | --- | --- |
| Member allergies | `src/lib/health/enums.ts` `ALLERGENS`, validated by the setup parser and onboarding | `milk`, `egg`, `fish`, `crustacean shellfish`, `tree nuts`, `peanuts`, `wheat`, `soy`, `sesame` |
| Recipe allergen tags | `ScoutAgent.extractAllergenTags` (`src/agent/scout.ts:224`) | `dairy`, `eggs`, `gluten`, `tree_nuts`, `shellfish`, `peanuts`, `soy`, `fish`, `sesame`, plus EU-only `mustard`, `sulfites`, `celery`, `lupin`, `molluscs` |

Comparing them verbatim — which is what my first pool implementation did — does
not fail loudly. It quietly matches nothing:

```
member "milk"                 vs recipe "dairy"     -> no match -> palak paneer planned
member "egg"                  vs recipe "eggs"     -> no match
member "wheat"                vs recipe "gluten"   -> no match -> barley, rye planned
member "tree nuts"            vs recipe "tree_nuts"-> no match (space vs underscore)
member "crustacean shellfish" vs recipe "shellfish"-> no match -> shrimp planned
```

Every one of those is an SG-A violation (allergens never placed), and four of
them are among the most common allergies. The reason the mismatch had never
caused a failure is that **nothing consumed recipe allergen tags before ADR-119
existed**: `recipe_ingredient.uncertain_allergen_tags` is read by the pool and
written by no code at all (grep confirms the only writer of that column is its
own schema definition). So the vocabulary divergence was latent, not absent.

Two adjacent gaps found while fixing it:

1. **Celiac was ignored entirely.** `GLUTEN_HARD_FILTER_CONDITION` exists in
   `src/lib/health/enums.ts` precisely because celiac behaves like an allergen,
   and the pool took `conditions` not at all. A celiac member would have been
   served `gluten`-tagged recipes regardless of the vocabulary fix.
2. **`otherAllergens` is free text by design** (PRD lets a user name anything —
   "okra", "figs"). No enum comparison can ever see it, so it needs a different
   rule, not a cast.

## Decision

**1. `src/lib/health/allergen-vocabulary.ts` is the single translation point.**
It maps any recognised spelling into the canonical `ALLERGENS` space and exposes
`toAllergen`, `toAllergens`, `conflicts`, `conditionAllergens`,
`householdAllergens`. Members' enum values pass through unchanged, so both sides
of every comparison are canonical.

**2. The direction is recipe-tags → enum, not enum → tags.** The enum is the
contract: it is what users declare, what onboarding validates, and what the
health blob stores. Scout's tag set is an implementation detail of one agent, and
widening the public contract to match it would be the wrong way round.

**3. Unmappable tags are dropped, never broadened.** `mustard`, `celery`,
`lupin`, `sulfites`, `molluscs` have no member-side counterpart, so they cannot
produce a conflict. Mapping them to something plausible (e.g. `molluscs` →
`crustacean shellfish`) would invent an exclusion the user never declared and
silently shrink the pool; guessing in the direction of *more* restriction sounds
safe but makes the planner unable to feed a household for reasons nobody can
read. Dropping is honest here, and it is the direction the tests pin.

**4. Celiac folds into the same exclusion path** via `conditionAllergens` →
`["wheat"]`, because SG01 defines it that way. Other conditions
(`type 2 diabetes`, `chronic kidney disease`, `pregnancy`, …) deliberately
produce **no** exclusions — they change advice mode through the consent/general-
guidance gate, not edibility. A test asserts that, because the easy mistake is
to over-exclude and starve the pool.

**5. `otherAllergens` is matched as a case-insensitive substring of the stored
ingredient lines** (`PoolMember.otherAllergens`, compared against
`recipe_ingredient.raw_text`). Substring rather than word-list inference: the
value came from the user in their own words, and it is compared against data the
same recipe page provided. It is deliberately *not* enum-matched.

**6. `PoolMember` grew `otherAllergens` and `conditions`.** The planner keeps
its own allergen check as defence in depth, and now receives canonical values on
both sides of it, so that check can actually fire.

## Consequences

- **Fixes five silent SG-A misses** and gives one place to add tags when the EU
  set ever becomes member-declarable (it would need an enum change first, which
  is an owner decision).
- **The real hazard is unchanged and still open:** nothing writes
  `uncertain_allergen_tags` yet. Until intake populates it, imported recipes
  carry *no* tags, which the pool reads as "allergen-free". This vocabulary makes
  the comparison correct; it does not make it complete. Populating tags (and
  nutrition, and diet provenance) is the intake package that follows, and SG-A
  cannot be considered satisfied before it lands. That is stated rather than
  implied because ADR-119's own pool exclusion depends on it.
- Scout's `extractAllergenTags` is left as-is: its tests assert its current
  snake-case output, and rewriting an agent's public tag vocabulary is a wider
  change than a safety fix should carry. A follow-up should make scout emit
  canonical values and delete the mapping's recipe-side half.
- Test additions: 15 pure vocabulary tests plus 3 live-DB pool tests covering the
  milk/dairy case, the celiac case, and the free-text `okra` case — each written
  as the pair that used to match nothing.
