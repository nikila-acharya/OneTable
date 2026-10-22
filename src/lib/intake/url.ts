/**
 * CP01 intake: accept only public http(s) URLs. Refuses anything that could reach
 * a private network (SSRF): localhost, private/link-local IPs, credentials, odd ports.
 */
export const MAX_URL_LENGTH = 2048;

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

const PRIVATE_V4 = [
  /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

export function checkPublicUrl(input: unknown): UrlCheck {
  if (typeof input !== "string" || input.trim() === "") return { ok: false, reason: "That link is empty." };
  const raw = input.trim();
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: "That link is too long to use." };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "That does not look like a web link." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "Only web links (http or https) can be imported." };
  if (u.username || u.password) return { ok: false, reason: "Links with a login in them cannot be imported." };
  if (u.port && u.port !== "80" && u.port !== "443") return { ok: false, reason: "That link uses an unusual port, so it was not imported." };
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "That address is on a private network, so it cannot be imported." };
  }
  if (host === "[::1]" || host.startsWith("[fc") || host.startsWith("[fd") || host.startsWith("[fe80")) {
    return { ok: false, reason: "That address is on a private network, so it cannot be imported." };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && PRIVATE_V4.some((re) => re.test(host))) {
    return { ok: false, reason: "That address is on a private network, so it cannot be imported." };
  }
  u.hash = "";
  return { ok: true, url: u.toString() };
}
