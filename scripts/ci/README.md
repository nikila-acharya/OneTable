# scripts/ci — WP-0.3 CI check tools

Self-contained npm package for the two binding safety checks of the PRD, kept
isolated from the app so it runs before the WP-0.1 scaffold merges and never
touches the root package.json. Plain Node ESM (>= 22); the only dependency is
`yaml`. All commands work from any cwd and in PowerShell (PRD 10.1).

## Checks

| Script | Gate | PRD |
|---|---|---|
| `check-rule-sources.mjs` | Fails if any `rules/*.yaml` rule lacks `source.name` or `source.url` (or the URL is not http(s), or the YAML is unparsable). Advisory schema gaps (id, description, type, applies_to, confidence, reviewed_by/on) are warnings only. | 6.2 |
| `check-banned-copy.mjs` | Fails if a banned term from `config/banned-copy-terms.json` appears in user-facing copy (string literals + JSX text under the config `scopes`). Matches case-insensitively at word boundaries with plain plural tolerance for single words. | 6.4 |

At M0 both pass vacuously by design: the rule set is intentionally empty
(real rules arrive with M3) and no `app/` tree exists yet. CI flips the rule
check to `--fail-if-empty` when M3 ships its first rules.

## Commands

```
npm ci --prefix scripts/ci     # install (only `yaml`)
npm test --prefix scripts/ci   # self-tests (node --test, fixtures under tests/)
node scripts/ci/check-rule-sources.mjs [rulesDir] [--fail-if-empty]
node scripts/ci/check-banned-copy.mjs [--config <path>] [--root <path>]
```

`.github/workflows/ci.yml` (safety-checks job) runs exactly these.

## Shared with the M4 message guard

`config/banned-copy-terms.json` is the single source of the banned-term list:
the PRD 7.3 Safety Guardian runtime check must import this same file, so a
term is banned in the UI copy and in every agent message by one list. The term
list itself is owner/Safety-approved (PRD 13.3) — adding or removing terms
needs owner approval, not a per-build edit. Documented false positives can be
suppressed per line with a `banned-copy-allow` pragma (use sparingly).
