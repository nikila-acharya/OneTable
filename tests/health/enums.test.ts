/** WP-1.3 — the lib lists must equal the onboarding UI lists (no drift, PR02/PR03). */
import { describe, expect, it } from "vitest";
import { ALLERGENS, CONDITIONS, GENERAL_GUIDANCE_CONDITIONS } from "../../src/lib/health/enums";
import { MAJOR_ALLERGENS, CONDITIONS as UI_CONDITIONS, GENERAL_GUIDANCE_CONDITIONS as UI_GENERAL } from "../../src/app/onboarding/store";

describe("enum parity with the onboarding UI", () => {
  it("allergens are the same nine, in the same order", () => {
    expect([...ALLERGENS]).toEqual([...MAJOR_ALLERGENS]);
  });
  it("conditions are the PR03 list, identical to the UI", () => {
    expect([...CONDITIONS]).toEqual([...UI_CONDITIONS]);
  });
  it("general-guidance set (SG01) matches the UI", () => {
    expect([...GENERAL_GUIDANCE_CONDITIONS].sort()).toEqual([...UI_GENERAL].sort());
  });
});
