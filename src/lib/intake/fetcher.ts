/**
 * CP01 fetcher: robots.txt first, one request per second per domain, a timeout,
 * a size cap, and HTML only. Injected fetch/clock/sleep make it testable.
 */
import { isAllowed, parseRobots, USER_AGENT, type RobotsRules } from "./robots";

export const MIN_INTERVAL_MS = 1000;
export const MAX_BYTES = 2_000_000;
export const TIMEOUT_MS = 15_000;
/** A site asking for longer gaps than this between visits is skipped, not waited on. */
export const MAX_CRAWL_DELAY_SECONDS = 60;

export type FetchOutcome =
  | { status: "ok"; url: string; body: string }
  | { status: "skipped"; url: string; reason: "robots_disallowed" | "robots_unavailable" | "crawl_delay_too_long" | "not_html" | "too_large" | "http_error" | "network_error"; message: string };

export interface FetcherDeps {
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const MESSAGES = {
  robots_disallowed: "The site's robots.txt does not allow this page, so we skipped it.",
  robots_unavailable: "The site's robots.txt could not be read right now, so we skipped it to be safe.",
  crawl_delay_too_long: "This site asks visitors to wait several minutes between requests, so we did not import from it.",
  not_html: "This link is not a web page we can read, so we skipped it.",
  too_large: "This page is too large to import, so we skipped it.",
  http_error: "The site returned an error for this page, so we skipped it.",
  network_error: "We could not reach this site, so we skipped it.",
};

export function createFetcher(deps: FetcherDeps) {
  const robotsCache = new Map<string, Promise<RobotsRules | "unavailable">>();
  const lastRequest = new Map<string, number>();

  async function throttle(host: string, minGapMs: number) {
    const last = lastRequest.get(host);
    const now = deps.now();
    if (last !== undefined && now - last < minGapMs) await deps.sleep(minGapMs - (now - last));
    lastRequest.set(host, deps.now());
  }

  function robotsFor(origin: string): Promise<RobotsRules | "unavailable"> {
    let p = robotsCache.get(origin);
    if (!p) {
      p = (async () => {
        try {
          await throttle(new URL(origin).host, MIN_INTERVAL_MS);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
          try {
            const res = await deps.fetchImpl(origin + "/robots.txt", { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: controller.signal });
            if (res.status === 404 || res.status === 410) return { allow: [], disallow: [], crawlDelaySeconds: null };
            if (!res.ok) return "unavailable";
            return parseRobots(await res.text());
          } finally {
            clearTimeout(timer);
          }
        } catch {
          return "unavailable";
        }
      })();
      robotsCache.set(origin, p);
    }
    return p;
  }

  async function fetchPage(url: string): Promise<FetchOutcome> {
    const u = new URL(url);
    const rules = await robotsFor(u.origin);
    if (rules === "unavailable") return { status: "skipped", url, reason: "robots_unavailable", message: MESSAGES.robots_unavailable };
    const pathAndQuery = u.pathname + u.search;
    if (!isAllowed(rules, pathAndQuery)) return { status: "skipped", url, reason: "robots_disallowed", message: MESSAGES.robots_disallowed };

    const delaySeconds = rules.crawlDelaySeconds ?? 0;
    if (delaySeconds > MAX_CRAWL_DELAY_SECONDS) return { status: "skipped", url, reason: "crawl_delay_too_long", message: MESSAGES.crawl_delay_too_long };
    const gap = Math.max(MIN_INTERVAL_MS, delaySeconds * 1000);
    await throttle(u.host, gap);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await deps.fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: controller.signal });
      if (!res.ok) return { status: "skipped", url, reason: "http_error", message: MESSAGES.http_error };
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return { status: "skipped", url, reason: "not_html", message: MESSAGES.not_html };
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > MAX_BYTES) return { status: "skipped", url, reason: "too_large", message: MESSAGES.too_large };
      const body = await res.text();
      if (body.length > MAX_BYTES) return { status: "skipped", url, reason: "too_large", message: MESSAGES.too_large };
      return { status: "ok", url: res.url || url, body };
    } catch {
      return { status: "skipped", url, reason: "network_error", message: MESSAGES.network_error };
    } finally {
      clearTimeout(timer);
    }
  }

  return { fetchPage };
}
