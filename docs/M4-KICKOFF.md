# M4 Kickoff: Agent Team (AG01–AG06, SG04)

## Overview
M4 introduces the household agent team — a multi-agent system that orchestrates planning, setup, recipe discovery, approval, memory, and autonomy. All agents work through typed tools built in M1–M3. The safety guardian is the critical path: it enforces SG04 (eating-disorder signals).

**Gate AG:** 100% safety evals pass, Guardian recall 100%, routing 95%+, 90%+ golden tasks pass, owner runs 1 full week via chat only.

---

## Build Order (WPs 4.1–4.11)

### **WP-4.1: Multi-agent runtime** (CRITICAL PATH)
Agent orchestration layer: LLMClient, roster file, tool registration, delegation, limits & budgets.

**Inputs:**
- M3 planner, rule engine, targets, filters all available as tools
- M2 fetcher and parser available as tools
- Owner will choose: LLM provider + model (pause here for decision)

**Outputs:**
- `src/agent/runtime.ts`: LLMClient (interface, provider adapter)
- `src/agent/roster.ts`: agent definitions (id, name, role, tools, memory, budget)
- `src/agent/delegate.ts`: tool-calling delegate pattern
- `src/agent/state.ts`: per-run execution state, parent/child tracking
- Tests: agent initialization, tool registration, permission level checks (SG04 guard layer exists but not enforced yet), budget tracking

**Acceptance Criteria:**
- Agents can be instantiated from roster with correct tools
- Tool calls are traced and budgeted
- Parent-child runs preserve context (coordinator spawns planners)
- Permission levels on tools are visible and enforced at tool registration time

---

### **WP-4.2: Safety Guardian (Agent G)** (CRITICAL PATH)
Deterministic safety checks + LLM checks. Every agent proposal goes through Guardian.

**Inputs:**
- M3 rule engine, SG02/SG03 guards
- M1 consent & condition gates (SG01)
- Eating-disorder vocabulary (SG04 new)

**Outputs:**
- `src/agent/guards/guardian.ts`: 
  - `deterministic_checks()`: rules, consent, condition
  - `guardian_check()`: call LLM to veto unsafe input/output
  - `guardian_decision` records (what Guardian saw, decided, why)
- `src/agent/guards/sg04-eater-disorder.ts`: signal patterns + supportive reply
- `evals/guardian-eval.md`: 100+ test cases (input, output, expected decision)
- Tests: all SG checks pass; Guardian recall on test cases

**Acceptance Criteria:**
- All M1–M3 safety gates (SG01, SG02, SG03) remain enforced in Guardian layer
- SG04 eating-disorder vocabulary check catches 100% of eval cases (no false negatives)
- Guardian has <5% false positive rate (no safe things blocked)
- Every Guardian decision is logged with reasoning

**Note on Provider/Model:**
- Guardian is LLM-based, so this WP is blocked until owner chooses the agent provider & model (Section 13.3 item, ask now)

---

### **WP-4.3: Coordinator (Agent 1)** (DEPENDS ON 4.1, 4.2)
Routes user requests to specialist agents, merges replies, streams to chat UI.

**Inputs:**
- M4.1 runtime + Guardian layer
- M4.2 safety checks
- Specialist agents (not yet built, but Coordinator knows their tool lists)

**Outputs:**
- `src/agent/coordinator.ts`: 
  - `route()`: parse user message, decide which agent(s) to call
  - `merge_responses()`: combine specialist replies into a single card
  - `stream_reply()`: send streamed text + rich cards to UI
- `src/app/chat/page.tsx`: chat UI (input, message list, card rendering, /command support)
- `evals/coordinator-eval.md`: 50+ routing test cases
- Tests: routing accuracy, merge logic, card formatting

**Acceptance Criteria:**
- Routes "plan next week" to Planner agent
- Routes "add salmon recipe" to Recipe Scout
- Routes "what do you know about my household?" to Weekly Reviewer
- Routes ambiguous requests to clarify (user chooses intent)
- Routing accuracy ≥95% on eval set

---

### **WP-4.4: Approval Inbox & Action Log** (DEPENDS ON 4.1, 4.3)
Agent proposes actions; user approves, skips or undoes.

**Inputs:**
- M4.3 Coordinator (produces proposals)
- M1 consent/approval flow

**Outputs:**
- `db/schema.ts`: 
  - `agent_action` table (id, user_id, proposal_text, tool_name, tool_args, created_at, approved_at, executed_at, status, undone_at, undo_reason)
  - `action_log` view
- `src/app/inbox/page.tsx`: approval UI with card preview
- `src/app/actions/log.tsx`: view-only action history with undo button
- `src/tools/approve.ts`: `approve_action(action_id)` tool for agents
- `src/tools/undo.ts`: `undo_action(action_id)` tool
- Tests: action creation, approval flow, undo logic

**Acceptance Criteria:**
- User sees pending agent proposals (plan draft, recipe import, etc.)
- Approval executes the tool call; rejection discards it
- Undo marks action as undone and reverts side effects (recipes added, plan updated)
- Action log shows all agent actions for 30 days
- Undo rate <10% on golden tasks

