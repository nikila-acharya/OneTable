/**
 * WP-0.6 — PRD 16.7/16.3: the token file is the contrast source of truth.
 * Parses src/app/styles/tokens.css and asserts WCAG AA (4.5:1 for text,
 * 3:1 for non-text) for every text-on-surface pair the components use.
 * If a token changes and drops below AA, this test fails.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/styles/tokens.css"), "utf8");

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} not found in tokens.css`);
  return m[1]!.toLowerCase();
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) =>
    x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Which text token may sit on which surface. Tinted surfaces (sky/sand/peach)
// carry --ink text only; the accent tokens are measured on neutral surfaces.
// This table is the contract recorded in ADR-003.
const TEXT_ON: Record<string, readonly string[]> = {
  ink: ["bg", "stone", "sky", "sand", "peach", "canvas"],
  "ink-soft": ["bg", "stone", "canvas"],
  "primary-strong": ["bg", "stone", "canvas"],
  ok: ["bg", "stone", "canvas"],
  warn: ["bg", "stone", "canvas"],
};

describe("text tokens meet WCAG AA on every surface they are allowed on (ADR-003)", () => {
  for (const [t, surfaces] of Object.entries(TEXT_ON)) {
    for (const s of surfaces) {
      it(`--${t} on --${s} >= 4.5:1`, () => {
        const r = ratio(token(t), token(s));
        expect(r).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("white text on the primary button (--primary) >= 4.5:1", () => {
    expect(ratio("#ffffff", token("primary"))).toBeGreaterThanOrEqual(4.5);
  });

  it("--primary as a non-text UI colour vs white >= 3:1", () => {
    expect(ratio(token("primary"), "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("--warn-soft is kept for decoration only (documented, not used for text)", () => {
    expect(token("warn-soft")).toBe("#c98b4b");
    expect(ratio(token("warn-soft"), "#ffffff")).toBeLessThan(4.5);
  });
});

describe("token set matches PRD 16.3 names", () => {
  it.each([
    "primary", "primary-strong", "sky", "sand", "stone", "peach",
    "ink", "ink-soft", "line", "ok", "warn", "warn-soft",
  ])("defines --%s", (name) => {
    expect(() => token(name)).not.toThrow();
  });
});
