# rules/ — clinical rule set (TR-RULES, PRD 6.2)

This directory holds the versioned clinical rules as YAML data files, not
scattered through code. **At M0 the rule set is intentionally empty** — the
real rules arrive with M3 (WP-3.1 rule engine, WP-3.2 target calculator,
WP-3.3 energy floors) and need the owner's approval (and later the RD's
review, Gate B) before values change (PRD 13.3).

## Rule format (from PRD 6.2)

```yaml
id: SG02-no-deficit-under-18
description: No calorie deficit or weight-loss target for members under 18
applies_to: { age_lt: 18 }
type: hard            # hard = reject; soft = score penalty; banner = display only
check: target.energy_kcal >= eer_maintenance(member)
source:
  name: American Academy of Pediatrics, Clinical Practice Guideline for Obesity (2023)
  url: <citation url>
confidence: Likely
reviewed_by: null      # RD name once reviewed
reviewed_on: null
```

## CI gates that read this directory

- `scripts/ci/check-rule-sources.mjs` — **fails if any rule lacks
  `source.name` or `source.url`** (binding, PRD 6.2). Missing descriptive
  fields are warnings only. With zero rules present it passes; CI flips on
  `--fail-if-empty` when M3 ships real rules.
- The second binding CI requirement of PRD 6.2 — "any code path writes a
  `plan` row without a rule-engine pass record" — is a planner-engine-side
  check delivered with M3 (`plan_rule_check` records), not this file-lint.

## Who may change these files

Only the owner-approved flow (PRD 6.2): rule changes need the owner's
approval; the RD reviews quarterly. No agent tool can read rule files for
writing or change them (PRD 7.2 X-level).
