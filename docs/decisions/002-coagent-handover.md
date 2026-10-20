# ADR 002 — Co-agent handover (2026-10-20)

Date: 2026-10-20 · Status: accepted · Owner decision: chat 2026-10-20 ("Hermes takes over")

## Context
A second assistant session run by the owner used this repo and the `onetable` kanban board on 2026-10-20 (~12:45–13:00): built and committed WP-0.2 (Drizzle schema, 33 tables, migrations + live-DB tests) and WP-0.5 (tool registry R/A/P/X, approvals/action-log, X-not-registered test) onto `integrate`, marked those board tasks done with run evidence, pushed, and left WP-0.4 (auth) half-finished uncommitted. It also relied on `.env.local` (owner-provided Neon URL) — migrations were applied to the live Neon dev DB.

## Decision
1. Owner stopped the other session; Hermes is sole builder from here.
2. Their committed work was NOT trusted blindly: it shipped inside PR #3 and passed the independent CI gate (all 6 jobs, Postgres 16 service, 10 test files, 0 skipped) before squash-merge to `main` (766d54b). Schema-vs-PRD 10.3 cross-check still owed (added to WP-0.2 review comment).
3. Their uncommitted WP-0.4 WIP is preserved in `stash@{0}` ("co-agent WP-0.4 WIP") — cherry-pick ideas when porting wp/0.4-auth, do not drop.
4. Going forward: branches from `main` per WP, PRs gated on CI green (PRD 13.1/13.3). Board tasks require `--result` evidence; unassigned (no dispatcher).
