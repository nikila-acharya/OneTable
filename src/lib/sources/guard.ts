/**
 * WP-2.7 CP04 guard: the single choke point every network read must pass.
 *
 * PRD AC: "a profile URL is never fetched by the background crawler" and
 * "pasting an Instagram or TikTok profile URL makes no network request to
 * that platform". Enforcement is by construction: the fetcher factory and
 * the queue both call `assertFetchable`, and tests with a mocked fetcher
 * assert zero calls to social domains.
 */
import { classifyLink, isNeverFetchedHost, POLICY, type Platform } from "./platform";

export type GuardResult = { ok: true; platform: Platform } | { ok: false; reason: string };

/** Refuse any URL on a social platform domain before a request is made. */
export function assertFetchable(url: string): GuardResult {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "That does not look like a web link." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "Only web links (http or https) can be imported." };
  }
  const host = u.hostname.toLowerCase();
  if (isNeverFetchedHost(u.hostname)) {
    const platform = hostPlatformOf(host);
    const why = platform ? POLICY[platform].why : "That site is not one the app reads.";
    return { ok: false, reason: why };
  }
  const cls = classifyLink(url);
  if (!cls.mayFetch) return { ok: false, reason: cls.note || "The app cannot read this link." };
  return { ok: true, platform: cls.platform };
}

function hostPlatformOf(host: string): Platform | null {
  const bare = host.replace(/^www\./, "");
  if (bare === "youtu.be" || bare.endsWith("youtube.com")) return "youtube";
  if (bare.includes("instagram")) return "instagram";
  if (bare.includes("tiktok")) return "tiktok";
  if (bare.includes("pinterest") || bare === "pin.it") return "pinterest";
  if (bare.includes("facebook") || bare === "fb.com") return "facebook";
  return null;
}
