# ADR 013 - Recipe review for unsure fields (RE02, WP-2.3)

Date: 2026-10-22 - Status: accepted
Relates to: ADR-012 (parser), PRD 5.3 (private recipe box, planning pool), 7.4

## Decisions
1. **Stored on the recipe.** Migration 0005 adds recipe.unsure_fields (text array) and recipe.parse_confidence (jsonb). recipe.status already had needs_review / ready.
2. **Only ready recipes enter the planning pool** (inPlanningPool). A recipe with unsure fields stays out until every one is confirmed or edited.
3. **Confirm or edit.** "Looks right" clears one field. "Edit" replaces the title, ingredients or steps; an edited field counts as confirmed. Method steps the User edits are the User's own text, so the verbatim rule applies only to the parser.
4. **Private copy.** Saved recipes are household_private (PRD 5.3).
5. **Household scope on every query.** Another household gets not_found.

## Not done yet
- The "Add to my recipe box" button only shows a message; the box screen does not exist yet.
- Yield is not stored (the recipe table has an integer servings field; parsed yield text is kept in the parse only).
- No live browser test of the review page; the card and the service are tested.
