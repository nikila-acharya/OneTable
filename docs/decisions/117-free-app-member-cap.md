# ADR 117 — AC01: the app is free; household member cap raised to 10

Date: 2026-11-20
Status: Approved (owner decision, stated directly)
Supersedes: PRD 5.1 AC01 freemium split (Free = 1 member / Household up to 8)
Touches: PRD 3 (target user), 4 (AC01), 5.1, 10.4; WP-1.5 (tier limits); ON01 step 6
Code: `src/lib/tier/limits.ts`, `src/lib/onboarding/complete.ts`, `src/app/onboarding/onboarding.tsx`

## Context

Production onboarding dead-ended at step 6. A real household of four members
completed steps 1-5, pressed "Plan our first week", and got an amber line:

> Some details need a fix before we can save: this plan includes 1 members

Three separate faults sat behind that one screen.

1. **The cap.** `MEMBER_LIMIT` was `{ free: 1, household: 8 }` per AC01. The
   household was on `free`, so a 4-member draft was rejected by
   `completeOnboarding` → 422 → the wizard refuses to save.
2. **The message.** `complete.ts` interpolated the **cap**, not the count:
   `` `this plan includes ${limit} members` ``. So it reported "1" while the
   plan contained 4 — the one number that explained the rejection was the wrong
   number, and it was mis-pluralised ("1 members").
3. **No way out.** The message told users to upgrade (`TierLimitError`'s text
   ended "upgrade to add more"), but billing is M7 and unbuilt — and M7 is
   explicitly gated on owner approval (PRD 13.3). PRD 3 defines the target user
   as "one adult who shops and cooks for **3 to 6 people**", so the product's
   own stated user cannot finish onboarding under the old cap.

The wizard has no tier awareness at all (`tier`, `upgrade`, `MEMBER_LIMIT`
appear nowhere under `src/app/onboarding`), and member profiles are held in
`localStorage` until step 6 posts. So the app invites you to add every family
member, never objects, and then rejects the entire draft at the last step.

## Decision

**The app is free.** AC01's freemium split is retired and the member cap is
raised to **10 on every tier**.

- `MEMBER_LIMIT = { free: 10, household: 10 }`.
- A refusal states the household's member **count** and the cap, and never
  points at an upgrade: `this plan includes 11 members, but a household can
  have at most 10`, and `TierLimitError` → `a household can have at most 10
  members`.
- The `tier` column, its DB enum, `MEMBER_LIMIT`'s per-tier shape and the
  `household_plan` billing stub are all **kept**. They are read by
  `tier/service.ts`, the summary API, migrations and tests; deleting the
  concept is a refactor with no user-facing benefit today. Equal caps make the
  flag inert, which is honest: it currently grants nothing.
- `TierLimitError.code` stays `upgrade_required` — it is a stable API
  identifier, not user-facing prose.

## Consequences

**Positive**
- Households up to 10 — comfortably beyond the 3-6 person target user — finish
  onboarding. The four-member household in this report now saves.
- The remaining rejection case explains itself, so a user over the cap knows
  what to change instead of seeing a number that isn't theirs.
- No paywall can strand a user at the final step again, because there is no
  paid capability to strand them in front of.

**Negative / accepted**
- AC01 no longer differentiates tiers, so the "paid household plan" revenue
  path in PRD 4 is gone until a new ADR redefines what a paid tier buys
  (condition modes, Instacart handoff and scheduled agent runs are listed in
  the old text and are the obvious candidates).
- Reviving a paid tier later will need a decision about the 10-member free cap;
  raising the paid cap above the free one is the kind of change that has just
  cost a live onboarding failure, so it should come with the PRD row updated in
  the same PR.
- Members beyond the cap are still only discovered when step 6 posts. With a
  10-member ceiling this is unlikely to bite, and adding a client-side guard in
  the wizard is deferred rather than removed.

**Tests**
- `tests/tier/tier-and-erasure.test.ts`: three AC01 tests rewritten to the new
  cap (free holds 10, 11th refused; household identical; message asserts the cap
  and must NOT contain "upgrade"), plus the billing-stub test retained as
  tier-flip-only.
- `tests/onboarding/complete.test.ts`: "cannot save two members" replaced by
  "can save a full family of 10" and "11th refused, message reports the COUNT
  not the cap".
