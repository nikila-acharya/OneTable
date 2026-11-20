# OneTable API Reference

Documents the routes that exist in `src/app/**/route.ts`. Anything not listed here
is not implemented — including `/api/analytics/*` and `/api/audit/*`, which were
described in an earlier draft of this file but never built. `src/lib/analytics.ts`,
`src/lib/audit.ts` and `src/lib/monitoring.ts` are **library modules only**; no
route exposes them yet.

## Authentication

Every route below except `GET /api/health` calls `requireUser()`
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

## GET /api/health

Unauthenticated liveness check. Runs `select 1` against Neon.

```json
{ "status": "ok", "db": "ok", "latencyMs": 43 }
```

Returns **503** `{ "status": "degraded", "db": "unreachable" }` when the database
cannot be reached. The driver error is intentionally not echoed — it can contain
the connection host and user.

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
