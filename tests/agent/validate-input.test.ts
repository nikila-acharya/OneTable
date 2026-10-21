/** ADR-006-G1: the registry validates the declared JSON Schema subset, recursively. */
import { describe, expect, it } from "vitest";
import { validateInput } from "../../agent/tools/registry";
import type { ToolJsonSchema } from "../../agent/tools/json";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 5 },
    count: { type: "integer", minimum: 0, maximum: 3 },
    height: { type: ["number", "null"], minimum: 50 },
    tags: { type: "array", maxItems: 2, uniqueItems: true, items: { type: "string", enum: ["a", "b"] } },
    code: { type: "string", pattern: "^[0-9]{2}$" },
    nested: {
      type: "object",
      additionalProperties: false,
      required: ["k"],
      properties: { k: { type: "string" } },
    },
  },
  required: ["name"],
} as unknown as ToolJsonSchema;

describe("type checks", () => {
  it("accepts a valid input", () => {
    expect(validateInput(schema, { name: "ok", count: 2, height: null, tags: ["a"], code: "12", nested: { k: "x" } })).toBeNull();
  });
  it("keeps the original top-level message wording", () => {
    expect(validateInput(schema, { name: 7 })).toBe("property 'name' must be of type string");
  });
  it("union types accept null and reject strings", () => {
    expect(validateInput(schema, { name: "x", height: null })).toBeNull();
    expect(validateInput(schema, { name: "x", height: "tall" })).toMatch(/'height' must be of type number or null/);
  });
  it("integer rejects fractions", () => {
    expect(validateInput(schema, { name: "x", count: 1.5 })).toMatch(/'count' must be of type integer/);
  });
});

describe("enum, bounds, format", () => {
  it("rejects a value outside an item enum (the ADR-006-G1 case)", () => {
    expect(validateInput(schema, { name: "x", tags: ["c"] })).toContain("'tags'[0] must be one of");
  });
  it("enforces minimum / maximum", () => {
    expect(validateInput(schema, { name: "x", count: 4 })).toMatch(/'count' must be at most 3/);
    expect(validateInput(schema, { name: "x", height: 40 })).toMatch(/'height' must be at least 50/);
  });
  it("enforces string length and pattern", () => {
    expect(validateInput(schema, { name: "toolong" })).toMatch(/'name' is too long/);
    expect(validateInput(schema, { name: "x", code: "abc" })).toMatch(/'code' has an invalid format/);
  });
});

describe("arrays and nested objects", () => {
  it("enforces maxItems and uniqueItems", () => {
    expect(validateInput(schema, { name: "x", tags: ["a", "b", "a"] })).toMatch(/must not repeat|too many/);
    expect(validateInput(schema, { name: "x", tags: ["a", "a"] })).toMatch(/must not repeat/);
  });
  it("rejects unknown keys inside a nested object", () => {
    expect(validateInput(schema, { name: "x", nested: { k: "x", extra: 1 } })).toMatch(/has unknown property 'extra'/);
  });
  it("requires nested required keys", () => {
    expect(validateInput(schema, { name: "x", nested: {} })).toMatch(/missing required property 'k'/);
  });
});
