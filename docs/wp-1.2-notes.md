# WP-1.2 notes — member profile CRUD, attendance, child constraints (PR01, PV02)

Status: implementation notes for owner + Safety & QA review. These are the judgment
calls the data layer made where the PRD leaves room; if any is rejected, change the
marked location and its test — nothing else in the slice depends on it.

## 1. Under-13 collection limits (PV02) — interpretation

PRD PV02: "Members under 13 collect only what planning needs (age, allergies,
likes/dislikes, optional height) [Proposed, COPPA-minded]."

Literal reading would reject several PR01 *required* fields (sex, activity level)
for under-13s, which contradicts PR01 ("Required: Yes … needed for DRIs"). The
implementation therefore treats the PV02 list as the *collectible* set for planning,
not a hard allowlist, and fences off what COPPA-minded collection actually means:

- **Hard data-layer refusal: `weightKg` for under-13s** (`validation.ts`,
  `UNDER13_BLOCKED_KEYS`). Body measurements of young children are the field the
  privacy posture targets; the PRD explicitly makes height *optional* and never
  mentions weight for children. Refusal is unconditional — measurement consent does
  **not** unlock it (test: `pv02-child.test.ts`).
- Kept for under-13s, because the planner consumes them and they are not identity,
  contact or body data: name, birth month, sex, activity level, diet pattern,
  allergies (PR02 — a safety function), conditions (PR03 — required for the SG01
  gate), likes/dislikes, optional height.
- Boundary is **derived age** (`age.ts`): measured from the first of the birth
  month, so a child born 2013-11 turns 13 on 2026-11-01 and the same write that was
  refused the day before is accepted after — no stored age field drifts.

If the owner wants a stricter allowlist (reject conditions/sex/activity for <13),
say so and the change is confined to `UNDER13_BLOCKED_KEYS` + one test.

## 2. Under-18s and weight (PR01 vs 16.5)

- PR01: weight is "never shown or asked for under-18s **in any weight-loss
  context**". The data layer therefore *allows* `weightKg` for ages 13–17 when
  measurement consent exists (growth tracking is legitimate planning data); the
  weight-loss framing ban is a copy/message-guard rule (PRD 7.3 check 2), owned by
  the Guardian + copy work, not by the member write path.
- PRD 16.5 replaces the under-18 weight **field** in the member sheet with "We plan
  for growth, never for weight loss" — that is WP-1.6's UI obligation. Flagging it
  here so onboarding does not miss it.
- Under-18s additionally get zero credential surface via PV02 no-auth (below).

## 3. "No auth fields on member" (PV02 AC) — how it is enforced

Three layers, so the AC can't regress:

1. **Schema** (`db/schema/002_members.sql`): the `member` table has no email, phone,
   password or provider column. `MemberRecord` has no such property.
2. **Input surface**: `create_or_update_member` uses a closed JSON schema
   (`additionalProperties: false`) and a key-name deny-list (`AUTH_FIELD_NAMES`,
   e.g. email/phone/ssn/deviceId/geolocation) that rejects auth-ish keys even if a
   future caller bypasses schema validation → `auth_fields_forbidden`.
3. **Test**: `pv02-child.test.ts` asserts the stored record itself contains no
   auth-like key.

## 4. P-level two-phase semantics (PRD 7.2, 7.7) — the shape WP-0.5/WP-4.x must adopt

`create_or_update_member` and `set_attendance` run propose → approve → apply:

- Phase 1 (no `ctx.approvalId`): validate, consent-check, store an `approval` record
  `{tool, proposalJson, proposalHash, status:'pending', expiresAt}` and return
  `{status:'pending_approval', approvalId, reviewCard}`. **Nothing else is written.**
  (AC PR01: an agent-drafted profile is not saved until the review card is confirmed.)
- Phase 2 (same call + `approvalId`): the approval must exist, match this household,
  match this tool, be `pending`, be unexpired (7 days default), and its stored hash
  must equal the hash of the *replayed* normalized input. Only then does the write
  run; the approval is marked `approved`. Tampered replays, foreign-household ids,
  expired and double-applied ids are all refused and tested
  (`approval-plevel.test.ts`).
- Review cards shown to the agent context carry field **names** ("Sets allergies
  (value shown to you only)"), never health values (NF-P5/NF-P6). The full values
  live in `proposalJson` for the User's own inbox card.
- Action log records every phase with name-only summaries (NF-P6)
  (`action-log.test.ts`).

## 5. Seams this WP owns vs consumes

| Seam | File | Owner | Default when unwired |
|---|---|---|---|
| Consent check (PV01) | `lib/members/consent.ts` `ConsentGate` | WP-1.1 | `denyAllConsent` — fails **closed**: health writes return `consent_required`, store nothing |
| Encrypted health storage (NF-P1) | `lib/members/health.ts` `HealthWriter` | WP-1.3 | in-memory writer (tests/dev only) |
| Approval table + inbox | `lib/members/approvals.ts` `ApprovalStore` | WP-0.5 | in-memory store |
| `agent_action` log | `lib/members/action-log.ts` `ActionLog` | WP-0.5 | no-op |
| Tier limits (AC01: Free = 1 member) | `lib/members/service.ts` `MemberPolicy` | WP-1.5 | allow all; server-side check point is `canAddMember` at apply time |
| Allergen/condition enums (PR02/PR03) | — | WP-1.3 | WP-1.2 passes string arrays through untouched so the two WPs don't ship competing enums |

Deleting a member is `delete_member` at **X** level: never registered for agents
(`toolsForAgent` filter + a server-side refusal if a forged call arrives anyway),
UI-only (PV03 flow owns household-wide deletion in WP-1.5).

## 6. Migration contract

`db/schema/002_members.sql` merges into the WP-0.2 stream once the ORM is chosen
(checks mirror the validation rules: name ≤ 40 chars, `birth_ym` pattern, sex /
activity / diet enums, packed⇒lunch). Household scoping is enforced in the
repository port (`store.ts`) — every read/write takes `householdId` so a foreign
member id resolves to `not_found`, never an existence oracle.
