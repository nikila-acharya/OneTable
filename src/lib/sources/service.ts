/**
 * WP-2.7 — sources service (CP04 trusted creators + CP01 sources).
 *
 * Adding links is PURE DATABASE WORK for anything but a website: a social
 * profile link must not cause a single network request (PRD CP04 AC,
 * ADR-015). The caller (route) enqueues website imports separately.
 * Every read and write is scoped to the household (members-service pattern).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { recipe, source } from "../../../db/schema";
import type { Db } from "../db";
import { checkPublicUrl } from "../intake/url";
import { classifyLink, splitLinks, type LinkPlan, type Platform } from "./platform";
import type { AddOutcome, SourceCard } from "./cards";
import { isYoutubeReaderEnabled } from "./youtube";

export type { AddOutcome, SourceCard } from "./cards";

/** '@handle', page names and the first path segment make a decent creator label. */
export function deriveCreatorName(cls: LinkPlan): string | null {
  if (cls.platform === "website") return null;
  try {
    const u = new URL(cls.url);
    const segs = u.pathname.split("/").filter((s) => s !== "");
    const first = segs[0] ?? "";
    if (u.hostname === "youtu.be" && segs[0]) return decodeURIComponent(segs[0]);
    if (first.startsWith("@")) return decodeURIComponent(first.slice(1));
    if (first !== "" && !/^(p|reel|reels|tv|pin|posts|video|videos|watch|shorts|live|channel|user|c|story\.php|photo\.php|profile\.php|pages|share|permalink)$/i.test(first)) {
      return decodeURIComponent(first);
    }
    return null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Paste box contents -> one classification and one row per link.
 * Unknown text that is not a link is rejected in plain words; nothing is
 * fetched here (the route enqueues website imports afterwards).
 */
export async function addLinks(db: Db, householdId: string, pasted: string): Promise<AddOutcome> {
  const links = splitLinks(pasted);
  if (links.length === 0) return { added: [], rejected: [], websiteUrls: [] };

  const wanted = links.map((l) => normalizeOr(l)).filter((x): x is string => x !== null);
  const existing = await db
    .select({ url: source.url })
    .from(source)
    .where(and(eq(source.householdId, householdId), inArray(source.url, wanted)));
  const already = new Set(existing.map((e) => e.url));

  const added: SourceCard[] = [];
  const rejected: { link: string; reason: string }[] = [];
  const websiteUrls: string[] = [];

  for (const raw of links) {
    const norm = normalizeOr(raw);
    if (norm === null) {
      rejected.push({ link: raw, reason: "That does not look like a web link." });
      continue;
    }
    const check = checkPublicUrl(norm);
    if (!check.ok) {
      rejected.push({ link: raw, reason: check.reason });
      continue;
    }
    if (already.has(check.url)) {
      rejected.push({ link: raw, reason: "You already saved that link." });
      continue;
    }
    const cls = classifyLink(check.url);
    const [row] = await db
      .insert(source)
      .values({
        householdId,
        kind: cls.kind,
        platform: cls.platform,
        url: cls.url,
        creatorName: deriveCreatorName(cls),
        status: "active",
      })
      .returning();
    already.add(cls.url);
    if (cls.kind === "website") websiteUrls.push(cls.url);
    added.push(cardFromRow(row, new Map(), null, false));
  }
  return { added, rejected, websiteUrls };
}

/** "Add their website" (CP04): links a website source to the profile card. */
export async function linkWebsite(
  db: Db,
  householdId: string,
  profileSourceId: string,
  websiteInput: string,
): Promise<{ ok: true; card: SourceCard; websiteUrl: string } | { ok: false; reason: string }> {
  const [profile] = await db
    .select()
    .from(source)
    .where(and(eq(source.id, profileSourceId), eq(source.householdId, householdId)));
  if (!profile) return { ok: false, reason: "not_found" };

  const check = checkPublicUrl(websiteInput);
  if (!check.ok) return { ok: false, reason: check.reason };
  const cls = classifyLink(check.url);
  if (cls.kind !== "website") {
    return { ok: false, reason: "Please paste the creator's own website or blog link — not another social link." };
  }

  const [row] = await db
    .insert(source)
    .values({
      householdId,
      kind: "website",
      platform: "website",
      url: cls.url,
      creatorName: profile.creatorName,
      status: "active",
    })
    .returning();
  await db
    .update(source)
    .set({ linkedWebsiteSourceId: row.id })
    .where(and(eq(source.id, profileSourceId), eq(source.householdId, householdId)));
  return { ok: true, card: cardFromRow(row, new Map(), null, false), websiteUrl: cls.url };
}

/** All sources for the household with §16.5 live status chips. */
export async function listSources(db: Db, householdId: string): Promise<SourceCard[]> {
  const rows = await db.select().from(source).where(eq(source.householdId, householdId));
  if (rows.length === 0) return [];

  // grouped count, joined in code (correlated subqueries misbehave in drizzle here)
  const counts = await db
    .select({ domain: recipe.sourceDomain, n: sql<number>`count(*)::int` })
    .from(recipe)
    .where(and(eq(recipe.householdId, householdId), inArray(recipe.sourceDomain, rows.map((r) => hostOf(r.url)).filter((h) => h !== ""))))
    .groupBy(recipe.sourceDomain);
  const byDomain = new Map(counts.map((c) => [c.domain ?? "", c.n]));

  return rows.map((r) => cardFromRow(r, byDomain, rows, isYoutubeReaderEnabled()));
}

function cardFromRow(
  r: typeof source.$inferSelect,
  byDomain: Map<string, number>,
  allRows: (typeof source.$inferSelect)[] | null,
  ytReaderOn: boolean,
): SourceCard {
  const count = byDomain.get(hostOf(r.url)) ?? 0;
  let chip: SourceCard["chip"];
  let needsWebsite = false;
  const websiteSourceId = r.linkedWebsiteSourceId ?? null;

  if (r.kind === "website") {
    chip = count > 0 ? { kind: "ok", text: `${count} recipe${count === 1 ? "" : "s"} added` } : { kind: "info", text: "Importing recipes…" };
  } else if (r.kind === "youtube_channel") {
    chip = ytReaderOn ? { kind: "info", text: "Reading public videos…" } : { kind: "neutral", text: "Linked" };
  } else if (r.kind === "social_profile") {
    let linkedCount = 0;
    if (websiteSourceId && allRows) {
      const linked = allRows.find((x) => x.id === websiteSourceId);
      if (linked) linkedCount = byDomain.get(hostOf(linked.url)) ?? 0;
    }
    if (websiteSourceId && linkedCount > 0) {
      chip = { kind: "ok", text: `${linkedCount} recipe${linkedCount === 1 ? "" : "s"} added` };
    } else if (websiteSourceId) {
      chip = { kind: "info", text: "Importing recipes…" };
    } else {
      chip = { kind: "neutral", text: "Linked — share posts to add recipes" };
      needsWebsite = true;
    }
  } else {
    // single_post
    chip = { kind: "neutral", text: "Saved — open it to add the recipe" };
  }

  return {
    id: r.id,
    kind: r.kind,
    platform: r.platform as Platform, // stored as text; the enum lives in platform.ts
    url: r.url,
    creatorName: r.creatorName,
    chip,
    needsWebsite,
    websiteSourceId,
  };
}

function normalizeOr(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}
