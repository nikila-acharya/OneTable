/** WP-1.6 — UI vocabulary -> backend enums (ADR-008). Pure. */
import { describe, expect, it } from "vitest";
import { mapActivity, mapConsentType, mapDiet, mapSex } from "../../src/lib/onboarding/mapping";
import { SEXES, ACTIVITY_LEVELS, DIET_PATTERNS } from "../../src/lib/members/types";
import { CONSENT_DATA_TYPES } from "../../src/lib/consent/types";
import { CONSENT_TYPES } from "../../src/app/onboarding/store";

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
  it("refuses an unknown consent type instead of returning undefined", () => {
    // The original shape had no default branch, so an unexpected key silently
    // became undefined and drizzle wrote DEFAULT for it - a not-null violation
    // surfaced as a 500. It must throw now.
    expect(() => mapConsentType("allergens" as never)).toThrow(/unknown consent data type/);
    expect(() => mapConsentType("health_conditions" as never)).toThrow(/unknown consent data type/);
  });
  it("CONSENT_TYPES is the only vocabulary the mapper accepts", () => {
    // Guards the drift that made this a bug at all: the UI type list and any
    // runtime validation list must stay one definition, not two.
    expect(CONSENT_TYPES).toEqual(["allergies", "conditions", "measurements"]);
    for (const k of CONSENT_TYPES) expect(() => mapConsentType(k)).not.toThrow();
  });
});
