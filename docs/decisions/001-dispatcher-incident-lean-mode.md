# ADR 001 — Kanban dispatcher incident and lean build mode

Date: 2026-10-16 · Status: accepted · Owner approval: chat 2026-10-16 ("1", "Continue")

## Context
Board `onetable` was created with M0/M1 tasks assigned to profile `default`. The in-gateway kanban dispatcher (`kanban.dispatch_in_gateway`, previously true) auto-claimed and spawned ~20 worker sessions that built 15 parallel orphan branches from the bare repo, self-marked tasks done, locked the board DB, and pushed 4 branches to `origin` using credentials cached on the machine.

## Decision
1. `kanban.dispatch_in_gateway=false` (config; loaded on the 2026-10-16 gateway restart). Do not re-enable while tasks on this board are assigned to a real profile.
2. Build mode: **lean** (PRD 13.5 merge order Frontend→Backend, Data→Backend; Safety & QA kept as a separate review pass, executed by me with tests as the gate, never by the code that wrote the feature). Full 6-profile fleet may be revisited before M4 if parallelism pays for tokens.
3. Orphan branches = untrusted source material. `integrate` branch (base: `wp/1.6-onboarding`, the only branch with passing 30/30 tests + clean typecheck/lint/build) is the spine. Each WP ported and re-verified before its task completes. Kanban tasks are status-only and require `--result` evidence.
4. Board workspaces kept for reference until porting finishes (`AppData/Local/hermes/kanban/boards/onetable/workspaces`).

## Follow-ups (owner)
- Confirm whether `origin` pushes using this machine's credentials are intended; review GitHub repo collaborator list; consider revoking unused cached credentials in Git Credential Manager.
- Delete stray remote branches: `wp-0.6-design-tokens`, `wp/0.1-scaffold`, `wp/1.2-member-crud`, `wp/1.4-condition-gate` (after port decisions).
