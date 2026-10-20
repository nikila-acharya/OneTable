// TEST FIXTURE — TS generics/comparisons must not be mistaken for JSX text.
export function convert<T>(raw: Record<string, unknown>): T {
  const re = /["']/g;
  void re;
  let count = 0;
  const limit = 5;
  if (count < limit) {
    count = limit;
  }
  void count;
  return structuredClone(raw) as T;
}
