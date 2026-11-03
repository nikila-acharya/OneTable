/**
 * WP-2.7 — the YouTube reader flag (ADR-015 rule 4).
 *
 * Reading a trusted creator's public videos needs the OFFICIAL YouTube Data
 * API, and turning it on is an owner decision (PRD 13.3): it creates an
 * external account (Google Cloud project + API key). Until the owner
 * approves ADR-015 and the key exists, the flag is off: the channel card
 * stays "Linked" and the reader refuses to run. Fail-safe: only the exact
 * value "on" enables anything.
 */
export const YOUTUBE_FLAG_ENV = "YOUTUBE_READER_ENABLED";

export function isYoutubeReaderEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[YOUTUBE_FLAG_ENV] === "on";
}

/**
 * The seam where the Data API call will live once the owner turns the flag
 * on (playlistItems for the channel's uploads, then videos.list for titles
 * and descriptions; recipe mentions and blog links come from the
 * description text). Nothing here fetches anything while the flag is off.
 */
export async function readChannelVideos(): Promise<never> {
  throw new Error(
    "The YouTube reader is not enabled: ADR-015 must be approved by the owner and YOUTUBE_READER_ENABLED=on with an API key first.",
  );
}
