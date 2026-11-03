# OneTable - Build Status

Last updated: 2026-11-03 - `main` = dd9ba5d (WP-2.5, PR #42); WP-2.7 on branch `build/wp-2.7-creators` (PR pending)

## Verified state (CI green on each merge)
- M0 complete: WP-0.1 scaffold, WP-0.2 Drizzle schema (33 tables, Neon `onetable_dev`), WP-0.3 CI + rule-source/banned-copy gates, WP-0.4 Auth.js v5 + AES-256-GCM, WP-0.5 tool registry R/A/P/X, WP-0.6 tokens/components/gallery
- M1 complete (owner accepted; ADR-011): WP-1.1 consent (append-only, gated writes, PV03 erasure), WP-1.2 members, WP-1.3 health (encrypted, flags-only), WP-1.4 SG01 gate + banner, WP-1.5 tiers + erasure, WP-1.6 onboarding steps 1-4+6 (PRs #8, #10, #11, #14-#21)
- M2 nearly complete:
  - WP-2.1 intake: SSRF-safe fetcher, robots honored, 1 req/s, pg-boss background imports (PR #24)
  - WP-2.2 schema.org parser RE01 + entity/title fixes (PRs #25, #30, #31)
  - WP-2.3 LLM fallback RE02 (verbatim rule, ADR-012) + review UI + recipe box + detail (PRs #26-#29)
  - WP-2.4 ingredient parser + USDA FDC mapping RE03 + food_item seed (PRs #38, #39, #41; ADR-014)
  - WP-2.5 manual entry, PWA share target CP02, copyright rules (PR #42)
  - WP-2.6 harness: Gate A **PASS** - 89.7% per-field mean on 39 blog URLs (owner-approved measure, blog-11 excluded; spot-check clean, ADR-011). Final report `docs/harness/wp26-report.md`; markup-vs-LLM 38/0; blog-vs-social 40 importable / 10 save-and-route (ADR-015)
  - WP-2.7 trusted creators CP04 + onboarding step 5 + terms note ADR-015 - branch `build/wp-2.7-creators`: platform detection (`src/lib/sources/platform.ts`), never-fetch guard at both choke points (fetcher + queue + single-link import), `/api/sources` + `[id]/website`, sources service with §16.5 chips, step-5 screen (paste, cards, one-time plain note, add-website, skip), review reads sources back from the server, YouTube reader seam behind `YOUTUBE_READER_ENABLED` (fail-safe off). Local gate: npm ci; tsc 0; lint 0 err (6 known warnings); vitest 57/57 files, 474 tests; next build OK.
- Playwright e2e on CI: step-5 snapshot baseline must be regenerated on ubuntu (snapshot-baseline workflow dispatch) after the PR push, then committed.

## Blocked on owner (PRD 13.3)
| Item | Ask |
|---|---|
| ADR-015 | Approve or amend the social-platform terms note |
| YouTube reader | Decide whether to enable `YOUTUBE_READER_ENABLED`: needs a Google Cloud project + API key (new external account) **and** a <30-day refresh/re-validation loop for description-derived copies (ADR-015 YouTube section, III.E.4/III.E.8 retention risk) |
| Stray remote branches | Deletion needs owner OK (wp/0.1-scaffold, wp/1.2-member-crud, wp/1.4-condition-gate, wp-0.6-design-tokens) |
| Figma Dev Mode | WP-0.6 value check still needs owner access (ADR-003) |

## Follow-ups (not blocking)
- db/crypto.ts (WP-0.2 minimal helper) and lib/crypto/encryption.ts (canonical) still coexist; consolidate in the first M3 WP touching crypto.
- 6 unused-variable lint warnings remain in test helpers.
- WP-0.2 PRD §10.3 cross-check owed (t_04d2d776).
- Stashes: stash@{0} mixed-tree backup 2026-10-20, stash@{1} co-agent WP-0.4 WIP - drop once owner confirms.
- `docs/harness/url-set.json` and the owner's xlsx stay LOCAL (owner's saved links; harness scripts read them from disk).

## Environment facts
- Dev DB: Neon `onetable_dev`; `.env.local` holds DATABASE_URL, ENCRYPTION_KEY, AUTH_SECRET (gitignored, never in chat/commits/logs).
- GitHub `nikila-acharya/OneTable`; `nacharya0531` has write access (verified).
- Kanban board `onetable`: dispatcher OFF, tasks unassigned, completion requires --result evidence.
- ADR-001 dispatcher incident (Oct 16); ADR-002 co-agent handover (Oct 20); ADR-015 first social-terms note (Nov 2).
