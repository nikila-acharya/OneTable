/** WP-1.2 — PR01 required fields, PV02 no-auth, validation rules. Pure, no DB. */
import { describe, expect, it } from "vitest";
import { validateProfile } from "../../src/lib/members/validation";
import { deriveAgeYears, isChildAge } from "../../src/lib/members/age";

const NOW = new Date("2026-10-20T12:00:00Z");
const good = { name: "Asha", birthYm: "2014-06", sex: "female", activityLevel: "light" };

describe("create requires the PR01 required set", () => {
  it("accepts the required four", () => {
    expect(validateProfile(good, "create", NOW).ok).toBe(true);
  });
  it.each(["name", "birthYm", "sex", "activityLevel"])("refuses a create without %s", (field) => {
    const input = { ...good } as Record<string, unknown>;
    delete input[field];
    const r = validateProfile(input, "create", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.field)).toContain(field);
  });
  it("update may send any subset", () => {
    expect(validateProfile({ name: "Asha K" }, "update", NOW).ok).toBe(true);
  });
});

describe("PV02: members never hold credentials", () => {
  it.each(["email", "phone", "password", "passwordHash", "username"])("refuses %s", (key) => {
    const r = validateProfile({ ...good, [key]: "x" }, "create", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.code === "auth_fields_forbidden")).toBe(true);
  });
});

describe("health fields are not accepted in this slice (WP-1.3 owns them)", () => {
  it.each(["allergies", "conditions", "weightKg", "heightCm"])("refuses %s", (key) => {
    const r = validateProfile({ ...good, [key]: [] }, "create", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.code === "health_fields_not_available")).toBe(true);
  });
});

describe("field rules", () => {
  it("name over 40 characters is refused", () => {
    expect(validateProfile({ ...good, name: "x".repeat(41) }, "create", NOW).ok).toBe(false);
  });
  it.each(["2014-6", "14-06", "2014-13", "2014-00", "2014/06"])("birth month %s is refused", (v) => {
    expect(validateProfile({ ...good, birthYm: v }, "create", NOW).ok).toBe(false);
  });
  it("a birth month in the future is refused", () => {
    expect(validateProfile({ ...good, birthYm: "2027-01" }, "create", NOW).ok).toBe(false);
  });
  it("an unknown field is refused", () => {
    expect(validateProfile({ ...good, favouriteColour: "blue" }, "create", NOW).ok).toBe(false);
  });
  it("likes are trimmed, lowercased, de-duplicated and sorted", () => {
    const r = validateProfile({ ...good, likes: [" Mushrooms ", "rice", "RICE"] }, "create", NOW);
    expect(r.ok && r.value.likes).toEqual(["mushrooms", "rice"]);
  });
  it("more than 30 preferences is refused", () => {
    const many = Array.from({ length: 31 }, (_, i) => `item${i}`);
    expect(validateProfile({ ...good, dislikes: many }, "create", NOW).ok).toBe(false);
  });
});

describe("age is derived from the birth month (PV02 child boundary)", () => {
  it("a child born 2013-11 is 12 until 1 Nov 2026 and 13 after", () => {
    expect(deriveAgeYears("2013-11", new Date("2026-10-31T12:00:00Z"))).toBe(12);
    expect(deriveAgeYears("2013-11", new Date("2026-11-01T00:00:00Z"))).toBe(13);
  });
  it("a 17-year-old is a child, an 18-year-old is not", () => {
    expect(isChildAge("2009-10", NOW)).toBe(true);
    expect(isChildAge("2008-10", NOW)).toBe(false);
  });
});
