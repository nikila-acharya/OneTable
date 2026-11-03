/**
 * WP-2.7 AC tests (PRD 5.3 CP04):
 * - "pasting an Instagram or TikTok profile URL makes no network request to
 *   that platform" (the guard runs before robots.txt and before queueing);
 * - "a profile URL is never fetched by the background crawler" (mocked
 *   fetcher asserts zero calls to social domains).
 */
import { describe, expect, it, vi } from "vitest";
import type { PgBoss } from "pg-boss";
import { assertFetchable } from "../../src/lib/sources/guard";
import { createFetcher } from "../../src/lib/intake/fetcher";
import { enqueueImport } from "../../src/lib/intake/jobs";

const SOCIAL_URLS = [
  "https://www.instagram.com/chef.nina/",
  "https://www.instagram.com/reel/DdZ02t-TBa6/",
  "https://www.tiktok.com/@chef.nina",
  "https://www.tiktok.com/@chef.nina/video/7412345678901234567",
  "https://www.pinterest.com/chefnina/",
  "https://www.facebook.com/chefnina",
  "https://www.youtube.com/@chefnina",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
];

describe("CP04 guard: no network for social platforms", () => {
  it("assertFetchable refuses every social URL with plain words", () => {
    for (const url of SOCIAL_URLS) {
      const r = assertFetchable(url);
      expect(r.ok, url).toBe(false);
      if (!r.ok) expect(r.reason.length, url).toBeGreaterThan(10);
    }
  });

  it("the mocked fetcher makes ZERO fetch calls for a social page (and skips before robots.txt)", async () => {
    const spy = vi.fn();
    const fetcher = createFetcher({ fetchImpl: spy, now: () => 0, sleep: async () => {} });
    for (const url of SOCIAL_URLS) {
      const out = await fetcher.fetchPage(url);
      expect(out.status, url).toBe("skipped");
      if (out.status === "skipped") expect(out.reason, url).toBe("social_not_read");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("enqueueImport refuses social links before the queue sees them", async () => {
    const send = vi.fn(async () => "job-1");
    const boss = { send } as unknown as PgBoss;
    for (const url of SOCIAL_URLS) {
      const r = await enqueueImport(boss, { householdId: "00000000-0000-0000-0000-000000000000", url });
      expect(r.ok, url).toBe(false);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("a normal blog URL passes the guard", () => {
    const r = assertFetchable("https://blog.example.test/2026/10/slow-pasta");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.platform).toBe("website");
  });

  it("garbage never pretends to be fetchable", () => {
    expect(assertFetchable("not-a-url").ok).toBe(false);
    expect(assertFetchable("file:///etc/passwd").ok).toBe(false);
  });
});
