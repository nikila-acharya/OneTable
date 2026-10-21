# ADR 010 - Household cooking preferences (WP-1.6, slice 4)

Date: 2026-10-21 - Status: accepted; bounds are [Proposed] for owner confirmation
Relates to: PRD 5.0 step 2, 10.3 (household columns), 7.x (change_household_settings), ADR-008, ADR-009

## Decisions
1. **Separate table `household_settings`** (one row per household, household_id primary key, cascade delete). PRD 10.3 lists the `household` columns as id, tier, timezone, agent_paused, created_at; the cooking preferences go in their own table so those columns stay as specified. Absent row = PRD defaults (10 min breakfast, 30 min dinner). The PRD should be updated to list this table (owner decision).
2. **Bounds [Proposed]:** weekday breakfast 5-60 minutes; weeknight dinner 10-120 minutes; up to 20 cuisines, each 1-30 characters, deduplicated after trimming; budget feel one of keep-it-cheap / balanced / no-stress or unanswered.
3. **Validate before write, everywhere.** The same validator runs in onboarding's first phase (so a bad step-2 answer refuses the whole draft, nothing written) and in saveHouseholdSettings.
4. **Budget feel is optional** (PRD: "optional, later"); "" and null both mean unanswered.

## Not done here
- No change_household_settings P-level tool yet (WP-2.x / the agent team). The service is ready for it.
- Cuisine values are free text, not checked against the onboarding list, so the list can grow without a schema change.
