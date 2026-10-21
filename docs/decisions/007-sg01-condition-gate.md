# ADR 007 - SG01 condition gate and clinician banner (WP-1.4)

Date: 2026-10-21 - Status: accepted; D2 (gate membership) needs owner/RD confirmation at Gate B
Relates to: PRD 5.2 (SG01, PR03), 6.3 (SG-C, SG-D), 6.4, 16.5; ADR-114 (orphan branch, adopted here)

## Decisions
1. **One policy table** (src/lib/conditions/policy.ts) with one row per PR03 condition. The gate, the summary and the target guard all read it.
2. **Fail-safe membership (D2):** every listed condition except `other` puts the member in general-guidance mode. PRD SG01 names a literal subset; SG-C says "listed conditions". A missed banner is worse than an extra one, and no member-specific target exists in the MVP anyway. Rows marked rdReview (prediabetes, hypertension, high cholesterol, breastfeeding) are for the RD. Narrowing a row is a one-line change. **Owner/RD must confirm this (Gate B).**
3. **Unrecognised values fail safe** into the gate and are reported (`unrecognized`).
4. **Celiac = hard gluten filter** (glutenHardFilter, SG01 bullet 3). Enforcement belongs to the planner (WP-3.4), like an allergen.
5. **No member-specific nutrient target** for a gated member: `assertMemberTargetAllowed` throws `MemberTargetBlockedError`. Every target calculator (WP-3.2) must call it.
6. **Copy:** CLINICIAN_BANNER_COPY is the only home of "General guidance only. Confirm with your clinician." The banner (ClinicianNote) and the fixed reply both import it. The PRD wording is pinned by a test.
7. **Vocabulary:** the slugs are main's PR03 names (from the onboarding UI, drift-tested), not the orphan's `food_drug_interactions`. The UI list is what users see, so it stays the reference.

## Deferred (not this WP)
- Message guard and banned-copy checks on agent output (PRD 7.3, Guardian, WP-4.2).
- HT01 tips appended to the fixed clinician reply (WP-6.4).
- Plan-view banners (WP-3.6). Profile and onboarding banners are in place.
