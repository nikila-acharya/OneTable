# OneTable — Build Status

Last updated: 2026-10-16 (evening) · Milestone: **M0 in progress / M1 partially proven** · Branch: `integrate`

## Current verified state (evidence: commands run locally, 2026-10-16)
- `npm ci` → OK · `tsc --noEmit` clean · `eslint .` clean · `vitest` **30/30 pass** · `next build` OK
- Verified scope (base `wp/1.6-onboarding`): repo scaffold (WP-0.1), onboarding steps 1–4+6 UI (WP-1.6 draft), vendored tokens/controls subset, axe AA smoke tests, PV01/SG01/SG02 UI behaviors, ADR 116.
- Playwright e2e: specs + committed snapshots exist; browsers not installed locally yet → not yet run.

## The dispatcher incident (2026-10-16) — read before trusting branch history
Auto-dispatched kanban workers (gateway `kanban.dispatch_in_gateway`, now OFF via config; see ADR 001) built ~15 *parallel* orphan branches from the bare README, self-marking tasks done. Nothing was merged to `main`. `docs/PRD.md` v2.3 was added to branches (source doc copied from `C:\Hermes Projects`). Secret scan: no `.env` values committed on any branch. 4 branches reached `origin` (push credentials on this machine — owner to confirm intended; see ADR 001 follow-ups).

**Policy:** every orphan branch is *source material*, not done work. Each WP below is ported onto `integrate` and re-verified by tests before its kanban task may be completed.

## Kanban (board `onetable`, tasks status-only — no dispatcher)
| WP | Task | Status |
|---|---|---|
| 0.1 Repo scaffold | t_23f59f98 | **done** (verified) |
| 0.2 DB/Drizzle/migrations/seed | t_04d2d776 | **done** — schema 33/33 = PRD 10.3; migrated live on Neon `onetable_dev`; seed NF-7 OK; 9 live-DB tests + 5 crypto pass |
| 0.3 CI | t_89208e5b | todo — port `wp/0.3-ci`; needs push access |
| 0.4 Auth + encryption | t_b97350d6 | todo — port `wp/0.4-auth` |
| 0.5 Tool registry R/A/P/X | t_7e6a13e2 | **done** — agent/ + tools ported; schema 0001 adds proposal_hash + agent_run.created_at (live on Neon); 50/50 tests incl X-not-registered gate |
| 0.6 Tokens + components | t_41af9511 | todo — partial vendored copy in base; verify vs PRD 16.3 + prototype.html |
| 1.1 Consent PV01 | t_ead0e1e4 | todo — port `wp/1.1-consent` |
| 1.2 Member CRUD | t_6e55ed11 | todo — port `wp/1.2-member-crud` |
| 1.3 Health enums/crypto | t_59eb60f2 | todo — port `wp/1.3-health` |
| 1.4 Condition gate SG01 | t_45112529 | todo — port `wp/1.4-condition-gate` |
| 1.5 Tiers + deletion | t_e8aabdb9 | todo — two orphan branches to compare (`wp/1.5-tier-deletion`, `wp/1.5-tier-limits`) |
| 1.6 Onboarding UI | t_6486cb4c | open — draft verified, held by parents 1.4/1.5 |

## Blocked on owner (13.3)
1. ~~Neon~~ DONE. Dev DB `onetable_dev` created inside Neon project; ENCRYPTION_KEY (dev) generated locally.
2. ~~GitHub write access~~ GRANTED (push verified pending first push below).
3. Remote branch cleanup on `origin` (4 stray worker branches) once access is settled.

## Standing decisions
- Lean build team (owner skipped Q2 → recommendation adopted): Lead = me, verified per-WP; Safety & QA gate applied by me as independent review pass over PRD §6/§7 paths; full profile fleet deferred.
- Milestone-to-milestone with exit demos (owner choice).
- Merging to `main` only with CI green (13.3) — CI itself is WP-0.3.
