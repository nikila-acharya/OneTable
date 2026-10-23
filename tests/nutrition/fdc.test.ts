/** WP-2.4 / RE03 step 2: FDC lookup against recorded real responses (no network, no key needed in CI). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chooseMatch, createFdcClient, type FdcFood } from "../../src/lib/nutrition/fdc";

const fixture = (name: string): FdcFood[] => (JSON.parse(readFileSync(`tests/fixtures/fdc/${name}.json`, "utf8")) as { foods: FdcFood[] }).foods;

describe("chooseMatch on recorded USDA responses", () => {
  it("chickpeas: a generic Foundation food with protein per 100 g", () => {
    const m = chooseMatch("chickpeas", fixture("chickpeas"));
    expect(m).not.toBeNull();
    expect(m!.dataType).toBe("Foundation");
    expect(m!.per100g.protein).toBeGreaterThan(0);
  });
  it("cornstarch: a SR Legacy food with full confidence", () => {
    const m = chooseMatch("cornstarch", fixture("cornstarch"));
    expect(m).toMatchObject({ dataType: "SR Legacy", confidence: 1 });
  });
  it("olive oil: matches (branded when no generic entry is in the results) and says which kind", () => {
    const m = chooseMatch("olive oil", fixture("olive-oil"));
    expect(m).not.toBeNull();
    expect(["Foundation", "SR Legacy", "Branded"]).toContain(m!.dataType);
  });
  it("a made-up ingredient is unmatched (below the floor)", () => {
    expect(chooseMatch("unicorn dust extract", fixture("onion"))).toBeNull();
  });
  it("an empty food name is unmatched", () => {
    expect(chooseMatch("   ", fixture("onion"))).toBeNull();
  });
});

describe("FDC client", () => {
  it("sends the key in the X-Api-Key header and never in the URL", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seenUrl = String(url);
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ foods: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = createFdcClient({ apiKey: "test-key-not-real", fetchImpl: fakeFetch });
    await c.search("chickpeas");
    expect(seenHeaders["X-Api-Key"]).toBe("test-key-not-real");
    expect(seenUrl).not.toMatch(/api_key|test-key/);
    expect(seenUrl).toMatch(/query=chickpeas/);
  });
  it("a non-200 answer is an error, not an empty match", async () => {
    const fakeFetch = (async () => new Response("no", { status: 429 })) as unknown as typeof fetch;
    const c = createFdcClient({ apiKey: "k", fetchImpl: fakeFetch });
    await expect(c.search("onion")).rejects.toThrow(/fdc http 429/);
  });
});
