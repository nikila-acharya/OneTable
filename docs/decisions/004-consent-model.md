# ADR 004 - Consent model (WP-1.1, PV01 / NF-P3)

Date: 2026-10-20 - Status: accepted; deletion mapping flagged for owner review
Relates to: PRD 5.1 (PV01, PV03), 7.2 (consent is X-level for agents), 9 (NF-P3, NF-P8)

## Decisions
1. **One table.** `consent` (db/schema.ts, from WP-0.2) is the event log. No second consent table.
2. **Append-only (NF-P3).** Migration 0003 adds trigger `consent_append_only_guard`: UPDATE is always refused; DELETE is refused unless the transaction sets `onetable.allow_consent_delete = 'on'`. That setting is the PV03 erasure seam (src/lib/consent/erase.ts). Household deletion cascades into `consent`, so it must go through the seam.
3. **Removed `consent_household_type_version_key` (unique).** It blocked grant -> withdraw -> re-grant under the same policy version, which a log must allow.
4. **Effective state** = latest event by `at` (recorded with clock_timestamp()), granted only if the event is a grant under the current policy version. A policy bump yields `requires_reconsent`, and gated writes stop passing (PV01).
5. **Gate before write.** `guardProfileWrite` maps profile fields to data types (conditions->health_conditions, allergies/otherAllergens->allergies, heightCm/weightKg->body_measurements). A refused write stores nothing (tested). `assertAgentRunAllowed` gates agent LLM processing (NF-P8).
6. **Withdraw deletes in the same transaction** as the withdrawal event (src/lib/consent/deletions.ts). Health fields live in one encrypted blob per member, so withdrawal rewrites that blob with the field cleared; it does not drop the row.
7. **HTTP:** GET/POST /api/consent, behind requireUser (401 without a session). Bad data type is 400 and nothing is written.

## Deletion mapping (PRD left this open; owner to confirm)
| Withdrawn | Deleted |
|---|---|
| health_conditions | conditions in member_health blob |
| allergies | allergies and other allergens in the blob |
| body_measurements | heightCm and weightKg in the blob |
| activity_data | activity_checkin and activity_goal rows (EX01/EX02 data) |
| agent_processing | agent conversations, messages and memory_entry rows for the household (DECISION: confirm) |

## Test environment
Test files run one at a time (`fileParallelism: false`): DB-touching suites share one database, and parallel truncate/count assertions race.

## Open
- WP-1.5 must extend the erasure seam to every household-owned table (PV03).
- The owner should confirm the agent_processing deletion scope (conversations and memory).
- The consent copy and the grant UI belong to ON01 (WP-1.6) and the Household page.
