# OneTable - Build Status

Last updated: 2026-10-20 (night) - `main` = 7d5aa4c (PR #8 WP-1.1 squash-merged)

## Verified state (CI green on each merge)
- WP-0.1 scaffold, WP-0.3 CI + rule-source/banned-copy gates (PRs #3, #4)
- WP-0.2 Drizzle schema (33 tables) + migrations + NF-7 seed, live on Neon `onetable_dev`
- WP-0.4 Auth.js v5 magic-link + credentials, one User per household, scrypt passwords, AES-256-GCM helper (PR #5)
- WP-0.5 tool registry R/A/P/X + X-not-registered gate
- WP-1.6 onboarding steps 1-4+6 UI (30 tests, axe AA, visual snapshots)
- WP-1.1 consent (PV01/NF-P3): append-only log with trigger, gated writes, withdraw-deletes-in-request, PV03 erasure seam (PR #8)
- WP-0.6 design tokens + base components (card, status chip, segmented, meal bar, tab bar), token contrast enforced by test (ADR-003), /dev/components gallery (PR #6)
- Last verified: typecheck 0 errors; lint 0 errors (6 unused-var warnings in test helpers); vitest 15/15 files incl live DB; ci-scripts 16/16; next build OK; Playwright e2e green in CI.

## Outstanding
| WP | Task | Note |
|---|---|---|
| 0.6 | t_41af9511 | DONE (PR #6). Open: Figma Dev Mode value check, needs owner access (ADR-003) |
| 1.1 Consent PV01 | t_ead0e1e4 | port wp/1.1-consent onto main (consent-gated writes) |
| 1.2 Member CRUD | t_6e55ed11 | port wp/1.2-member-crud |
| 1.3 Health enums/crypto | t_59eb60f2 | port wp/1.3-health; consume lib/crypto/encryption.ts |
| 1.4 Condition gate SG01 | t_45112529 | port wp/1.4-condition-gate |
| 1.5 Tiers + deletion | t_e8aabdb9 | compare wp/1.5-tier-deletion vs wp/1.5-tier-limits |
| 1.6 Onboarding UI | t_6486cb4c | held by 1.4/1.5 |
| 0.2 review | t_04d2d776 | PRD 10.3 cross-check still owed (handover session built it) |

## Follow-ups (not blocking)
- db/crypto.ts (WP-0.2 minimal helper) and lib/crypto/encryption.ts (WP-0.4 canonical) coexist; consolidate in WP-1.3.
- 6 unused-variable lint warnings in ported test helpers; clean up in WP-0.6 pass.
- Stash: stash@{0} = my mixed-tree backup from 2026-10-20; stash@{1} = co-agent WP-0.4 WIP (superseded by PR #5). Drop both once the owner confirms.
- Stray remote branches (wp/0.1-scaffold, wp/1.2-member-crud, wp/1.4-condition-gate, wp-0.6-design-tokens): delete needs owner OK (13.3).

## Environment facts
- Dev DB: Neon `onetable_dev`; `.env.local` holds DATABASE_URL, ENCRYPTION_KEY, AUTH_SECRET (gitignored, never in chat/commits/logs).
- GitHub `nikila-acharya/OneTable`; `nacharya0531` has write access (verified).
- Kanban board `onetable`: dispatcher OFF, tasks unassigned, completion requires --result evidence.
- ADR-001 dispatcher incident (Oct 16); ADR-002 co-agent handover (Oct 20).
