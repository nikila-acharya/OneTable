/**
 * Scaffold sample module — proves the Vitest + fast-check + "@/" alias wiring.
 * Replace with real shared utilities as work packages land (do not delete the
 * sample test until at least one real unit test exists).
 */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError("clamp: min must be <= max");
  }
  return Math.min(Math.max(value, min), max);
}
