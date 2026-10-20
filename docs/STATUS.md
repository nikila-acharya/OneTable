# OneTable — Build Status

Last updated: 2026-10-20 · Milestone: **M0 ~80% (auth outstanding) / M1 pending** · `main` = 766d54b (PR #3 spine, squash-merged after CI green)

## Verified state
- CI (GitHub Actions, all 6 jobs) green on PR #3; re-verifying on `main` push.
- Merged & CI-verified: scaffold (0.1) · CI + rule-source/banned-copy checkers (0.3) · Drizzle schema 33 tables + migrations on Neon `onetable_dev` + NF-7 seed + live-DB/crypto tests (0.2) · tool registry R/A/P/X + approvals/action-log + X-not-registered gate (0.5) · onboarding steps 1-4+6 UI - 30 tests incl PV01/SG01/SG02 behaviors + axe AA (1.6 draft) · tokens/controls subset (0.6 partial).
- 0.2/0.5 were authored by the handover session (ADR-002): CI-verified; PRD-10.3 line-by-line cross-check still owed (see Outstanding).
- Playwright e2e green on CI after Linux baseline refresh (dispatch `.github/workflows/snapshot-baseline.yml` whenever UI copy/layout changes).

## Outstanding
| WP | Task | Note |
|---|---|---|
| 0.4 Auth + AES-256-GCM | t_b97350d6 | IN PROGRESS - port `wp/0.4-auth`, mine ideas from stash@{0} (co-agent WIP: drizzle adapter deps) |
| 0.2 review | t_04d2d776 | Cross-check 33 tables vs PRD 10.3 exactly; confirm seed households |
| 0.6 | t_41af9511 | Full component set vs PRD 16.3 + design/prototype.html; token ADR |
| 1.1 Consent PV01 | t_ead0e1e4 | todo - port `wp/1.1-consent` |
| 1.2 Member CRUD | t_6e55ed11 | todo - port `wp/1.2-member-crud` |
| 1.3 Health enums/crypto | t_59eb60f2 | todo - port `wp/1.3-health` |
| 1.4 Condition gate SG01 | t_45112529 | todo - port `wp/1.4-condition-gate` |
| 1.5 Tiers + deletion | t_e8aabdb9 | todo - compare `wp/1.5-tier-deletion` vs `wp/1.5-tier-limits` |
| 1.6 Onboarding UI | t_6486cb4c | open - held by parents 1.4/1.5 |
| Infra | - | docker-compose Postgres option per PRD 10.1 (now: Neon dev + CI service) |

## Environment facts
- Dev DB: Neon (`onetable_dev`), `.env.local` = DATABASE_URL + ENCRYPTION_KEY + AUTH_SECRET (gitignored; never in chat/commits/logs - PRD 13.2).
- GitHub: `nikila-acharya/OneTable`; `nacharya0531` write access. 4 stray remote worker branches pending owner OK to delete (13.3).
- Kanban: board `onetable`, dispatcher OFF, tasks unassigned, `--result` evidence required.
- History: ADR-001 dispatcher incident (Oct 16) · ADR-002 co-agent handover (Oct 20, owner decision: Hermes sole builder).
- Build rules: branch per WP from `main`, PR, merge only on CI green + per-milestone owner OK (13.3); tests-first for PRD sections 6/7.

## Incident log (read before trusting branch history)
- 2026-10-16: gateway kanban dispatcher spawned runaway workers -> 15 parallel orphan branches, self-marked done (ADR-001; dispatch now OFF). Branches are source material only. `docs/PRD.md` v2.3 present on branches. Secret scan clean; no `.env` values ever committed.
- 2026-10-20: owner's second assistant session executed WP-0.2/WP-0.5 through this board and left WP-0.4 WIP (ADR-002). Work was CI-gated before merge; owner decision: Hermes sole builder from here.
