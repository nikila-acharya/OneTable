/**
 * WP-2.7 — shared source-card types (pure module: safe to import from client
 * components; never imports the DB layer).
 */
import type { Platform, SourceKind } from "./platform";

export interface SourceCard {
  id: string;
  kind: SourceKind;
  platform: Platform;
  url: string;
  creatorName: string | null;
  /** §16.5 chip: kind drives colour + glyph, text is the plain-words state. */
  chip: { kind: "ok" | "info" | "warn" | "neutral"; text: string };
  /** CP04: the "add their website" prompt on a social profile card. */
  needsWebsite: boolean;
  websiteSourceId: string | null;
}

export interface AddOutcome {
  added: SourceCard[];
  /** Links the app refused, each with the plain-words reason (CP01 AC). */
  rejected: { link: string; reason: string }[];
  /** Website links that the caller should queue as CP01 background imports. */
  websiteUrls: string[];
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  website: "Website",
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  facebook: "Facebook",
};
