# ADR 114 — WP-1.4: SG01 condition gate contract

Date: 2026-10-16
Status: **Accepted (fail-safe)** — D2 awaits owner/RD confirmation (PRD 13.3: gate decision)
WP: 1.4 (`t_a0882f1c`), branch `wp/1.4-condition-gate`
Touches: PRD 5.2 (PR03, SG01), 6.3 (SG-C, SG-G, SG-H), 6.4, 7.3, 16.5

## Context

SG01 is a rules gate, not AI: members with listed conditions get
general-guidance mode, a persistent clinician banner, no LLM advice, and
celiac gets a hard gluten filter. WP-1.3 (running in parallel) owns the
encrypted `member_health` table and its enum validation; WP-1.4 owns the
gate semantics. Two conflicts had to be resolved before either branch could
merge cleanly.

## D1 — One canonical condition slug table; spelling `food_drug_interactions`

The authority is the PRD, not either branch. PRD 5.2 SG01 bullet 1 names the
condition "food-drug interactions" verbatim -> slug `food_drug_interactions`;
PR03 gives the display wording "takes medication with food interactions
(e.g. warfarin)" -> `CONDITION_LABELS` below. WP-1.4's earlier seed and
WP-1.3's current WIP (t_c70ea08c, 2026-10-16) both carried
`medication_food_interactions`, which matches no PRD text; WP-1.3's
CONDITION_LABELS wording ("Takes a medication that interacts with food")
also paraphrases PR03. Both WP-1.3 and WP-1.4 comment headers claimed the
*other* side had published their own spelling — a circular, unverifiable
attribution that ping-ponged the slug across the two crashed runs. Resolved
by deriving the slug from the PRD text, which both claims already pointed at
("food-drug interactions"). WP-1.3 stores the values, so its validation enum
MUST align to this table before merge; `tests/enum.test.ts` pins the full
list as the interop contract and a hotspot comment on t_c70ea08c records the
decision for the parallel WP-1.3 run. A duplicate `GENERAL_GUIDANCE_...`
membership constant in WP-1.3 must be deleted or re-derived from
`CONDITION_POLICIES` (see D2) so only one policy source merges.

Post-merge action (small follow-up, not part of this WP): shrink
`lib/conditions/enum.ts` to a re-export of `lib/health/enums.ts` plus the
WP-1.4-only `CONDITION_PHRASE_MAP` (Household Setup agent mapping aid), so
only one slug array exists in `main`.

## D2 — General-guidance membership: fail-safe superset, pending owner/RD call

PRD 5.2 SG01 bullet 1 names a safety-critical subset (diabetes any type,
CKD, heart failure, pregnancy, eating-disorder history, food-drug
interactions). Guardrail SG-C says "**Listed conditions** → general-guidance
mode with the clinician banner until a clinician target exists", which reads
over the whole PR03 list. The PRD is ambiguous for prediabetes,
hypertension, high cholesterol, breastfeeding, celiac (and WP-1.3's seed
constant took the literal subset; WP-1.4's policy table takes the superset).

**Decision shipped:** every listed condition except `other` gates into
general-guidance mode. Rationale: this is a safety feature; the asymmetric
risk of a missed banner/advice suppression is worse than an extra banner on
a member for whom no member-specific targets exist anywhere in the MVP (they
are a LATER `clinician_target` table), and the general-wellness language
rule (6.4) already forbids condition-management advice for everyone. The
`'Proposed'` confidence tags on hypertension/high-cholesterol rows mark the
RD-review items for Gate B.

**What the owner/RD can change in one line:** narrowing to the literal
subset = flip `generalGuidance: false` for the disputed rows in
`lib/conditions/policy.ts`; no other behavior changes. `other` remains
"not acted on" either way; unknown strings fail safe into the gate in both
readings. Flagged to WP-1.3 to delete or align `GENERAL_GUIDANCE_CONDITION_IDS`
(two contradictory membership sets must not merge).

## D3 — Copy: one constant, verbatim from the PRD

`CLINICIAN_BANNER_COPY` (`lib/conditions/copy.ts`) is the only home of
"General guidance only. Confirm with your clinician." — banner, gate result
and fixed confirm reply all import it; `tests/copy.test.ts` asserts the
exact string. The banned-copy list (6.4 + 7.3 diet-culture terms) ships as
`BANNED_COPY_TERMS` for WP-0.3's lint to import (CI wires it).

## D4 — Celiac hard filter is a flag, enforcement lives in the planner

The gate outputs `glutenHardFilter: boolean`; actual exclusion of gluten
ingredients runs in the M3 rule/planner engine (WP-3.4) treated exactly like
an allergen (PR02 semantics). No plan bypass: planning writes go through
`assertNoMemberNutrientTarget` (SG-H).

## D5 — rules/*.yaml deferred to M3 (WP-3.1), no invented citations

PRD 6.2 wants rules as versioned YAML with `source.name` + `source.url`.
The SG01 policy table ships in TS for M1 because the rule loader,
`plan_rule_check` records and RD-owned citations arrive in M3 (Gate B
`reviewed_by`). WP-0.3's CI allows an empty rule set until then. Moving
`CONDITION_POLICIES` into `rules/` with real citations (DGA, ACOG etc. —
RD-provided URLs) is an M3 task; no placeholder URLs are committed
(13.2: never invent clinical citations).

## D6 — Deterministic guard is a seed; semantic advice detection is M4

`lib/conditions/message-guard.ts` implements the deterministic 7.3 layer:
banned copy, under-18 sentence check, gated-member medical-marker check,
fixed clinician-confirm reply with verbatim-sourced tips, and the
regenerate-once-then-fallback decision. The Guardian LLM check (semantic
"does this constitute advice") is WP-4.2; it may only add blocks, never
remove one (7.3: neither can override a block from the other).

## Verification

`npm run typecheck` + `npm run test` (vitest) in-workspace green; see task
metadata for counts. Tests cover: SG01 AC (CKD → banner, no member target),
celiac → filter, other → not acted on, unknown → fail safe, enum interop pin
vs WP-1.3, verbatim copy, banned terms, under-18 sentences, 7.3 fallback
sequence, banner render.
