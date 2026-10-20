// TEST FIXTURE — must produce ZERO findings.
// treat the null case explicitly — comment text is safe
export function treatData(input: Record<string, unknown>): string {
  /* cure the parse by coercion — block comments are safe */
  const s = "a treatment plan"; // 'treatment' is not the word 'treat'
  void input;
  return s;
}
const msg = "treat"; // banned-copy-allow: internal engineering term, never user-facing
export const cures = 3;
