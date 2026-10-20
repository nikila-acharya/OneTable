#!/usr/bin/env node
// check-banned-copy.mjs — WP-0.3 banned-copy CI check (PRD 6.4 FDA general-
// wellness line; PRD 7.3 diet-culture terms).
//
// Binding rule (PRD 6.4): "Copy containing terms like 'manage your diabetes',
// 'treat' or 'cure' fails a lint check (a list of banned UI-copy terms)."
// PRD 7.3 check #1 applies the same list to every agent message at runtime:
// the M4 Safety Guardian imports config/banned-copy-terms.json from here, so
// CI and the message guard share one list.
//
// Usage:
//   node scripts/ci/check-banned-copy.mjs [--config <path>] [--root <path>]
//
//   --config  defaults to <repo root>/config/banned-copy-terms.json
//   --root    repo root used to resolve config "scopes" (defaults to this repo)
//
// What is scanned: user-facing copy only — string literals (single, double,
// template) and JSX text nodes under the config "scopes" directories.
// Comments, identifiers and non-copy trees (docs/, rules/) are not scanned;
// rules/ is internal clinical spec, not UI copy. If a scope directory does
// not exist yet (M0, before the WP-0.1 scaffold merges), the check passes
// with a notice.
//
// Matching: case-insensitive, word-boundary; single-word terms also match a
// plain plural ("treats", "cures"); phrase terms match with flexible inner
// whitespace ("CHEAT   MEAL" is a hit). Put `banned-copy-allow` on the line
// to suppress a documented false positive — use sparingly; the term list is
// owner/Safety-approved (PRD 13.3), not a per-build edit.
//
// Cross-platform: plain Node ESM, no shell assumptions (PRD 10.1).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

const ALLOW_PRAGMA = "banned-copy-allow";
const DEFAULT_CONFIG = path.join(REPO_ROOT, "config", "banned-copy-terms.json");

function parseArgs(argv) {
  const args = { configPath: DEFAULT_CONFIG, root: REPO_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--config") args.configPath = path.resolve(process.cwd(), argv[++i]);
    else if (a === "--root") args.root = path.resolve(process.cwd(), argv[++i]);
    else if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
  }
  return args;
}

