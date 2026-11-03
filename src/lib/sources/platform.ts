/**
 * WP-2.7 CP04: classify pasted links by platform and source kind.
 *
 * Pure module: it never touches the network. The AC "pasting an Instagram or
 * TikTok profile URL makes no network request" is served by this module plus
 * the `mayFetch` flag: anything false must be refused before a fetcher or an
 * import job sees the URL (enforced in `guard.ts` and by tests).
 *
 * kind follows the `source_kind` enum in db/schema.ts:
 *   website         — blog / recipe site; full import allowed (CP01)
 *   youtube_channel — trusted creator channel; reader stays behind the
 *                     WP-2.7 terms flag (see docs/decisions ADR-015)
 *   social_profile  — IG / TikTok / Pinterest / FB profile: saved as a
 *                     trusted creator only; NO automated reading (CP04)
 *   single_post     — one post/reel/pin/video shared by the User (CP02);
 *                     what we may read is decided per platform in POLICY
 */
export type Platform =
  | "website"
  | "youtube"
  | "instagram"
  | "tiktok"
  | "pinterest"
  | "facebook";

export type SourceKind = "website" | "youtube_channel" | "social_profile" | "single_post";

export interface PlatformPolicy {
  /** May the app fetch pages on this platform's own domain at all? */
  mayFetch: boolean;
  /** Plain-words reason shown to the User when mayFetch is false. */
  why: string;
  /**
   * Official public embed (oEmbed) endpoint the app may call for a
   * user-shared single post, per ADR-015 (docs/decisions/015-social-platform-terms-review.md).
   * "display": the endpoint returns embed HTML plus title/author for the
   * source card — DISPLAY ONLY. Persisting or extracting post content from
   * oEmbed responses is prohibited (Meta's oEmbed terms forbid consuming or
   * extracting embed data; YouTube API data has 30-day retention rules).
   * Recipes from social posts go through the manual-entry form (CP02).
   * "none": call nothing.
   */
  oembed: "none" | "display";
}

/**
 * Defaults from the ADR-015 terms note (owner approval is owed before the
 * YouTube channel flag is turned on). Social profiles are never fetched
 * (certain, PRD CP04). Social single posts: the platform's own HTML is never
 * fetched; where the platform offers an official public oEmbed we may use it
 * for a user-shared single post (CP02). youtube_channel: reading a whole
 * channel through the Data API hits the 30-day data-retention rules — the
 * flag stays OFF (ADR-015).
 */
export const POLICY: Record<Platform, PlatformPolicy> = {
  website: {
    mayFetch: true,
    why: "",
    oembed: "none",
  },
  youtube: {
    // Channel reading goes through the official Data API behind the flag,
    // never through an HTML fetch of youtube.com.
    mayFetch: false,
    why: "We only read YouTube through the official API, and that is not switched on yet.",
    oembed: "display",
  },
  instagram: {
    mayFetch: false,
    why: "Instagram doesn't let apps read profiles. Share a post with us, or add the creator's website, and we'll pull in the recipes.",
    oembed: "display",
  },
  tiktok: {
    mayFetch: false,
    why: "TikTok doesn't let apps read profiles. Share a post with us, or add the creator's website, and we'll pull in the recipes.",
    oembed: "display",
  },
  pinterest: {
    mayFetch: false,
    why: "Pinterest doesn't let apps read profiles. Add the creator's website, and we'll pull in the recipes.",
    // www.pinterest.com/oembed.json exists but Pinterest does not document or
    // sanction it (ADR-015): call nothing.
    oembed: "none",
  },
  facebook: {
    mayFetch: false,
    why: "Facebook doesn't let apps read profiles. Share a post with us, or add the creator's website, and we'll pull in the recipes.",
    oembed: "display",
  },
};

export interface LinkPlan {
  url: string;
  platform: Platform;
  kind: SourceKind;
  /** The app may read this URL (after the CP01 public-URL checks). */
  mayFetch: boolean;
  /** True when the User must be asked for the creator's website (CP04 prompt). */
  needsWebsite: boolean;
  /** Plain-words note for the source card. */
  note: string;
}

