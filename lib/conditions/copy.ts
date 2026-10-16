/**
 * WP-1.4 — fixed UI copy for SG01 (single source of truth).
 *
 * The banner string is quoted verbatim from PRD 5.2 SG01. The clinician
 * confirm message the agent must fall back to is the same fixed copy — one
 * string, so tests and the banned-copy lint (6.4) check exactly what users
 * see.
 *
 * Banned terms implement the 6.4 regulatory line (FDA general-wellness side:
 * healthy-eating language only, no disease management, no treat/cure claims,
 * no diet-culture words from 7.3). The list ships with WP-1.4 as the seed for
 * the repo-wide banned-copy lint (WP-0.3 wires it into CI); keep the wording
 * here as the source of truth and have CI import it.
 */

/** PRD 5.2 SG01, verbatim. Shown plainly and persistently. */
export const CLINICIAN_BANNER_COPY =
  'General guidance only. Confirm with your clinician.' as const;

/**
 * Fixed replacement the Safety Guardian inserts when a message would give
 * medical or condition-specific advice about a gated member (7.3 check 3).
 * Matching HT01 tips may be appended verbatim, each with its source.
 */
export const CLINICIAN_CONFIRM_MESSAGE = CLINICIAN_BANNER_COPY;

/**
 * Banned UI-copy terms (6.4 + 7.3 diet-culture list). Lower-case substrings;
 * the lint normalizes case. Kept intentionally small and safe for false
 * positives (a lint that nags gets disabled).
 */
export const BANNED_COPY_TERMS: readonly string[] = [
  'manage your diabetes',
  'manage diabetes',
  'manage your blood sugar',
  'control your blood sugar',
  'treat',
  'cure',
  'insulin dose',
  'carb dosing',
  'guilt-free',
  'guilt free',
  'cheat meal',
  'cheat day',
  'burn off',
  'earn your',
  'clean eating',
  'detox',
  'fat-burning',
  'skinny',
];

export function findBannedTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_COPY_TERMS.filter((t) => lower.includes(t));
}

/**
 * Under-18 check (7.3 check 2, minimal slice): no weight or calorie-deficit
 * language in any sentence that refers to a member under 18. Sentence-level
 * heuristic; the Guardian's LLM check runs after this one and can add blocks.
 */
const WEIGHT_CALORIE_TERMS = [
  'weight loss',
  'lose weight',
  'calorie deficit',
  'calorie cut',
  'calories',
];

export function under18AdviceViolations(text: string, underageNames: readonly string[]): string[] {
  if (underageNames.length === 0) return [];
  const violations: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const lower = sentence.toLowerCase();
    const namesUnder = underageNames.some((n) => lower.includes(n.toLowerCase()));
    if (!namesUnder) continue;
    const hit = WEIGHT_CALORIE_TERMS.find((t) => lower.includes(t));
    if (hit) violations.push(`${hit}: "${sentence.trim()}"`);
  }
  return violations;
}
