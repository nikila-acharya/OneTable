# OneTable API Reference

Documents the routes that exist in `src/app/**/route.ts`. Anything not listed here
is not implemented — including `/api/analytics/*` and `/api/audit/*`, which were
described in an earlier draft of this file but never built.

The library modules behind those names (`src/lib/analytics.ts`,
`src/lib/audit.ts`, `src/lib/monitoring.ts`) were **deleted** rather than left as
unrouted scaffolding — see `docs/decisions/118-remove-dead-m6-observability-scaffolding.md`.
Real analytics belongs to WP-7.4 against the PRD §15 event names, and must be
storage-backed so PV03 erasure reaches it.

## Authentication

Every route below except `GET /api/health` and `GET /api/monitoring/status`
calls `requireUser()`
(`src/lib/auth`), which resolves the session cookie to an `AuthContext`:

```ts
{ userId: string; email: string; householdId: string }
```

The household is taken from the session and **never** from the request body or
query string. That is what keeps one household from reading another's rows: every
query in `src/lib/agents/persistence.ts` puts `householdId` in the `WHERE` clause.

Error responses use this shape (matching the existing M2 routes):

```json
{ "error": "unauthenticated" }
```

| Status | Meaning |
|--------|---------|
| 400 | `invalid_json`, `message_required`, `decision_required` |
| 401 | `unauthenticated` |
| 404 | `not_found` (unknown id, or id is not a UUID) |
| 409 | `already_decided`, `not_reversible` |
| 410 | `undo_window_closed` |
| 500 | `server_error` |

---

## POST /api/plans/first

Drafts the household's plan for the week containing today and persists it.
Session required; **no request body at all** — household, members, health and
candidate recipes are derived server-side, so a caller cannot name a household.

Idempotent per week: a second press returns the existing plan with
`created: false` and HTTP 200, not a second week.

```json
{
  "created": true,
  "planId": "6f0a…",
  "weekStart": "2026-11-16",
  "seed": 1830049772,
  "slots": 21,
  "status": "draft",
  "meals": [{ "date": "2026-11-16", "mealType": "breakfast", "recipeId": "…", "recipeName": "…" }]
}
```

| Case | Status | `error` |
| --- | --- | --- |
| Created | **201** | — |
| This week already planned (nothing written) | **200** | — |
| No session | **401** | `unauthenticated` |
| Household has no members | **409** | `no_members` |
| Nothing edible: no recipes, or every candidate excluded by an unconfirmed allergen, or no nutrition rollup | **409** | `no_recipes` |
| Pool too small or too uniform for a meal band | **409** | `planner_refused` |
| Household declares vegetarian / vegan / pescatarian / halal / kosher | **501** | `pool_blocked` |
| Unexpected | **500** | `server_error` |

The 501 is a deliberate capability gap, not a bug: stored recipes carry no diet
provenance (`recipe` has no diet tags), and guessing suitability from ingredient
strings is the hand-rolled word list the safety rules forbid. Refusing is the
safe answer until intake records tags. See `docs/decisions/119-planner-uses-declared-recipe-pools.md`.

`seed` is derived from `household id + week`, so a retry reproduces the same
week; `plan_slot.shared_recipe_id` always references a real `recipe` row owned by
the household or from the shared starter library.

---

## GET /api/health

Unauthenticated liveness check. Runs `select 1` against Neon.

```json
{ "status": "ok", "db": "ok", "latencyMs": 43 }
```

Returns **503** `{ "status": "degraded", "db": "unreachable" }` when the database
cannot be reached. The driver error is intentionally not echoed — it can contain
the connection host and user.

---

## GET /api/monitoring/status

Operational status for the operator, not for a household. Guarded by a shared
secret instead of a session, so it works when no user is signed in:

```
x-monitoring-token: <MONITORING_TOKEN>
```

The comparison is exact and constant-time (SHA-256 of both sides, then
`timingSafeEqual`), so a prefix of the token does not authenticate.

