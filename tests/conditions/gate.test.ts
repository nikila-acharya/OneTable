/** WP-1.4 — SG01 condition gate (PRD 5.2, 6.3 SG-C/SG-D, ADR-114 D2-D4). Pure. */
import { describe, expect, it } from "vitest";
import { evaluateConditionGate } from "../../src/lib/conditions/gate";
import { CONDITION_POLICIES } from "../../src/lib/conditions/policy";
import { CLINICIAN_BANNER_COPY } from "../../src/lib/conditions/copy";
import { CONDITIONS } from "../../src/lib/health/enums";
import { assertMemberTargetAllowed, MemberTargetBlockedError, clinicianConfirmReply } from "../../src/lib/conditions/targets";

describe("copy is the PRD wording, verbatim", () => {
  it("banner copy", () => {
    expect(CLINICIAN_BANNER_COPY).toBe("General guidance only. Confirm with your clinician.");
  });
});

describe("no listed condition is missed (fail-safe, ADR-114 D2)", () => {
  it.each(CONDITIONS.filter((c) => c !== "other"))("%s puts the member in general-guidance mode", (c) => {
    const g = evaluateConditionGate("m", [c]);
    expect(g.mode).toBe("general_guidance");
    expect(g.showClinicianBanner).toBe(true);
    expect(g.bannerCopy).toBe(CLINICIAN_BANNER_COPY);
  });
  it("'other' is recognised and not acted on", () => {
    const g = evaluateConditionGate("m", ["other"]);
    expect(g.mode).toBe("normal");
    expect(g.bannerCopy).toBe("");
  });
  it("an unrecognised value fails safe into the gate and is reported", () => {
    const g = evaluateConditionGate("m", ["asthma"]);
    expect(g.mode).toBe("general_guidance");
    expect(g.unrecognized).toEqual(["asthma"]);
  });
  it("no conditions at all is normal", () => {
    expect(evaluateConditionGate("m", []).mode).toBe("normal");
    expect(evaluateConditionGate("m", null).mode).toBe("normal");
  });
});

describe("celiac is a hard gluten filter (SG01 bullet 3)", () => {
  it("celiac sets glutenHardFilter", () => {
    expect(evaluateConditionGate("m", ["celiac disease"]).glutenHardFilter).toBe(true);
  });
  it("diabetes alone does not", () => {
    expect(evaluateConditionGate("m", ["type 2 diabetes"]).glutenHardFilter).toBe(false);
  });
});

describe("determinism", () => {
  it("triggers follow enum order whatever the input order", () => {
    const a = evaluateConditionGate("m", ["celiac disease", "type 1 diabetes"]);
    const b = evaluateConditionGate("m", ["type 1 diabetes", "celiac disease"]);
    expect(a.triggers).toEqual(b.triggers);
    expect(a.triggers).toEqual(["type 1 diabetes", "celiac disease"]);
  });
});

describe("policy table covers every PR03 condition", () => {
  it("has one row per enum value", () => {
    expect(Object.keys(CONDITION_POLICIES).sort()).toEqual([...CONDITIONS].sort());
  });
});

describe("SG01 AC: a gated member gets no member-specific target", () => {
  it("a CKD member is refused by the target guard", () => {
    const g = evaluateConditionGate("m-ckd", ["chronic kidney disease"]);
    expect(() => assertMemberTargetAllowed(g)).toThrow(MemberTargetBlockedError);
  });
  it("a member with no listed condition passes the guard", () => {
    expect(() => assertMemberTargetAllowed(evaluateConditionGate("m", []))).not.toThrow();
  });
  it("a fixed clinician reply is returned for a gated member, and null otherwise", () => {
    expect(clinicianConfirmReply(evaluateConditionGate("m", ["pregnancy"]))).toBe(CLINICIAN_BANNER_COPY);
    expect(clinicianConfirmReply(evaluateConditionGate("m", []))).toBeNull();
  });
});
