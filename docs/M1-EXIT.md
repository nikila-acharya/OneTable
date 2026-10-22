# M1 exit report: household setup and privacy

Date: 2026-10-21 - Branch: build/m1-exit - Milestone 1 (PRD Section 14, WP-1.1 to WP-1.6)

## Exit criteria (PRD)
1. **Both demo households can be created end-to-end.** Verified: `npm run db:seed` creates "Busy Parent Household" (3 members, one child aged 11, one aged 6) and "Fitness Couple Household" (2 members). tests/m1/demo-households.test.ts reads both back through the real services: members, consent, flags-only member summaries, household settings and the onboarding summary. 3/3 pass.
2. **Every consent, deletion and gate test passes.** Full suite: 35 files, 318 tests, all passing. Lint: 0 errors. Typecheck: clean.

## Demo data after the full run
- households: 2 (Busy Parent Household, Fitness Couple Household), tier household
- members: 3 and 2
- consent rows: 10

## Work this exit depended on
- WP-1.1 consent (append-only, PV01 gate, PV03 erasure seam)
- WP-1.2 member profiles and attendance
- WP-1.3 health enums, encrypted health, flags-only summary
- WP-1.4 condition gate and clinician banner (fail-safe policy, pending Gate B)
- WP-1.5 tier limits and complete household erasure
- WP-1.6 onboarding: sign-up, validated atomic write, household settings, Done screen reads the server

## Fixed while preparing this report
- tests/db.test.ts (PV03) erased the two demo households and left the dev database empty after every run. It now re-seeds in afterAll. The PV03 check itself is unchanged.
- tests/signup route test left a "Route test" household behind. It now erases what it creates.

## Not verified here
- The flow in a real browser against the live database. The UI tests stub the API; the end-to-end CI job does not cover sign-up to plan.
- The Gate B decision on the condition gate membership (ADR-007): the owner/RD still needs to confirm the fail-safe rule.
- Household settings bounds (ADR-010) are proposals.

## Open items carried forward
- PRD 10.3 should list household_settings (ADR-010).
- change_household_settings tool (agent team).
- Sign-up has no email verification or rate limiting (needed before beta).
- The Figma Dev Mode token check (ADR-003) still needs owner access.

## Owner decision (2026-10-21)
- **M1 accepted as exited.**
- **Gate A, interview part: PASS.** The owner's finding: most saved recipes live on blogs or on the user's social media profiles.
- **Gate A, parse-accuracy part: OPEN.** Needs the WP-2.6 harness on 50 real URLs (owner provides the list).

## Decision needed from the owner (answered)
Accept M1 as exited, and approve the demo, so Milestone 2 (content pool and extraction) can start. Milestone 2 has Gate A: parse accuracy of at least 85% on core fields, and the owner's interview finding that most saved recipes live on blogs.
