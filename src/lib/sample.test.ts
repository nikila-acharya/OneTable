import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { clamp } from "@/lib/sample";

describe("clamp (scaffold smoke test)", () => {
  it("clamps values to the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it("rejects an inverted range", () => {
    expect(() => clamp(1, 10, 0)).toThrow(RangeError);
  });

  it("always stays within bounds (property test, PRD 10.1 tests row)", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        (a, b) => {
          const min = Math.min(a, b);
          const max = Math.max(a, b);
          const clamped = clamp(a * 2, min, max);
          return clamped >= min && clamped <= max;
        },
      ),
    );
  });
});
