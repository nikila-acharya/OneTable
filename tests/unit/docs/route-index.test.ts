/**
 * docs/API-REFERENCE.md used to open with "documents the routes that exist in
 * src/app/**\/route.ts" while listing 9 of 23 - a claim that read as coverage and
 * was a growing gap. This guard makes the index either complete or red, which is
 * the same trick already used for Auth.js `pages.*` vs real route files.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const API_DIR = join(ROOT, "src", "app", "api");
const DOC = join(ROOT, "docs", "API-REFERENCE.md");

function routePaths(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (readdirSync(full).includes("route.ts")) {
      acc.push("/" + relative(join(ROOT, "src", "app"), full).split(sep).join("/"));
    }
    routePaths(full, acc);
  }
  return acc;
}

describe("API reference route index", () => {
  const onDisk = routePaths(API_DIR).sort();
  // Repo files are CRLF on disk; a slice on \n leaves \r and silently breaks
  // every column match, so normalise before parsing.
  const text = readFileSync(DOC, "utf8").replace(/\r\n/g, "\n");
  const indexed = [...text.matchAll(/^\| `(\/api\/[^`]+)` \| ([^|]+)\| ([^|]+)\|/gm)].map((m) => ({
    path: m[1]!,
    methods: m[2]!.trim(),
    documented: m[3]!.trim(),
  }));

  it("finds the handlers at all (a vacuous pass is worse than none)", () => {
    expect(onDisk.length).toBeGreaterThanOrEqual(20);
    expect(indexed.length).toBeGreaterThan(0);
  });

  it("indexes every route file that exists", () => {
    const listed = indexed.map((i) => i.path).sort();
    const missing = onDisk.filter((p) => !listed.includes(p));
    expect(missing, `undocumented routes: ${missing.join(", ")}`).toEqual([]);
  });

  it("lists no route that has been deleted or renamed", () => {
    const stale = indexed.map((i) => i.path).filter((p) => !onDisk.includes(p));
    expect(stale, `index names routes that no longer exist: ${stale.join(", ")}`).toEqual([]);
  });

  it("records at least one HTTP verb for every row but the Auth.js catch-all", () => {
    for (const row of indexed) {
      if (row.path.includes("[...nextauth]")) continue;
      expect(/GET|POST|PATCH|PUT|DELETE/.test(row.methods), row.path).toBe(true);
    }
  });

  it("only says a route has prose below when a section for it actually exists", () => {
    // The third column is a promise. Without this check the index could quietly
    // keep claiming coverage for sections that were edited away.
    const claimed = indexed.filter((i) => i.documented.startsWith("yes"));
    expect(claimed.length).toBeGreaterThan(0);
    for (const i of claimed) {
      expect(text, `index promises prose for ${i.path} but no heading exists`).toMatch(
        new RegExp(`^## [A-Z, ]*${i.path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`, "m"),
      );
    }
    // and anything with a real section should not be marked "no"
    for (const i of indexed.filter((x) => x.documented === "no")) {
      expect(text, `${i.path} has a section but the index says "no"`).not.toMatch(
        new RegExp(`^## [A-Z, ]*${i.path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`, "m"),
      );
    }
  });
});
