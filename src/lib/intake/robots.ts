/**
 * robots.txt for CP01. Honors the group for our User-Agent, else the '*' group.
 * Longest matching rule wins; Allow beats Disallow on a tie (RFC 9309 style).
 */
export const BOT_NAME = "OneTableBot";
export const USER_AGENT = `${BOT_NAME}/0.1 (+https://github.com/nikila-acharya/OneTable; recipe import for one household)`;

export interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelaySeconds: number | null;
}

function pathPattern(p: string): RegExp {
  const esc = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const anchored = esc.endsWith("\\$") ? esc.slice(0, -2) + "$" : esc;
  return new RegExp("^" + anchored);
}

export function parseRobots(text: string, botName = BOT_NAME): RobotsRules {
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let current: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) { lastWasAgent = false; continue; }
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [], crawlDelaySeconds: null } };
        groups.push(current);
      }
      current.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && val) current.rules.allow.push(val);
    else if (key === "disallow" && val) current.rules.disallow.push(val);
    else if (key === "crawl-delay") {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 0) current.rules.crawlDelaySeconds = n;
    }
  }
  const mine = botName.toLowerCase();
  const specific = groups.find((g) => g.agents.some((a) => a !== "*" && mine.includes(a)));
  const star = groups.find((g) => g.agents.includes("*"));
  const g = specific ?? star;
  return g ? g.rules : { allow: [], disallow: [], crawlDelaySeconds: null };
}

/** True if the path (with query) may be fetched under these rules. */
export function isAllowed(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  for (const p of rules.disallow) {
    if (pathPattern(p).test(pathAndQuery) && (!best || p.length > best.len)) best = { len: p.length, allow: false };
  }
  for (const p of rules.allow) {
    if (pathPattern(p).test(pathAndQuery)) {
      if (!best || p.length >= best.len) best = { len: p.length, allow: true };
    }
  }
  return best ? best.allow : true;
}
