/** WP-2.6 first pass defect: named entities common on recipe pages were left undecoded in parsed text. */
import { describe, expect, it } from "vitest";
import { cleanText } from "../../src/lib/recipes/schema-org";
import { cleanPageText } from "../../src/lib/recipes/llm-parser";

describe("cleanText entities", () => {
  it("decodes typographic apostrophes, fractions, accents and dashes", () => {
    expect(cleanText("Bob&rsquo;s &frac12; cup")).toBe("Bob\u2019s \u00BD cup");
    expect(cleanText("jalape&ntilde;o &aacute;&eacute;&oacute;")).toBe("jalape\u00F1o \u00E1\u00E9\u00F3");
    expect(cleanText("salt &ndash; to taste&hellip;")).toBe("salt \u2013 to taste\u2026");
  });
  it("decodes numeric entities too, and leaves unknown names as written", () => {
    expect(cleanText("it&#8217;s &#038; &zzzz;")).toBe("it\u2019s & &zzzz;");
  });
});

describe("cleanPageText uses the same decoding", () => {
  it("visible page text has no undecoded entities for the common set", () => {
    const text = cleanPageText("<p>Bob&rsquo;s &frac12; cup of oats</p>");
    expect(text).toContain("Bob\u2019s \u00BD cup of oats");
  });
});
