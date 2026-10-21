/** WP-1.6 — UI vocabulary -> backend enums (ADR-008). Pure. */
import { describe, expect, it } from "vitest";
import { mapActivity, mapConsentType, mapDiet, mapSex } from "../../src/lib/onboarding/mapping";
import { SEXES, ACTIVITY_LEVELS, DIET_PATTERNS } from "../../src/lib/members/types";
import { CONSENT_DATA_TYPES } from "../../src/lib/consent/types";

describe("mapping lands only on backend enum values", () => {
  it("sex", () => {
    for (const v of ["female", "male", "prefer-not", null] as const) expect(SEXES).toContain(mapSex(v));
    expect(mapSex("prefer-not")).toBe("unspecified");
  });
  it("activity", () => {
    for (const v of ["sedentary", "low-active", "active", "very-active", null] as const) expect(ACTIVITY_LEVELS).toContain(mapActivity(v));
    expect(mapActivity("low-active")).toBe("light");
    expect(mapActivity("very-active")).toBe("high");
  });
  it("diet", () => {
    for (const v of ["omnivore", "vegetarian", "vegan", "pescatarian", "halal", "kosher", "other", null] as const) expect(DIET_PATTERNS).toContain(mapDiet(v));
    expect(mapDiet("other")).toBe("unspecified");
  });
  it("consent", () => {
    expect(mapConsentType("conditions")).toBe("health_conditions");
    expect(mapConsentType("measurements")).toBe("body_measurements");
    for (const v of ["allergies", "conditions", "measurements"] as const) expect(CONSENT_DATA_TYPES).toContain(mapConsentType(v));
  });
});
