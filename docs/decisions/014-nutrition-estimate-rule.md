# ADR 014 - Nutrition estimate rule (RE03, WP-2.4 stage 2)

Date: 2026-10-23 - Status: accepted (owner approved, 2026-10-23)
Relates to: PRD 5.3 (RE03: "estimate incomplete" when unmatched ingredients exceed 20% by weight [Proposed])

## Decision
1. An ingredient line is **complete** when it is matched to a USDA food and has a gram weight.
2. A recipe's nutrients show as **estimate incomplete** when fewer than **80% of its lines are complete**.
3. Nutrients are rolled up per serving from complete lines only: per-100 g value x grams / 100, divided by servings.

## Why this differs from the PRD wording
The PRD rule is by weight. Volume lines ("1 cup soy milk", "2 tbsp olive oil") have no gram weight unless the line gives one, so a weight share cannot be computed for them. Counting by line keeps the rule measurable and conservative. If the owner wants the weight-based rule later, the roll-up's completeness figure can be switched without a schema change.

## Not done yet
- food_item seed (PRD WP-2.4).
- Volume-to-grams conversion (density table) would make more lines complete; not built.
