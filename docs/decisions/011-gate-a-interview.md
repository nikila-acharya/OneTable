# ADR 011 - Gate A interview finding (M2 entry)

Date: 2026-10-21 - Status: accepted (owner)

## Finding
The owner's interview finding: most saved recipes live on blogs or on the user's own social media profiles, i.e. recipes the user saved from those sources.

## Consequences
- The interview half of Gate A (PRD 14, M2) is satisfied, so M2 may proceed.
- Blog and social-profile sources are the priority for WP-2.1 to WP-2.5 (schema.org first, then the LLM fallback).
- The parse-accuracy half of Gate A (85% on core fields, WP-2.6 harness) is still open and must pass before M3.
- Social sources stay behind the terms review (WP-2.7, decisions note).

## Gate A parse accuracy: measure and result (owner decision 2026-10-23)

- **Measure (owner):** per-field mean over the 40 URLs, for the core fields title, ingredients and steps. A page that is not parsed (blog-26, blog-27) counts as a miss for each field. Unknown fields (truncated pages) count as misses, so the figure is conservative.
- **Result (after the 2026-10-23 re-check of blog-11 and blog-16):** title 36/40, ingredients 35/40, steps 35/40. Mean 88.3%, at or above the 85% threshold. Gate A parse-accuracy: PASS on this measure.
- **Not measured as a whole-page figure:** strict all-fields-correct is 31/40 (77.5%). Recorded for information; not the gate.
- **Open, does not block the gate:** owner spot-check of blog-02, blog-04, blog-16, blog-20, blog-36; re-check of blog-11 (no card markers, missed items not countable; all fields on page); blog-26 and blog-27 (crawl-delay 600 s, policy skip).
- **Reviewers:** the hand check was done by AI subagents reading each live page. Results are in docs/harness/wp26-review.json (counts and verdicts only).
