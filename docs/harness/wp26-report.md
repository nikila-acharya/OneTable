# WP-2.6 — parse-accuracy harness: final report

Run date: 2026-10-22 (first pass + AI hand-check), 2026-10-23 (re-check), closed 2026-11-02
with the ADR-015 terms ruling. Counts and flags only — no recipe text lives in this
repo (PRD 5.3). The URL set (50 links: 40 blog pages, 10 social posts) is kept off the
repo in `docs/harness/url-set.json` (local, owner data). The 9 creators listed under
`excluded` there had no verifiable recipe page and never entered the set.

## What ran

| Stage | Figure | Source file |
|---|---|---|
| Pages fetched + parsed by schema.org (RE01) | 38 / 40 blog pages | wp26-first-pass.json |
| Policy skips (Crawl-delay 600 s) | 2 (blog-26, blog-27) | wp26-first-pass.json |
| Hand-check by AI reviewers (per-page reading of the live page) | 38 pages; verdicts 31 correct / 5 minor / 1 unverified / 1 wrong | wp26-review.json |
| Owner spot-check (5 flagged pages) | no problems found | ADR-011 |

**AI-review disclosure:** the per-page hand-check was done by AI subagents reading each
live page, not by a human. The owner spot-checked 5 pages.

## Markup vs LLM split (the WP-2.6 report line)

- schema.org markup (RE01): **38 of 38** successfully fetched pages parsed with markup.
- LLM fallback (RE02): **0** pages needed it in this set (all blogs ship JSON-LD).
  The fallback path is covered by its own live tests (WP-2.3), not by this harness.
- No-parse fallback (manual entry): the 2 policy-skipped pages.

## Gate A accuracy (owner-approved measure, ADR-011)

Per-field mean over the 40-URL blog denominator (owner later excluded blog-11 → 39):

| Field | Pass | Measure |
|---|---|---|
| title | 35 / 39 | owner-approved denominator (blog-11 excluded) |
| ingredients | 35 / 39 | |
| steps | 35 / 39 | |
| **mean** | **89.7%** | threshold 85% → **PASS** |
| strict all-fields-correct (recorded, not the gate) | 31 / 40 = 77.5% | whole-page figure |

## Blog vs social share (closed by ADR-015)

- Blog/websites: **40 of 50** URLs, fully importable under CP01 — 40/40 auto-importable.
- Social posts: **10 of 50**, all Instagram reels. Under each platform's own terms
  (ADR-015) the app may not read profiles or post HTML; Meta's tokenless oEmbed
  (since 2026-06-15) returns **embed HTML only** — verified against one of these very
  reels: no title, no caption. So: **0 of 10** are machine-importable by design, and
  **0 network requests were made** to social domains: the harness only ever fetched
  the blog URLs, and since WP-2.7 the guard makes a social fetch impossible by
  construction (tests/sources/no-network.test.ts).
- Product answer for the social 10 (CP04): the creator is saved, the owner's website
  is added from the card, or the post goes to manual entry (CP02 prefill).

**Conclusion:** social is a *save-and-route* flow, not a *parse* flow. The parse
measure — and Gate A — stands on the blog set: PASS at 89.7%.
