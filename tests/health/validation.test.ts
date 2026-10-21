/** WP-1.3 — PR02/PR03 enums, PV02 child weight refusal, input bounds. Pure. */
import { describe, expect, it } from "vitest";
import { validateHealthPatch } from "../../src/lib/health/validation";

const codes = (r: ReturnType<typeof validateHealthPatch>) => (r.ok ? [] : r.issues.map((i) => i.code));

describe("PR03: conditions come from the fixed list only", () => {
  it("accepts a listed condition", () => {
    expect(validateHealthPatch({ conditions: ["type 2 diabetes"] }, 40).ok).toBe(true);
  });
  it.each(["asthma", "weight loss", "Type 2 Diabetes"])("refuses %s", (c) => {
    expect(codes(validateHealthPatch({ conditions: [c] }, 40))).toContain("invalid");
  });
});

describe("PR02: allergens come from the nine major allergens; free text only as 'other'", () => {
  it("accepts peanuts and tree nuts", () => {
    expect(validateHealthPatch({ allergies: ["peanuts", "tree nuts"] }, 40).ok).toBe(true);
  });
  it("refuses the singular 'peanut' (not the canonical id)", () => {
    expect(codes(validateHealthPatch({ allergies: ["peanut"] }, 40))).toContain("invalid");
  });
  it("other allergens are free tags, normalised", () => {
    const r = validateHealthPatch({ otherAllergens: [" Mango ", "mango"] }, 40);
    expect(r.ok && r.value.otherAllergens).toEqual(["mango"]);
  });
});

describe("PV02: children under 13 have no weight collected, whatever consent says", () => {
  it("refuses weight for a 12-year-old", () => {
    expect(codes(validateHealthPatch({ weightKg: 40 }, 12))).toContain("child_collection_limit");
  });
  it("allows height for a child (optional, PV02 list)", () => {
    expect(validateHealthPatch({ heightCm: 140 }, 9).ok).toBe(true);
  });
  it("allows weight for a 16-year-old (growth tracking; consent still required by the gate)", () => {
    expect(validateHealthPatch({ weightKg: 55 }, 16).ok).toBe(true);
  });
  it("clearing weight (null) is always allowed", () => {
    expect(validateHealthPatch({ weightKg: null }, 9).ok).toBe(true);
  });
});

describe("bounds and unknown keys", () => {
  it.each([{ heightCm: 20 }, { heightCm: 300 }, { weightKg: 1 }, { weightKg: 500 }])("refuses out-of-range %j", (p) => {
    expect(validateHealthPatch(p, 40).ok).toBe(false);
  });
  it("refuses a key that is not a health field", () => {
    expect(codes(validateHealthPatch({ bmi: 22 }, 40))).toContain("not_allowed");
  });
});