| Case | Status | Body |
| --- | --- | --- |
| `MONITORING_TOKEN` unset in the environment | **501** | `{ "error": "monitoring_not_configured" }` |
| Header missing or wrong | **401** | `{ "error": "unauthorized" }` |
| Database reachable | **200** | `status: "ok"` |
| Database unreachable | **503** | `status: "degraded"` |

```json
{
  "status": "ok",
  "generatedAt": "2026-11-20T18:04:12.921Z",
  "scope": "instance",
  "scopeNote": "Serverless: figures describe this instance since its last cold start, not the deployment.",
  "uptimeSec": 41,
  "checks": { "database": { "status": "ok", "latencyMs": 14 } },
  "errorReporting": "not_implemented",
  "persistedMetrics": false,
  "alerting": "not_implemented"
}
```

Read the three flags at the bottom as the honest state of observability, not as
future work that is already done:

- **`errorReporting: "not_implemented"`** — errors are logged per request (see
  `serverError()` in `src/lib/api/errors.ts`) but nothing is collected anywhere.
- **`persistedMetrics: false`** — nothing is stored across requests, so there is
  no series and no history.
- **`alerting: "not_implemented"`** — nothing notifies anyone. There is
  deliberately no vendor-key presence block: the code that would have used
  `PAGERDUTY_KEY` / `DATADOG_API_KEY` / `SENTRY_DSN` was removed in ADR-118, so
  setting them does nothing.

No household, member, user or health field appears in this response, and the
token itself is never echoed. See
`src/app/api/monitoring/status/route.ts` for why this reports only facts
knowable inside one request.

---

## POST /api/agents/chat

One household message to the Coordinator. Persists the run, both messages, and
any proposal the Coordinator raised.

**Request**

```json
{ "message": "Plan meals for next week" }
```

**Response 200**

```json
{
  "runId": "0f1c…uuid",
  "message": "I've drafted a week of meals…",
  "cards": [{ "type": "plan_diff", "title": "…", "content": {} }],
  "approvalId": "9a2b…uuid",
  "delegationsSummary": { "agentsInvolved": ["planner"], "tasksCompleted": 1, "tasksSkipped": 0 },
  "budgetStatus": { "toolCallsRemaining": 24, "delegationsRemaining": 3 }
}
```

`approvalId` is the `approval` row's UUID and is what the decision route expects.
It is `null` when the turn raised nothing to approve. The card's own in-memory
`id` (`approval-<timestamp>`) is **not** a valid identifier for that route.

**Errors:** 400 `message_required` when `message` is empty or not a string.

**Note for tests and CI:** this route constructs a real `LLMClient`, which calls
the configured provider over the network. It needs `AGENT_LLM_API_KEY` (and honours
`AGENT_LLM_PROVIDER` / `AGENT_LLM_MODEL`). Do not add CI assertions that depend on
provider output.

---

## GET /api/approvals

The household's approval inbox, newest first.

**Query:** `?status=pending|approved|declined|expired` (an unknown value is
ignored, not an error).

**Response 200**

```json
{
  "approvals": [
    {
      "id": "9a2b…uuid",
      "tool": "propose:planner+grocery",
      "status": "pending",
      "summary": "Plan and grocery list (from planner, grocery)",
      "proposal": { "summary": "…", "diff": {}, "expiresAt": "…" },
      "createdAt": "2026-11-10T20:12:04.119Z",
      "decidedAt": null
    }
  ]
}
```

`tool` names what the decision authorises. Because the Coordinator merges every
specialist's proposal into one card (hub-and-spoke), it can list several roles.

---

## POST /api/approvals/[id]

Records a decision on one proposal.

**Request**

```json
{ "decision": "approve" }
```

`decision` must be `"approve"` or `"decline"`.

**Response 200:** `{ "id": "9a2b…uuid", "status": "approved" }`

