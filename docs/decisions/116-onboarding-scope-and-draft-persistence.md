# ADR 116 — WP-1.6: ON01 onboarding flow (steps 1–4 and 6) — scope and draft persistence

Date: 2026-10-16
Status: Proposed
WP: 1.6 (`t_21286159`), branch `wp/1.6-onboarding`
Touches: PRD 5.0 (ON01), 5.2 (PR01/PR02/PR03), PV01 (inline consent), SG01, 16 (TR-UI), 12 (M1)

## Context

WP-1.6 builds the first-run flow — Welcome & privacy promise, Your
household, Family members, Meals to plan, Review & first plan — to the
design in `design/prototype.html` (WP-0.6). Steps 1–4 and 6 are in this WP;
step 5 (sources) is WP-2.7 (M2) and the real first plan is M3.

## D1 — Step 5 is a stepper mark, not a screen

The prototype shows step 5 as a stub screen with a "Skip for now" button.
Production M1 omits the stub screen entirely:

- The stepper keeps the Sources dot, marked "soon" (`Arrives in M2
  (WP-2.7)`), not clickable — the user always sees the full 6-step shape of
  ON01 (§16.4 IA).
- Meals → Continue goes directly to Review; Review → Back goes to Meals.
- Review's Sources section states the fallback the §5.0 AC requires: "None
  yet — we'll plan from our recipe starter library…" so onboarding can
  finish with only required fields plus zero sources and still produce a
  plan.
- The first plan stub therefore always reads "Using 0 sources · reading the
  starter library".

WP-2.7 replaces this dot's behavior with the real sources screen; no stored
shape changes (sources live outside the onboarding draft).

## D2 — Draft persistence: localStorage now, server tool later

The §5.0 AC is "closing the browser at any step and returning resumes at
that step with the data saved". WP-1.1 (consent storage) and WP-1.2
(member CRUD as tools) are parallel/pending, so there is no server endpoint
to write to yet. The flow persists the whole draft in `localStorage` under
`onetable:onboarding:v1` behind one narrow API (`store.ts`: `loadDraft /
saveDraft / clearDraft` + pure rules helpers). Every mutation writes
through immediately. At merge time WP-1.2's tools own durable storage;
repointing the UI means replacing `load/save` calls only — screens and
rules helpers are storage-agnostic. The consent grants recorded here
(`grantConsent` with timestamp + policy version) are a local model of PV01
rules; WP-1.1 remains the source of truth.

## D3 — Allergy "Never planned" chips

§5.0 AC says review chips must "match the stored allergies exactly".
Review renders chips from `allStoredAllergies(draft)` — the same array that
is saved — deduped by allergen name in member order, with the member list
as the owner note. Chip copy follows the prototype: `🔒 {allergen} · Never
planned` (text carries the meaning, color is decoration only — §16.6).

## D4 — Small deviations from the prototype (documented)

- **Attendance defaults:** prototype new members are home for all four
  meals; the store kept `newMember().homeFor` all-true to match (§5.0
  step-4 seeding "from step 3's attendance").
- **Packed lunch granularity:** the prototype toggles packed on/off;
  `MemberMeals.packedLunch` stores `"school" | "work"` for WP-1.2's
  benefit. The M1 UI toggle sets `"school"` when on (keeps an existing
  value), `""` when off; a school/work picker is a Household-tab refinement
  (PR01).
- **Sub-sheet Cancel:** in the prototype, Cancel inside a member-sheet
  sub-picker closes the entire sheet (losing typed data). Here Cancel
  returns to the member form; data only discards on the form's own Cancel.
  Layout, copy and field order otherwise match the prototype screen-for-
  screen.
- **Budget feel:** field exists in the draft type but the control is
  disabled with the prototype copy ("(optional — coming later)") — §5.0
  step 2 marks it optional/later; not built (13.2 "Build LATER features").
- **First-plan progress:** the 550 ms line-by-line animation honors
  `prefers-reduced-motion` (§16.6) and, like the prototype, replays
  instantly-complete when a draft with a requested plan is resumed.

## Consequences

- §16.7's Playwright visual snapshots at 390/1280 px and the axe-core sweep
  are NOT covered here: vitest + testing-library pin structure/copy/ACs
  (including an axe smoke pass on every screen), while browser-visual
  snapshots are tracked as a follow-up card for the reviewer profile.
- `store.ts` is the single place rules (required fields, consent scrub,
  child weight, age derivation, step gating) are encoded; WP-1.2/1.3
  server tools should import or mirror it, and WP-1.1's consent table wins
  for durable consent.
