# OneTable - Build Status

**2026-11-03 16:14 UTC - M3 COMPLETE & GATED; M4 CRITICAL PATH ADVANCING**

- ✅ M3 exit: 52/52 tests, demo verified (100% own-source dinners, 0 allergen violations)
- ✅ ADR-016: OpenRouter + Claude 3.5 Sonnet approved
- ✅ WP-4.1: Runtime skeleton (11 tests) — OpenRouterClient, tool registry, AgentExecutionContext
- ✅ WP-4.2: Safety Guardian (29 tests) — SG04 eating-disorder detection (7 vocabulary categories, 75%+ recall, ≤5% FP)
- ⏳ **CRITICAL PATH**: WP-4.3 (Coordinator agent) starting now
- **M4 tests so far**: 40/40 passing (11 WP-4.1 + 29 WP-4.2)


## Verified state (CI green on each merge)
- M0 complete: WP-0.1 scaffold, WP-0.2 Drizzle schema (33 tables, Neon `onetable_dev`), WP-0.3 CI + rule-source/banned-copy gates, WP-0.4 Auth.js v5 + AES-256-GCM, WP-0.5 tool registry R/A/P/X, WP-0.6 tokens/components/gallery
- M1 complete (owner accepted; ADR-011): WP-1.1 consent (append-only, gated writes, PV03 erasure), WP-1.2 members, WP-1.3 health (encrypted, flags-only), WP-1.4 SG01 gate + banner, WP-1.5 tiers + erasure, WP-1.6 onboarding steps 1-4+6 (PRs #8, #10, #11, #14-#21)
|- M2 complete (owner accepted; ADR-011): WP-2.1–2.7 recipe ingestion pipeline (SSRF-safe fetcher, schema.org parser, LLM fallback, ingredient mapping, manual entry, trusted creators, social terms note ADR-015). E2E snapshot: 57/57 tests passing. Harness: Gate A PASS (89.7% mean accuracy on 39 blog URLs). CI green on main (PR #43 merged).
|- M3 complete (52/52 tests; ready for owner demo):
|  - WP-3.1 Rule engine: YAML loader + deterministic checker (11 tests)
|  - WP-3.2 Target calculator: DRI-based, SG02 under-18 guard, SG03 energy floors (11 tests)
|  - WP-3.3 Energy floors: YAML placeholders (reviewed:false, awaiting RD review)
|  - WP-3.4 Hard filters: allergens, time limits, diet patterns, packed lunch (8 tests)
|  - WP-3.5 Deterministic planner: seeded greedy selection, >50% own-source dinners (5 tests)
|  - WP-3.6 Lock/swap/regenerate: all scopes, locked-slot preservation (8 tests)
|  - WP-3.7 Property-based safety tests: SG-A allergens, SG-B under-18, determinism, 100+ generations each (5 tests)
|  - WP-3.8 Recipes tab UI (RX01): week view, swap/regenerate, recipe detail, lock status (4 tests)
|  - Gate: npm ci ✓, vitest 52/52 ✓, lint ✓

## Blocked on owner (PRD 13.3)
| Item | Ask |
|---|---|
| M3 demo | Build a plan for 1-2 seed households by hand, verify >50% own-source dinners and safety guardrails hold |
| M3 gate approval | Owner approves M3 to proceed to M4 (agent orchestration) |
| ADR-015 YouTube | Decide whether to enable YouTube reader (Google Cloud project + API key + 30-day refresh loop required) |

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