**Errors:** 404 unknown/not-UUID id · 409 `already_decided` when the row is not
`pending`.

**This route does not execute the approved tool.** It only records the decision.
Applying an approved proposal is the agent's job and is what produces an undoable
A-level action; keeping execution out of this endpoint means a replayed request
cannot cause a second side effect.

**Not implemented:** edited proposals. The UI's "Edit" affordance has no backing
endpoint yet.

---

## GET /api/actions

The household's audit trail, newest first — the data source for the action-log UI.

**Query**

| Param | Effect |
|-------|--------|
| `level=R\|A\|P\|X` | filter by permission level (anything else ignored) |
| `reversibleOnly=true` | only actions that can still be undone |
| `since=YYYY-MM-DD` | ISO timestamp lower bound; unparseable values ignored |

**Response 200**

```json
{
  "actions": [
    {
      "id": "3c7d…uuid",
      "runId": "0f1c…uuid",
      "agent": "planner",
      "tool": "plan.write",
      "level": "A",
      "inputsSummary": { "summary": "…", "tokensUsed": 1810 },
      "resultSummary": { "summary": "…" },
      "reversible": true,
      "undoneAt": null,
      "createdAt": "2026-11-10T20:12:09.880Z"
    }
  ]
}
```

`reversible` is `true` only when `level === "A"`, an `undo_payload` exists, and
the row has not already been undone. Rows are scoped to the household through the
join to `agent_run` — `agent_action` has no `household_id` column of its own.

---

## POST /api/actions/[id]/undo

Reverts one applied action (AG05). No request body.

**Response 200:** `{ "id": "3c7d…uuid", "undoneAt": "2026-11-10T21:00:00.000Z" }`

**Errors**

| Status | Code | Cause |
|-------|------|-------|
| 404 | `not_found` | id unknown to this household |
| 409 | `not_reversible` | not A-level, or no undo payload stored |
| 409 | `not_reversible` | already undone |
| 410 | `undo_window_closed` | older than 7 days |

**Limitation, stated plainly:** this marks the row undone and records `undone_at`.
It does not yet replay `undo_payload` to restore the previous state — the payload
currently stores a reference, so the actual data reversal is still to be wired to
the tools that wrote it.

---

## GET /api/insights

Member list with activity check-in history — the dashboard's data source.

**Response 200**

```json
{
  "members": [
    {
      "memberId": "b41a…uuid",
      "name": "Ada",
      "birthYm": "1998-04",
      "checkins": [{ "weekStart": "2026-11-02", "status": "done", "note": null }]
    }
  ]
}
```

Health values are **absent by design** (NF-P6): raw measurements never enter a
reporting path, and they are encrypted at rest anyway (NF-P1). `birthYm` is a
year-month, never an exact date of birth (PR01).

---

## Frontend hooks

`src/hooks/useAppState.tsx` wraps the routes above through one `AppProvider`
context + reducer.

| Hook | Calls |
|------|-------|
| `useChat()` | `POST /api/agents/chat` |
| `useApprovals()` | `POST /api/approvals/{id}` with `decision` |
| `useActions()` | `POST /api/actions/{id}/undo` |
| `useInsights()` | `GET /api/insights` |

The hooks send no `householdId`/`userId` — the session supplies them.
`GET /api/approvals` and `GET /api/actions` are not yet called by any hook, so
the inbox and action log do not populate on page load; they update from the
current session's actions only.

---

## Deploy

```bash
npm run dev          # local, http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
npm run test:e2e     # playwright
npm run db:migrate   # drizzle migrations against DATABASE_URL
npm run build        # next build
```

Pipeline: `ci.yml` gates every push/PR (lint, typecheck, unit, e2e, build);
`deploy.yml` runs migrations then `vercel deploy --prod` on `main`/`staging` and
smoke-checks `/api/health` plus the mounted agent routes.

Required secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
`DATABASE_URL_STAGING`, `DATABASE_URL_PRODUCTION`.