function loadConfig(configPath) {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const terms = (raw.terms ?? [])
    .map((t) => (typeof t === "string" ? { term: t, note: "" } : { term: String(t.term ?? ""), note: String(t.note ?? "") }))
    .filter((t) => t.term.trim() !== "");
  return {
    terms,
    scopes: Array.isArray(raw.scopes) && raw.scopes.length > 0 ? raw.scopes : ["app", "components"],
    fileExtensions: Array.isArray(raw.fileExtensions) ? raw.fileExtensions : [".ts", ".tsx", ".js", ".jsx"],
    ignoreDirs: Array.isArray(raw.ignoreDirs)
      ? raw.ignoreDirs
      : ["node_modules", ".next", ".git", "dist", "build", "coverage"],
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildTermRegex(term) {
  const body = term.trim().split(/\s+/).map(escapeRe).join("\\s+");
  const singleWord = !/\s/.test(term.trim());
  const tail = singleWord ? "s?\\b" : "\\b";
  return new RegExp(`\\b${body}${tail}`, "i");
}

// ---------------------------------------------------------------------------
// Extraction. Pass 1 tokenizes strings/comments/regex literals and emits:
//   units  — [{ start, end, text }] every string/template literal
//   masked — same length as src, comments + string contents blanked to
//            spaces (newlines kept), so pass 2 can read JSX text off it.
// ---------------------------------------------------------------------------

const REGEX_PRECEDERS = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", "~", "+", "-", "*", "%", "<", ">", "^"]);

export function extractUnits(src) {
  const units = [];
  const maskedChars = [];
  let prevSig = "";
  let i = 0;

  const blankRun = (from, to) => {
    for (let k = from; k < to; k += 1) maskedChars.push(src[k] === "\n" ? "\n" : " ");
  };

  while (i < src.length) {
    const c = src[i];

    if (c === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < src.length && src[j] !== "\n") j += 1;
      blankRun(i, j); i = j; continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j += 1;
      j = Math.min(j + 2, src.length);
      blankRun(i, j); i = j; continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const start = i + 1;
      let content = "";
      maskedChars.push(" "); i += 1;
      while (i < src.length) {
        const d = src[i];
        if (d === "\\") {
          content += d + (src[i + 1] ?? "");
          maskedChars.push(" "); if (src[i + 1] !== undefined) maskedChars.push(src[i + 1] === "\n" ? "\n" : " ");
          i += 2; continue;
        }
        if (d === "\n") {
          if (quote === "`") { content += "\n"; maskedChars.push("\n"); i += 1; continue; }
          break; // unterminated string: stop at EOL
        }
        if (d === quote) { maskedChars.push(" "); i += 1; break; }
        content += d; maskedChars.push(" "); i += 1;
      }
      if (content.trim() !== "") units.push({ start, end: i, text: content });
      prevSig = quote;
      continue;
    }
    if (c === "/" && (prevSig === "" || REGEX_PRECEDERS.has(prevSig))) {
      let j = i + 1; let inClass = false; let ok = false;
      while (j < src.length) {
        const d = src[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break;
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) { ok = true; j += 1; break; }
        j += 1;
      }
      if (ok) {
        while (j < src.length && /[dgimsuvy]/.test(src[j])) j += 1;
        blankRun(i, j); i = j; prevSig = "/"; continue;
      }
    }
    maskedChars.push(c);
    if (!/\s/.test(c)) prevSig = c;
    i += 1;
  }

  const masked = maskedChars.join("");
  // Pass 2: JSX text nodes, appended to the same units array.
  extractJsxText(masked, units);
  return { units, masked };
}

// Characters that cannot begin a JSX text node (operators/punctuation that
// mean "this is code", e.g. the `(` in `foo<T>(x)` or the `:` in
// `Record<string, unknown>: T`).
const NOT_TEXT_START = new Set(["(", ")", ",", ";", ":", "=", "&", "|", "!", "?", "}", "[", "]", "+", "-", "*", "/", "<", ">", "'", '"', "`", "#", "@", "."]);

function extractJsxText(masked, units) {
  const n = masked.length;
  let i = 0;
  while (i < n) {
    if (masked[i] !== "<") { i += 1; continue; }
    const next = masked[i + 1] ?? "";
    if (!/[/A-Za-z]/.test(next)) { i += 1; continue; }
    let j = i + 1;
    const closingTag = masked[j] === "/";
    if (closingTag) j += 1;
    if (!/[A-Za-z]/.test(masked[j] ?? "")) { i += 1; continue; }
    while (j < n && /[A-Za-z0-9_.:-]/.test(masked[j])) j += 1; // tag name
    let depth = 0; let bad = false;
    while (j < n) {
      const d = masked[j];
      if (d === "{") { depth += 1; j += 1; continue; }
      if (d === "}") { depth -= 1; j += 1; continue; }
      if (depth === 0 && d === "<") { bad = true; break; } // new '<' before '>' closes: not a tag (comparison)
      if (depth === 0 && d === ">") { j += 1; break; }
      j += 1;
    }
    if (bad || j > n || j <= i || masked[j - 1] !== ">") { i += 1; continue; }
    i = j; // position just past `>`

    // Candidate text node from i until the next `<` or `{` (expression).
    // Parentheses may appear inside real copy ("Cheat meal (friday)"), so
    // they are not reject chars — only code-ish starts and punctuation are.
    let k = i;
    while (k < n && masked[k] !== "<" && masked[k] !== "{") k += 1;
    const raw = masked.slice(i, k);
    const trimmed = raw.trim();
    const firstChar = trimmed[0] ?? "";
    const newlines = (raw.match(/\n/g) ?? []).length;
    if (
      trimmed !== "" &&
      !NOT_TEXT_START.has(firstChar) &&
      /[A-Za-z\u00C0-\uFFFF]/.test(trimmed) &&
      newlines <= 2 &&
      !/[;=[\]{}]/.test(raw)
    ) {
      const lead = raw.length - raw.trimStart().length;
      units.push({ start: i + lead, end: i + lead + trimmed.length, text: trimmed });
    }
  }
}

function lineStartTable(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineAt(starts, idx) {
  let lo = 0; let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= idx) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

function listFiles(dir, exts, ignoreDirs) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        if (ignoreDirs.includes(entry.name) || entry.name.startsWith(".")) continue;
        stack.push(full);
      } else if (exts.some((e) => entry.name.toLowerCase().endsWith(e.toLowerCase()))) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

export function checkBannedCopy({ configPath = DEFAULT_CONFIG, root = REPO_ROOT } = {}) {
  const cfg = loadConfig(configPath);
  const regexes = cfg.terms.map((t) => ({ ...t, re: buildTermRegex(t.term) }));
  const findings = [];
  let scannedCount = 0;

  const existingScopes = cfg.scopes.filter((s) => fs.existsSync(path.resolve(root, s)));

  for (const scope of existingScopes) {
    for (const file of listFiles(path.resolve(root, scope), cfg.fileExtensions, cfg.ignoreDirs)) {
      scannedCount += 1;
      let src;
      try { src = fs.readFileSync(file, "utf8"); } catch { continue; }
      const starts = lineStartTable(src);
      const { units } = extractUnits(src);
      const srcLines = src.split("\n");
      for (const u of units) {
        const line = lineAt(starts, u.start);
        if ((srcLines[line - 1] ?? "").includes(ALLOW_PRAGMA)) continue;
        for (const { term, note, re } of regexes) {
          re.lastIndex = 0;
          if (re.test(u.text)) {
            findings.push({ file, line, term, note, text: u.text.trim().replace(/\s+/g, " ").slice(0, 120) });
            break; // one finding per unit is enough
          }
        }
      }
    }
  }
  return {
    findings,
    scannedCount,
    termCount: regexes.length,
    scopesMissing: cfg.scopes.filter((s) => !existingScopes.includes(s)),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let res;
  try {
    res = checkBannedCopy(args);
  } catch (err) {
    console.log(`ERROR banned-copy: cannot run check: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`check-banned-copy: ${res.scannedCount} file(s) scanned against ${res.termCount} term(s)`);
  if (res.scopesMissing.length > 0) {
    console.log(`  NOTE  scope dir(s) not present yet: ${res.scopesMissing.join(", ")} (expected at M0)`);
  }
  if (res.scannedCount === 0) {
    console.log("  NOTE  no copy files found — the check passes vacuously until the app tree exists.");
  }
  for (const f of res.findings) {
    console.log(`  ERROR ${f.file}:${f.line} — banned term "${f.term}"${f.note ? ` (${f.note})` : ""} in copy: ${f.text}`);
  }
  if (res.findings.length > 0) {
    console.log(`FAIL: ${res.findings.length} banned-copy hit(s). UI copy must stay on the FDA general-wellness line (PRD 6.4, 7.3).`);
    process.exitCode = 1;
  } else {
    console.log("OK: no banned copy terms found.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
