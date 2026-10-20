# ADR 003 - Final design token values and text-on-surface rules (WP-0.6)

Date: 2026-10-20 - Status: accepted (pending owner check against Figma Dev Mode, see Open)
Relates to: PRD 16.3 (tokens), 16.7 (AC: axe zero serious/critical), ADR 116 (onboarding AA deviations)

## Decision
Token values in src/app/styles/tokens.css are the source of truth. They are the PRD 16.3 values, with
the AA-darkening from ADR 116 kept, and one new change in this WP:

| Token | PRD 16.3 | Final | Why |
|---|---|---|---|
| --primary | #93B1C0 | #547b8f | white button text was 2.26:1 (ADR 116) |
| --primary-strong | #6F93A6 | #507081 | text on white/stone was below AA (ADR 116) |
| --ink-soft | #7B8287 | #666c70 | text on stone was 3.33:1 (ADR 116) |
| --ok | #5E9C7F | #46745f | text on stone was 2.74:1 (ADR 116) |
| --warn | #C98B4B | **#8e5d2b** | used as TEXT (clinician notes, onboarding .ot-clinician); was 2.89:1 on white, 2.46:1 on stone |
| --warn-soft | - | #c98b4b | NEW: the PRD original, decorative use only, never text |
| --sky, --sand, --stone, --peach, --ink, --line | as PRD | as PRD | already AA with ink |

## Contrast (computed; enforced by tests/unit/ui/tokens.test.ts)
Text rule: ink may sit on every surface. The accent text tokens (ink-soft, primary-strong, ok, warn)
only on bg, stone and canvas. On sky, sand and peach, text is --ink only.

| Text | On bg/white | On stone | On canvas | On sky/sand/peach |
|---|---|---|---|---|
| ink #3f4448 | 9.85 | 8.41 | 9.04 | 7.3-7.5 (allowed) |
| ink-soft #666c70 | 5.32 | 4.55 | - | not allowed |
| primary-strong #507081 | 5.28 | 4.51 | - | not allowed |
| ok #46745f | 5.35 | 4.57 | - | not allowed |
| warn #8e5d2b | 5.6 | 4.78 | - | not allowed |
White text on --primary: 4.56:1. --primary as a non-text UI colour vs white: 4.56:1 (>= 3:1).

## Components (WP-0.6)
Existing in controls.tsx: OtButton, OtChip, AllergyChip, OtToggle, OtField, OtSheet, ClinicianNote.
New in base.tsx: OtCard, OtStatusChip (glyph + text), OtSegmented (radiogroup, roving focus, arrow keys), OtMealBar (slot name always printed), OtTabBar (Plan/Recipes/Groceries/Household, aria-current).
Styles: src/app/styles/components.css. Gallery: /dev/components (404 in production).
Clinician note: .ot-note was previously unstyled on main; now --ink text on sand with a --warn accent border.

## Open
- Figma Dev Mode values were never checked: the owner has not shared Figma access. Values are the sampled PRD values plus the AA fixes above.
- The onboarding visual snapshots may change where the clinician note now renders styled. Regenerate with the snapshot-baseline workflow if CI reports it.