---

### **WP-4.5: Household Setup Agent (Agent 2)** (DEPENDS ON 4.1, 4.3, 4.4)
Conversational onboarding replaces ON01 form.

**Inputs:**
- M1 onboarding steps 1–4, 6 (forms exist)
- M4 approval inbox

**Outputs:**
- `src/agent/setup-agent.ts`: 
  - Guides user through member setup (name, age, sex, allergies, conditions, diet preferences)
  - Uses M1 condition gate (SG01) to put conditions into general-guidance mode
  - Shows review card after each step
  - Triggers approval flow for new members
- `src/tools/add_member.ts`: `add_member(name, age, sex, allergies, conditions, diet_pattern)` tool
- `evals/setup-agent-eval.md`: 20+ setup flows
- Tests: all ON01 requirements captured, SG01 gate enforced, review cards shown

**Acceptance Criteria:**
- User can set up a full household (2–4 members) via chat in under 3 minutes
- Allergies and conditions are captured and passed to rule engine
- Setup agent refuses to add a condition-aware member to a plan role (SG01 guard)
- Setup feels conversational, not a form

---

### **WP-4.6: Meal Planner Agent (Agent 4)** (DEPENDS ON 4.1, 4.3, 4.4, M3)
User says "plan next week with more vegetarian dinners" → Planner calls buildWeekPlan with preference weights.

**Inputs:**
- M3 buildWeekPlan tool
- M3 rule engine + targets + filters
- M4 approval inbox

**Outputs:**
- `src/agent/planner-agent.ts`: 
  - `interpret_preferences()`: parse "more X", "fewer Y", "no Z" → preference weights
  - `propose_plan()`: call buildWeekPlan with seed (deterministic, repeatable)
  - `check_plan()`: apply M3 rule engine verification
  - `format_plan_card()`: build approval card with daily summaries
- `src/tools/build_plan.ts`: wrapper around M3 buildWeekPlan with rule check
- `evals/planner-agent-eval.md`: 30+ preference requests
- Tests: preference interpretation, plan verification, card formatting

**Acceptance Criteria:**
- Planner correctly interprets "vegetarian dinners" → boost vegetarian recipes
- Plan is always ≥50% own-source dinners (PRD AC)
- Plan passes M3 rule engine (all SG-A/B/C checks)
- User approves plan → it's saved to DB and shown on the week grid
- Same preferences + same seed = identical plan (determinism)

---

### **WP-4.7: Recipe Scout (Agent 3)** (DEPENDS ON 4.1, 4.3, 4.4, M2)
User pastes a recipe URL → Scout fetches, parses, and proposes to add.

**Inputs:**
- M2 fetcher (SSRF-safe, robots honored)
- M2 schema.org parser + RE02 LLM fallback
- M4 approval inbox

**Outputs:**
- `src/agent/scout-agent.ts`: 
  - `fetch_and_parse()`: call M2 fetcher + parser
  - `propose_recipe()`: format as approval card
  - `check_sources()`: verify source is not blocked (SG02 no-scrape rule)
  - `add_recipe_to_household()`: save to household's recipe pool
- `evals/scout-agent-eval.md`: 40+ recipe URLs (blogs, food sites, PDFs)
- Tests: recipe fetch and parse, source guard, approval flow

**Acceptance Criteria:**
- User pastes URL → Scout fetches and parses within 10s
- Parsed recipe shows title, ingredients (with quantities), method, servings, time, nutrition
- Source attribution is always shown (M2 copyright rule)
- Scout refuses Instagram/TikTok/Facebook URLs (SG02 no-scrape)
- Approved recipes are added to household pool immediately

---

### **WP-4.8: Weekly Reviewer (Agent 7)** (DEPENDS ON 4.1, 4.3, 4.4, M3)
Tracks what was cooked, learns preferences, stores visible household memory.

**Inputs:**
- M6 check-off table (not yet built, but assume it logs meal outcomes)
- M3 rule engine
- M4 approval inbox

**Outputs:**
- `src/agent/reviewer-agent.ts`: 
  - `load_memory()`: fetch household memory from DB
  - `analyze_week()`: what was cooked, what was skipped, nutrition hit rate
  - `learn_preferences()`: update preference weights based on outcomes
  - `health_fact_rejection()`: filter out health claims before storing (SG04)
  - `format_memory_card()`: user-visible household memory
- `src/app/household/memory.tsx`: user-editable memory view
- `db/schema.ts`: `household_memory` table (facts, learned_prefs, confidence)
- `src/tools/update_memory.ts`: `update_memory(fact)` tool (Reviewer can update, not create new rules)
- `evals/reviewer-agent-eval.md`: 20+ memory scenarios + health-claim rejection cases
- Tests: memory load/save, preference learning, health-fact filter

**Acceptance Criteria:**
- Memory shows "Family prefers beef tacos on Fridays" (learned from outcomes)
- Health claims like "carrots lower blood sugar" are rejected and logged
- Memory is editable by user; edits are timestamped
- Preference weights from memory feed back into next week's Planner call

---