const SOCIAL_HOSTS: { platform: Platform; hosts: string[] }[] = [
  { platform: "youtube", hosts: ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"] },
  { platform: "instagram", hosts: ["instagram.com", "www.instagram.com", "instagr.am"] },
  { platform: "tiktok", hosts: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com"] },
  { platform: "pinterest", hosts: ["pinterest.com", "pin.it", "worldwide.pinterest.com"] },
  { platform: "facebook", hosts: ["facebook.com", "www.facebook.com", "fb.com", "m.facebook.com"] },
];

/** Hostnames (and their subdomains) the app must never fetch. */
export function isNeverFetchedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return SOCIAL_HOSTS.some(({ hosts }) =>
    hosts.some((h) => host === h.replace(/^www\./, "") || host.endsWith("." + h.replace(/^www\./, ""))),
  );
}

function hostPlatform(hostname: string): Platform | null {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  for (const { platform, hosts } of SOCIAL_HOSTS) {
    const bare = hosts.map((h) => h.replace(/^www\./, ""));
    if (bare.some((h) => host === h || host.endsWith("." + h))) return platform;
  }
  return null;
}

function pathSegments(pathname: string): string[] {
  return pathname.split("/").filter((s) => s !== "");
}

/**
 * Classify one absolute URL. Throws nothing: anything that is not an http(s)
 * URL is reported as an unparseable link so the caller can reply in plain
 * words. Call this only after `checkPublicUrl` (SSRF guard) has passed.
 */
export function classifyLink(url: string): LinkPlan {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return plan(url, "website", "single_post", false, false, "That does not look like a web link.");
  }

  const platform = hostPlatform(u.hostname);
  const seg = pathSegments(u.pathname);
  const p = (u.pathname + u.search).toLowerCase();

  if (platform === null) {
    // Blogs and recipe sites: everything is fair game for CP01.
    return plan(u.toString(), "website", "website", true, false, "");
  }

  if (platform === "youtube") {
    if (u.hostname.toLowerCase() === "youtu.be" || /^\/(watch|shorts|live)/.test(p)) {
      return plan(u.toString(), "youtube", "single_post", false, false, POLICY.youtube.why);
    }
    if (/^\/(@|channel\/|user\/|c\/|c=)/.test(p) || seg.length === 0) {
      // A channel link. Reading it needs the official Data API behind the
      // owner-approved flag; until then the card says "Linked".
      return plan(u.toString(), "youtube", "youtube_channel", false, false, "Linked. We'll read their public videos once the YouTube connection is switched on.");
    }
    return plan(u.toString(), "youtube", "single_post", false, false, POLICY.youtube.why);
  }

  if (platform === "instagram") {
    if (/\/(p|reel|reels|tv)\//.test(p)) {
      return plan(u.toString(), "instagram", "single_post", false, false, POLICY.instagram.why);
    }
    return plan(u.toString(), "instagram", "social_profile", false, true, POLICY.instagram.why);
  }

  if (platform === "tiktok") {
    // vm./vt. share shortlinks always point at one video, not a profile.
    if (/^(vm|vt)\.tiktok\.com$/i.test(u.hostname) && seg.length === 1) {
      return plan(u.toString(), "tiktok", "single_post", false, false, POLICY.tiktok.why);
    }
    if (/\/video\/|\/photo\//.test(p) || /^\/@[^/]+\/[^/]+\/\d+/.test(p)) {
      return plan(u.toString(), "tiktok", "single_post", false, false, POLICY.tiktok.why);
    }
    return plan(u.toString(), "tiktok", "social_profile", false, true, POLICY.tiktok.why);
  }

  if (platform === "pinterest") {
    if (u.hostname.toLowerCase() === "pin.it" || /\/pin\//.test(p)) {
      return plan(u.toString(), "pinterest", "single_post", false, false, POLICY.pinterest.why);
    }
    return plan(u.toString(), "pinterest", "social_profile", false, true, POLICY.pinterest.why);
  }

  // facebook
  if (/\/(posts|permalink|photos|video|videos|share|story\.php|note)/.test(p) || /\/\d{6,}$/.test(p)) {
    return plan(u.toString(), "facebook", "single_post", false, false, POLICY.facebook.why);
  }
  return plan(u.toString(), "facebook", "social_profile", false, true, POLICY.facebook.why);
}

function plan(
  url: string,
  platform: Platform,
  kind: SourceKind,
  mayFetch: boolean,
  needsWebsite: boolean,
  note: string,
): LinkPlan {
  return { url, platform, kind, mayFetch, needsWebsite, note };
}

/** Split a pasted blob into individual links (whitespace / newline separated). */
export function splitLinks(pasted: string): string[] {
  return pasted
    .split(/\s+/)
    .map((s) => s.replace(/^[,;]+|[,;]+$/g, ""))
    .filter((s) => s !== "");
}
