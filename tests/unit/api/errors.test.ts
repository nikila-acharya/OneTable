/**
 * API error surfacing must be consistent (one body shape) and must never put
 * identifiers or bound values in logs. NF-P6: health data is referenced, not
 * logged. Drizzle's own error text embeds `params: <values>`, so this is the
 * guard that keeps a log line safe to ship to a hosted log drain.
 */
import { describe, expect, it } from "vitest";
import { describeError } from "@/lib/api/errors";

const HID = "555e2f9b-1a94-482a-94d6-05252bfa2ff2";

describe("describeError", () => {
  it("keeps the error name and the leading clause", () => {
    const e = new TypeError("something exploded\nsecond line\nthird line");
    e.name = "TypeError";
    const out = describeError(e);
    expect(out.startsWith("TypeError: something exploded")).toBe(true);
    expect(out).not.toContain("second line");
  });

  it("masks UUIDs — a household id must not reach the log", () => {
    const e = new Error(`household ${HID} has no plan`);
    const out = describeError(e);
    expect(out).not.toContain(HID);
    expect(out).toContain("[id]");
  });

  it("drops the bound parameter list from a failed drizzle query", () => {
    // This is the real message shape seen in production: it carries the
    // household id and the column values that were being written.
    const e = new Error(
      `Failed query: insert into "consent" ("household_id","granted","policy_version") values ($1,$2,$3)\nparams: ${HID},true,type 2 diabetes`,
    );
    const out = describeError(e);
    expect(out).toContain("[params redacted]");
    expect(out).not.toContain(HID);
    expect(out).not.toContain("type 2 diabetes");
    expect(out).not.toContain("true,");
    expect(out).toContain("Failed query:");
    expect(out).toContain("$1,$2,$3");
  });

  it("removes multi-line detail rows, which is where values hide", () => {
    const e = new Error(
      `null value in column "data_type" violates not-null constraint\nFailing row contains (${HID}, t, type 2 diabetes).`,
    );
    const out = describeError(e);
    expect(out).not.toContain(HID);
    expect(out).not.toContain("Failing row");
    expect(out).not.toContain("type 2 diabetes");
  });

  it("masks client-generated onboarding ids", () => {
    const e = new Error("no such member m_mwpcm5hb_36hiti");
    expect(describeError(e)).not.toContain("m_mwpcm5hb_36hiti");
  });

  it("caps length so a pathological message cannot bloat the log", () => {
    const e = new Error("x".repeat(5000));
    expect(describeError(e).length).toBeLessThanOrEqual(400);
  });

  it("survives non-Error throws without leaking the value", () => {
    expect(describeError({ [HID]: "leak" })).toMatch(/^object:/);
    expect(describeError(null)).toContain("object");
    expect(describeError("plain string")).toContain("plain string");
  });
});
