# ADR 006 - Health data and the member summary (WP-1.3, PR02 / PR03 / SG01 / NF-P1 / NF-P5)

Date: 2026-10-20 - Status: accepted. Owner DISAPPROVED the registry fix for ADR-006-G1 (2026-10-21); the gap is accepted as-is (see G1 decision)
Relates to: ADR-004 (consent gate), ADR-005 (members), PRD 5.2, 6.3 SG-C, 7.2, 9

## Decisions
1. **Enums match the onboarding UI exactly.** The allergen list (9 major allergens, canonical ids such as "peanuts", "tree nuts") and the PR03 condition list are identical to src/app/onboarding/store.ts. tests/health/enums.test.ts fails on drift. The seed was aligned: asthma is not a PR03 condition, so it is stored as 'other'.
2. **Health is one encrypted blob per member** (member_health, AES-256-GCM, WP-0.4 helper). Every write runs the consent gate in the same transaction, after the member check and before any read-modify-write. A refused write stores nothing (tested).
3. **Under-13: no weight, whatever the consent** (PV02). Height is allowed (optional, in the PV02 list). Under-18: weight is allowed with measurement consent, since growth tracking is planning data. The weight-loss framing ban is a copy rule (Guardian, WP-4.2), not this layer.
4. **SG01 general guidance** is derived: type 1/2 diabetes, CKD, heart failure, pregnancy, eating-disorder history and food-drug interactions give the general_guidance_mode and clinician banner flags. Celiac gives hard_filter:gluten. Hypertension and high cholesterol get general DGA guidance only (no gating), as the PRD states.
5. **get_member_summary (R) returns flags only** (NF-P5): under_18, allergy:<id>, allergy:other_listed, hard_filter:gluten, has_listed_condition, general_guidance_mode, clinician_confirm_banner. No heights, weights, condition names or severities. The test checks the serialised output.
6. **Member tools carry health fields**: create_or_update_member accepts them; the handler checks consent before any write, then writes the profile and the encrypted health blob.

## Gap for owner decision (ADR-006-G1)
The registry's validateInput (agent/tools/registry.ts) checks only top-level property types as a single type string, and it does not check item enums or union types. So at proposal time an off-list allergen ("peanut") or a typed height passes, and the approval is created. The domain validator refuses the bad value at apply, and nothing is written, but the household has approved a card that cannot apply. Two fixes are possible: (a) extend validateInput to check enum, items and type unions (a bug fix in shared tool-contract code; it touches the Section 7 tool layer, so it needs your sign-off), or (b) keep it as is and make the review card show the validated form. Recommendation: (a).
Also: heightCm/weightKg are typed as plain number in the tool schema because the registry checks one type string. Clearing a value through the tool is not possible yet; it is possible through the domain service.

## Not in this WP
- Uncertain allergen flags and confirmations (PR02, WP-3.x).
- The onboarding UI sex and activity values differ from the backend enums (UI: female/male/prefer-not, low-active/very-active; backend: male/female/other/unspecified, light/moderate/high/athlete). Mapping belongs to WP-1.6 and must be decided before onboarding writes to the backend.
- Consent-gated health writes from the onboarding UI (WP-1.6).

## G1 decision (owner, 2026-10-21): fix disapproved
The owner rejected extending `validateInput` in agent/tools/registry.ts. The shared tool-contract code stays unchanged. Consequences, accepted:
- Item enums and union types are enforced only on apply, by the domain validators. An off-list allergen or condition can be approved, then refused on apply with `tool_error`, and nothing is written (tested).
- The household can approve a card that cannot apply. This is a usability cost, not a safety one: no unvalidated health value is ever stored.
- Any future change to the registry needs a fresh owner decision.
