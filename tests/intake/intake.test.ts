/** WP-2.1 — CP01 intake: URL checks, robots.txt, rate limit, skips with plain reasons. No network. */
import { describe, expect, it } from "vitest";
import { checkPublicUrl } from "../../src/lib/intake/url";
import { isAllowed, parseRobots } from "../../src/lib/intake/robots";
import { createFetcher, MIN_INTERVAL_MS } from "../../src/lib/intake/fetcher";

describe("URL intake (SSRF-safe)", () => {
  it("accepts a normal https recipe link and drops the fragment", () => {
    const r = checkPublicUrl("https://example.com/recipes/soup#notes");
    expect(r).toEqual({ ok: true, url: "https://example.com/recipes/soup" });
  });
  it.each([
    "ftp://example.com/a",
    "javascript:alert(1)",
    "http://localhost/x",
    "http://api.internal/x",
    "http://127.0.0.1/x",
    "http://10.0.0.5/x",
    "http://192.168.1.2/x",
    "http://169.254.169.254/latest",
    "http://[::1]/x",
    "https://user:pass@example.com/x",
    "https://example.com:8443/x",
    "not a url",
    "",
  ])("refuses %s", (u) => {
    expect(checkPublicUrl(u).ok).toBe(false);
  });
  it("gives a plain reason for a private address", () => {
    const r = checkPublicUrl("http://192.168.1.2/x");
    expect(!r.ok && r.reason).toMatch(/private network/);
  });
});

