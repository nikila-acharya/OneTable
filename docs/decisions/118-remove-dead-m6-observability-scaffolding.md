# ADR 118 — delete the dead M6 observability scaffolding

Date: 2026-11-21
Status: Approved for review (owner chose "delete" from kill / fix / vendor)
Supersedes: the M6 milestone's implied "monitoring + alerting" deliverable, which
  was never actually required by the PRD
Touches: PRD NF-P2, 15 (success metrics), WP-7.4; PV03 (right to erasure);
  `docs/API-REFERENCE.md`; `.env.example`; `/api/monitoring/status`
Removes: `src/lib/analytics.ts` (327 lines), `src/lib/monitoring.ts` (319),
  `src/lib/audit.ts` (325) — 971 lines total

## Context

Item 5 of the open list was "route the observability modules so M6 monitoring
actually observes something". Before wiring anything up, I checked who calls it:

```
grep -rn "lib/monitoring" src   (excluding the module itself)  -> nothing
grep -rln "lib/analytics\"|lib/audit\"" src (excluding src/lib) -> nothing
grep -rln "monitoring" tests                                   -> nothing
```

Zero production importers, zero tests. So "unrouted" was the mild description of
what reading the modules then showed: **each one would mislead an operator if it
were routed.**

`src/lib/monitoring.ts`

- `getDashboard()` reads `this.errors` / `this.metrics` / `this.healthChecks` —
  plain in-memory state on the singleton `export const monitor = new Monitor()`.
  On Vercel a fresh instance therefore reports `errorRate: 0, uptime: 100`
  **regardless of real conditions**. An always-green dashboard is worse than no
  dashboard, because automation and humans both trust it.
- `errorRate` is `this.errors.length` — a count published under a rate's name.
- `uptime` is the percentage of *services this instance happens to have checked*,
  which is not uptime.
- `checkServiceHealth()` does `fetch("/api/health/" + service)` — a relative URL.
  Server runtimes have no base URL, so it throws and the check records
  `status: "down"` with a `TypeError`. Every service would report down.
- `sendToSentry()` posts to the literal placeholder `"https://sentry.io/api/..."`
  and never reads `SENTRY_DSN`. It cannot work; the `catch` logs and swallows.
- `alert()` is called **without `await`**, so the instance can be frozen once the
  response has been sent and the PagerDuty event never leaves.

`src/lib/analytics.ts`

- Contains **none** of the seven event names PRD §15 specifies
  (`plan_generated`, `plan_accepted`, `slot_outcome`, `approval_decided`,
  `agent_action_undone`, `instacart_link_created`, `week_active`) — verified by
  grep, 0 matches each. Its vocabulary is `AnalyticsEventType` plus
  `HealthMetrics` / `AgentMetrics`, so it does not implement the requirement it
  was nominally standing in for.
- `HealthMetrics` is keyed by `householdId` + ISO week and carries
  `mealCompletionRate`, `mealsSkipped`, `ownSourceDinners`, `avgEnergyPerMeal`,
  `allergensAvoided`; `getHealthOutcomes()` aggregates them. NF-P2 requires
  analytics to be "event-level only, with no health fields in events". Household-
  keyed rollups of meal completion and allergens avoided sit squarely against
  that, and would have needed a privacy review before ever shipping.
- `extends EventEmitter` on a module-level singleton — a design that assumes a
  long-lived process, which this deployment model does not provide.

`src/lib/audit.ts`

- `private entries: AuditEntry[] = []`, backing `getComplianceReport()`,
  `getEntityTrail()`, `getSuspiciousActivity()` and `exportLog("csv"|"json")`.
  The IP hashing was genuinely right, but the store is in-memory: lost on every
  cold start, invisible between instances, and — the part that matters —
  **outside the reach of PV03**. `eraseHousehold()` deletes rows; it cannot delete
  an aggregate held in a warm lambda's memory. So a household exercising its right
  to erasure would be told it was erased while per-instance copies of their
  activity trail survived.

And the PRD itself: grepping it for `audit`, `monitor`, `alert`, `Sentry`,
`Datadog`, `PagerDuty`, `observab` returns **zero matches**. No vendor
integration was ever a requirement; `PAGERDUTY_KEY` / `DATADOG_API_KEY` existed
only in `.env.example` because these modules read them.

One artefact made the misunderstanding concrete: `PROJECT-SUMMARY.md` (untracked,
so never CI-reviewed) is headed "# OneTable: Complete Delivery ✅", lists
`M6 | Analytics + Monitoring + CI/CD | ✅`, names all three files as delivered,
and claims "Performance monitoring (Datadog) ✅". Nothing in it was wired, tested
or reachable.

## Decision

**Delete all three modules.** Do not build observability now.

Specifically:

1. `src/lib/analytics.ts`, `src/lib/monitoring.ts`, `src/lib/audit.ts` removed.
   Deleting them removes no coverage — none existed.
2. `/api/monitoring/status` keeps reporting only what is knowable inside the
   request (database liveness and latency, instance scope, uptime of this
   process) and names its own gaps explicitly: `errorReporting`,
   `persistedMetrics`, `alerting`.
3. The `integrations` presence block is **removed from that response**, with it.
   Once the readers are gone, advertising `pagerduty: false` invites someone to
   configure keys expecting alerting to start. It would not.
4. `PAGERDUTY_KEY` / `DATADOG_API_KEY` / `SENTRY_DSN` are dropped from
   `.env.example` — they now have no reader at all.
5. Analytics is deferred to **WP-7.4**, where the PRD already puts it, to be built
   against the §15 event names, under NF-P2.
6. If the app acquires a second household with real traffic, the first
   observability work is: one persisted, household-scoped error/event store
   (storage-backed, so `eraseHousehold` reaches it), then one vendor SDK.
   Not three parallel in-memory reimplementations of each other.

## Consequences

Better:

- No code path can present in-memory zeros as a health signal.
- No household-keyed aggregate exists outside the erasure path, which makes the
  PV03 promise actually true rather than "true for the rows I thought to delete".
- 971 lines of unimportable code stop being candidates for accidental wiring by
  a later session that assumes scaffolding means functionality — the exact
  mistake `PROJECT-SUMMARY.md` had already recorded as fact.
- The status route's claims are now all verifiable, which is why its tests assert
  the *absence* of `integrations` rather than its values.

Worse, and accepted:

- **M6 "monitoring + alerting" is formally not done**, and is now recorded as
  not done rather than implied done by files sitting in `src/lib/`. Anyone
  reading the original milestone plan should read this ADR, not the file list.
- Operational visibility is limited to: structured, redacted per-request logs
  (`serverError()`, ADR-follows-#54), `/api/health`, and this guarded status
  route. There is no error aggregation, no metric history, no alerting, and nobody
  is paged when anything breaks. At one household that is affordable; it stops
  being affordable the moment there are other users, and that is the trigger to
  revisit.
- If a real outage happens before then, detection depends on the owner noticing —
  which is precisely the trade this ADR is recording.