### **WP-4.9: Event Dispatcher & Weekly Cycle** (DEPENDS ON 4.1–4.8)
Scheduled task: every Thursday 9 AM, run Reviewer → Coordinator → Planner.

**Inputs:**
- M1 pg-boss job queue (already set up)
- All agents above

**Outputs:**
- `src/jobs/weekly-cycle.ts`: 
  - Thursday 9 AM trigger (pg-boss job)
  - Run Reviewer agent (memory update)
  - Route summary to Coordinator
  - Call Planner agent for next week
  - Create approval action in inbox
- Tests: job scheduling, agent sequencing, approval card creation

**Acceptance Criteria:**
- Scheduled plan draft appears in user's inbox every Thursday by 9:30 AM
- Plan is deterministic (same preferences, week → same plan)
- User can approve, edit, or skip (defer plan to Friday)

---

### **WP-4.10: Autonomy Settings & Agent Pause** (DEPENDS ON 4.1, 4.3, 4.4)
User controls whether agents run autonomously or wait for approval.

**Inputs:**
- M4 approval inbox
- M4 agent runtime

**Outputs:**
- `src/app/settings/autonomy.tsx`: toggles for each agent
- `db/schema.ts`: `household_autonomy` table (auto_plan, auto_recipe_add, auto_nudge, etc.)
- `src/agent/runtime.ts`: respect autonomy settings (skip approval if enabled)
- Tests: autonomy enforcement, pause/resume

**Acceptance Criteria:**
- User can turn on "auto-approve plans" (Planner proposals execute without inbox)
- User can turn off "Weekly planner" entirely
- Autonomy settings are per-household

---

### **WP-4.11: Team Eval Suite** (DEPENDS ON 4.1–4.10)
End-to-end safety and accuracy evals. Red-team prompt injection, safety jailbreaks.

**Inputs:**
- All agent evals from WPs 4.1–4.10
- M3 property-based safety tests (SG-A/B/C)
- Seed household data

**Outputs:**
- `evals/m4-suite.md`: master eval runner
  - Guardian evals (recall 100%, false positive <5%)
  - Coordinator evals (routing 95%+)
  - Planner evals (plan quality, >50% own-source)
  - Scout evals (parse accuracy 95%+)
  - Reviewer evals (memory accuracy, health-fact rejection)
  - Red-team evals (jailbreak attempts, agent prompt injection)
  - Golden task flows (setup → plan → approve → cook → next week)
- `scripts/eval-runner.ts`: CI runner
- Tests: all evals in `evals/` pass before merge

**Acceptance Criteria:**
- 100% of safety evals pass
- Guardian recall on SG04 = 100% (no eating-disorder signals missed)
- Routing accuracy ≥95%
- ≥90% of golden tasks pass (multi-step household flows)
- Red-team evals: no successful jailbreaks
- Eval report shows: metric → pass/fail, eval count, false pos/neg, latency

---

## Dependencies & Parallel Work

**Critical Path:**
1. WP-4.1 (runtime) → WP-4.2 (Guardian) → WP-4.3 (Coordinator) → others
2. Choose LLM provider/model before WP-4.2 starts (blocking item for owner)

**Parallel (after 4.1–4.3 done):**
- WP-4.4 (approval inbox), WP-4.5 (setup), WP-4.6 (planner), WP-4.7 (scout), WP-4.8 (reviewer) can run in parallel
- WP-4.9 (dispatcher) needs all agents
- WP-4.10 (autonomy) can run anytime after 4.1–4.3
- WP-4.11 (eval suite) runs last (after all agents)

**Estimated effort:**
- WP-4.1–4.3: 3–4 days (blocking on LLM choice)
- WP-4.4–4.10: 2–3 days parallel
- WP-4.11: 2 days
- **Total M4: ~9–10 days** (assuming no eval failures or red-team jailbreaks)

---

## M4 Gate (Owner Decision)
Before M5 starts, owner must approve:
1. ✅ 100% of safety evals pass
2. ✅ Guardian recall on SG04 = 100%
3. ✅ Routing accuracy ≥95%
4. ✅ ≥90% of golden tasks pass
5. ✅ Owner runs one full week (Thu→Wed) via chat only: setup → plan approval → cook → next week draft
6. ✅ LLM cost per household per week is acceptable

---

## Questions for Owner (Blocking WP-4.2+)

**Q1: LLM provider & model for agents?**
- Options:
  - OpenRouter + Claude 3.5 Sonnet (recommended for M4: best reasoning, moderate cost)
  - OpenRouter + GPT-4o (higher cost, similar reasoning)
  - OpenRouter + Qwen (cheapest, still capable)
  - Other (your preference)?
- Impact: affects Guardian performance, eval suite results, operational cost
- Decision needed before WP-4.2

---

## Next Steps
1. Owner chooses LLM provider + model (needed for WP-4.2)
2. Start WP-4.1 (runtime layer)
3. Build critical path: 4.1 → 4.2 (Guardian) → 4.3 (Coordinator)
4. Parallel: 4.4–4.10
5. Final: 4.11 (eval suite + red-team)
6. Owner runs golden task (household setup → plan → week)
7. Gate AG decision

Ready to proceed once you pick the LLM model.
