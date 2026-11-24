# ADR 122 — step 6 runs the real planning pipeline; UI may not claim work it did not do

Date: 2026-11-23
Status: Implemented (PR pending owner merge)
Supersedes: the ON01 step-6 "progress stub" and "approval-card preview" shipped
  since M1 (they explicitly announced M3's arrival in their own footnote)
Touches: PRD §5.0 (review AC), §16.5 (prototype), §16.6 (reduced motion),
  §13.1 (test data), ADR-119 (`/api/plans/first`), ADR-121 (`/api/sources/import`)
Code: `src/app/onboarding/steps/review.tsx`, `src/app/onboarding/onboarding.css`,
  `src/app/onboarding/flow.test.tsx`, `src/app/onboarding/steps/review.plan.test.tsx`

## Context

`POST /api/plans/first` (#57) and source intake (#59) are live and tested, and
**still nothing reached a user**, because step 6 never called them. What it did
do, on click, was animate four fabricated lines and then render a card that
asserted, in the user's own browser:

```
Approval inbox · draft
Draft week · Mon, Nov 24
1 member · 4 meals · from the starter library
✓ Passed safety checks
[Approve] [Edit] [Decline]        (all disabled)
This is where the drafted week lands and goes to your approval inbox.
The planner arrives with milestone M3 (WP-3.1–3.6), so no real recipes are shown yet.
```

No request was made. The "✓ Passed safety checks" line is the worst of it: it is
a safety claim, rendered unconditionally, on a screen that had checked nothing.
The footnote was honest — it admitted the planner hadn't arrived — but that
honesty sat *below* a green checkmark and a fake meal count, which is exactly how
a reader stops reading. The milestone it referred to shipped months ago.

This is the same class of defect as everything else this week: code that presents
as capability. ADR-118 deleted the unrouted monitoring modules for it; ADR-119/121
built the real server paths for it; this is the last one, and it is in front of a
user.

## Decision

**1. The button runs the real pipeline, in order:**
`submitDraft()` (save) → `POST /api/sources/import` (only when the household
actually has linked sources, read back from `GET /api/sources`) →
`POST /api/plans/first`. Stages render from those awaits; there is no timer, no
`prefersReducedMotion()` animation path, and no line of copy that is not
produced by a response. `prefersReducedMotion` was deleted rather than left
unused, because its only purpose was faking synchronous resolution of the stub.

**2. Success renders the week the server returned.** A table grouped by date,
from `plan.meals`, with the real `slots` count and `created` state ("newly
drafted" vs "already drafted for this week"). A recipe planned on two days
appears on two days — asserted as such, since a `getByText` on a repeated name
would silently pass or fail on the wrong assumption.

**3. Failure renders the server's reason, verbatim, plus a next step keyed to its
error code.** `no_recipes`, `pool_blocked`, `planner_refused`, `no_members`,
`save_rejected`, `unauthenticated` each get one plain sentence. An unknown code
falls back to a generic line ("Nothing was changed…") rather than to a specific
promise we have not earned. The panel carries `role="alert"`, and the escape hatch
button is honestly labelled **"Finish without a plan ›"** — the previous card
offered "Finish setup ›" as if a week existed.

**4. The import summary is reported in the server's own numbers, including the
bad parts**: `1 of 3 links read · 1 already in your library · 1 skipped (the site
did not return this page) · 4 still waiting - press again for the rest`. Skipping
the word "skipped" or hiding `remaining` would turn an honest partial result into
an implied success. If `nutritionConfigured` is false the note says plainly that
new recipes cannot be planned yet.

**5. Resuming must not create a plan, and must not fake one either.** Previously
`draft.firstPlanRequestedAt` made the stub render its finished card on mount. Now
mounting makes **no POST at all**: the screen says a draft was already requested
and asks the user to press to fetch it. There is a test that asserts the fetch
spy recorded no `POST /api/plans/first` on mount — that test is the point of this
decision, and it replaced "resuming replays the plan stub in its finished state".

**6. Double-press is prevented by disabling the button while busy**, which is now
a real property (the work is awaited) rather than a cosmetic one; a test holds the
response gate and checks `disabled` flips.

**7. Styles had to be written, not just referenced.** The new markup used
`ot-week`, `ot-mealcell` and `ot-sr-only`, none of which existed — so the
screen-reader-only caption would have rendered as visible text and the table would
have taken browser defaults. Added to `onboarding.css` using only existing
tokens (`--line`, `--ink`, `--ink-soft`). A class that is styled nowhere is a bug
that only shows up in the browser, which is why this is called out: the component
tests could not have caught it.

## Tests

New `steps/review.plan.test.tsx` (9, renders `Review` directly so mount order is
controlled — a test that installs its fetch stub *after* mounting can never
exercise the import branch, because `sourceCards` is read in an effect):
full order incl. sources; no sources ⇒ no import call; 409 `no_recipes`; 501
`pool_blocked`; reused week; refused save ⇒ planner never asked; unexpected 500 ⇒
plain reason, never a fake week; button disabled in flight; and one that asserts
the **old stub copy is absent** ("Checking allergies against every recipe",
"Reading the starter library").

`flow.test.tsx`: two assertions groups were **replaced, not weakened** —
"✓ Passed safety checks" / "Approval inbox · draft" / "planner arrives with
milestone M3" / four animated lines → real request order and rendered week;
"replaying the plan stub in its finished state" → "does not fake a finished plan
or create one on mount". The describe/it titles that said "stub" were renamed,
because a passing test named after a removed stub misleads the next reader.
`mealCount` and its import were deleted with the copy that used them; lint
warnings returned to the 63 baseline.

## Consequences

- **A real success path now exists end to end in the product**: a person pressing
  one button gets a drafted week or a sentence explaining why not. Whether it
  succeeds for any given household still depends on `recipe` rows existing —
  which for production is still zero, so the first live press will legitimately
  show `no_recipes`. That is the correct outcome and now visibly explainable,
  rather than a fake green checkmark.
- **The §5.0 AC copy in the Sources section still promises "we'll plan from our
  recipe starter library"**, while no starter rows were ever seeded (ADR-121).
  Deliberately left untouched: that sentence is PRD-mandated AC text and the
  index test in `flow.test.tsx` pins it. The contradiction is real and belongs to
  the owner as a decision — seed the starter library, or change the AC — not to a
  UI PR as a quiet edit. The failure panel overrides it at the moment of action
  with the truth from the server.
- The week is read-only here. Approve/edit/decline still have no working target:
  the approval inbox API exists (#45) but the plan→approval handoff is unbuilt, so
  this screen no longer offers disabled buttons that imply it does.
- **Playwright step-6 baselines will change** (markup changed, by design). They
  must be regenerated on the CI Linux runner via `snapshot-baseline.yml`, never
  locally on Windows.
