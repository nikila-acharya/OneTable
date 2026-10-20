# ADR 005 - Member profiles (WP-1.2, PR01 / PV02)

Date: 2026-10-20 - Status: accepted; two gaps flagged below
Relates to: PRD 5.2 (PR01, PV02), 7.2 (create_or_update_member and set_attendance are P-level), 7.7 (approvals)

## Decisions
1. **Scope split.** WP-1.2 handles profile fields (name, birth month, sex, activity, diet, likes, dislikes), attendance, and the no-credentials rule. Health fields (allergies, conditions, height, weight) are refused with `health_fields_not_available` until WP-1.3, which adds the consent gate (WP-1.1 gate) and the encrypted health blob. The orphan's health code was not ported.
2. **Child flag is derived** from the birth month (`isChild` = age under 18, measured from the 1st of the birth month). It is recomputed on every write, so it does not drift. PV02 under-13 limits: the PR01-required fields (sex, activity) are collected for children, since planning needs them. Only the PV02 list is collected for children, and no health data is accepted yet.
3. **No credentials on members (PV02).** Three layers: no auth columns on `member`, JSON schema with additionalProperties false, and a validation refusal (`auth_fields_forbidden`).
4. **P-level flow reuses main's registry** (WP-0.5). Propose stores an approval and writes nothing (tested). Apply needs an approved record whose hash matches the replayed payload (tested: payload mismatch refused).
5. **Per-tool registration** (`register`) for the setup agent. `registerAgent` requires the whole roster, which includes tools from later WPs.
6. **Household isolation.** Every read and write takes the household id; another household's member is `not_found` (tested).
7. **Attendance** is upserted per (member, meal, weekday). Weekdays 0-6, duplicates in one request refused.

## Gaps (flagged, not closed)
- **Domain validation runs at apply time, not at proposal time.** The registry checks the JSON schema before creating an approval, but rules such as a future birth month run only in the handler. A proposal that passes the schema and fails the domain check is approved and then rejected (`tool_error`), and nothing is written. Fix: a `validate` hook on ToolImplementation, called at propose time. That is a registry change, so it needs owner sign-off (13.3 covers Section 7 tool contracts).
- **Under-13 weight/height refusal** (orphan notes, section 1) is not built, because it depends on the health fields in WP-1.3.