describe("robots.txt rules", () => {
  const txt = `User-agent: *
Disallow: /private/
Disallow: /search
Allow: /private/public-recipes/
User-agent: OneTableBot
Disallow: /recipes/no-bots/
Crawl-delay: 3`;
  it("uses the group for our bot when there is one", () => {
    const rules = parseRobots(txt);
    expect(isAllowed(rules, "/recipes/no-bots/x")).toBe(false);
    expect(isAllowed(rules, "/private/x")).toBe(true); // the * group is not used for our bot
    expect(rules.crawlDelaySeconds).toBe(3);
  });
  it("falls back to * for another bot", () => {
    const rules = parseRobots(txt, "SomeOtherBot");
    expect(isAllowed(rules, "/private/x")).toBe(false);
    expect(isAllowed(rules, "/private/public-recipes/soup")).toBe(true);
    expect(isAllowed(rules, "/search?q=soup")).toBe(false);
    expect(isAllowed(rules, "/recipes/fine")).toBe(true);
  });
  it("handles $ and * wildcards", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp/*/cache");
    expect(isAllowed(rules, "/files/menu.pdf")).toBe(false);
    expect(isAllowed(rules, "/files/menu.pdf?x=1")).toBe(true);
    expect(isAllowed(rules, "/tmp/abc/cache")).toBe(false);
  });
});

function fakeWeb(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: { url: string; at: number }[] = [];
  let clock = 0;
  const sleeps: number[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url, at: clock });
    const handler = routes[url];
    if (!handler) return new Response("not here", { status: 404 });
    return handler();
  }) as unknown as typeof fetch;
  const deps = {
    fetchImpl,
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
  };
  return { deps, calls, sleeps };
}

const html = (body = "<html><body>recipe</body></html>") =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

describe("fetcher", () => {
  it("a site asking for a very long crawl delay is skipped with a plain reason (no multi-minute wait)", async () => {
    const web = fakeWeb({
      "https://slow-site.example/robots.txt": () => new Response("User-agent: *\nCrawl-delay: 600", { status: 200 }),
    });
    const out = await createFetcher(web.deps).fetchPage("https://slow-site.example/recipes/soup");
    expect(out.status === "skipped" && out.reason).toBe("crawl_delay_too_long");
    expect(web.sleeps.every((ms) => ms < 60_000)).toBe(true);
  });

  it("a short crawl delay is honoured as the gap between requests", async () => {
    const web = fakeWeb({
      "https://polite.example/robots.txt": () => new Response("User-agent: *\nCrawl-delay: 5", { status: 200 }),
      "https://polite.example/a": () => html(),
      "https://polite.example/b": () => html(),
    });
    const f = createFetcher(web.deps);
    await f.fetchPage("https://polite.example/a");
    await f.fetchPage("https://polite.example/b");
    const pageCalls = web.calls.filter((c) => c.url.endsWith("/a") || c.url.endsWith("/b"));
    expect(pageCalls[1]!.at - pageCalls[0]!.at).toBeGreaterThanOrEqual(5000);
  });

  it("a robots.txt that never answers times out and counts as unavailable (no hang)", async () => {
    const hanging = ((input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        void input;
      })) as unknown as typeof fetch;
    const out = await createFetcher({ fetchImpl: hanging, now: () => Date.now(), sleep: async () => {} }).fetchPage("https://slow.example/recipes/x");
    expect(out.status === "skipped" && out.reason).toBe("robots_unavailable");
  }, 30_000);

  it("skips a disallowed path and says why in plain words", async () => {
    const web = fakeWeb({
      "https://blog.example/robots.txt": () => new Response("User-agent: *\nDisallow: /private/", { status: 200 }),
    });
    const f = createFetcher(web.deps);
    const out = await f.fetchPage("https://blog.example/private/soup");
    expect(out.status).toBe("skipped");
    if (out.status === "skipped") {
      expect(out.reason).toBe("robots_disallowed");
      expect(out.message).toMatch(/robots\.txt does not allow this page/);
    }
    // the page itself was never requested
    expect(web.calls.some((c) => c.url === "https://blog.example/private/soup")).toBe(false);
  });

  it("no robots.txt (404) means allowed", async () => {
    const web = fakeWeb({ "https://blog.example/recipes/soup": () => html() });
    const out = await createFetcher(web.deps).fetchPage("https://blog.example/recipes/soup");
    expect(out.status).toBe("ok");
  });

  it("unreadable robots.txt (500) means skip, to be safe", async () => {
    const web = fakeWeb({ "https://blog.example/robots.txt": () => new Response("", { status: 500 }) });
    const out = await createFetcher(web.deps).fetchPage("https://blog.example/recipes/soup");
    expect(out.status === "skipped" && out.reason).toBe("robots_unavailable");
  });

  it("one request per second per domain", async () => {
    const web = fakeWeb({
      "https://blog.example/robots.txt": () => new Response("", { status: 404 }),
      "https://blog.example/a": () => html(),
      "https://blog.example/b": () => html(),
    });
    const f = createFetcher(web.deps);
    await f.fetchPage("https://blog.example/a");
    await f.fetchPage("https://blog.example/b");
    const pageCalls = web.calls.filter((c) => c.url.endsWith("/a") || c.url.endsWith("/b"));
    expect(pageCalls[1]!.at - pageCalls[0]!.at).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
  });

  it("a non-HTML response is skipped", async () => {
    const web = fakeWeb({
      "https://blog.example/robots.txt": () => new Response("", { status: 404 }),
      "https://blog.example/x.pdf": () => new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } }),
    });
    const out = await createFetcher(web.deps).fetchPage("https://blog.example/x.pdf");
    expect(out.status === "skipped" && out.reason).toBe("not_html");
  });

  it("an oversized page is skipped", async () => {
    const web = fakeWeb({
      "https://blog.example/robots.txt": () => new Response("", { status: 404 }),
      "https://blog.example/big": () => new Response("x", { status: 200, headers: { "content-type": "text/html", "content-length": "99999999" } }),
    });
    const out = await createFetcher(web.deps).fetchPage("https://blog.example/big");
    expect(out.status === "skipped" && out.reason).toBe("too_large");
  });

  it("a network failure is skipped with a plain message", async () => {
    const web = fakeWeb({
      "https://blog.example/robots.txt": () => new Response("", { status: 404 }),
    });
    const deps = { ...web.deps, fetchImpl: (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/robots.txt")) return new Response("", { status: 404 });
      throw new Error("socket hang up");
    }) as unknown as typeof fetch };
    const out = await createFetcher(deps).fetchPage("https://blog.example/down");
    expect(out.status === "skipped" && out.reason).toBe("network_error");
  });
});
