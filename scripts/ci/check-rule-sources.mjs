#!/usr/bin/env node
// check-rule-sources.mjs — WP-0.3 rule-source CI check (PRD 6.2, TR-RULES).
//
// Binding rule: "A CI test fails if any rule lacks `source.name` and `source.url`."
// Everything else in the rule schema is reported as a warning, not an error,
// so the check stays aligned with the PRD and does not invent extra gates.
//
// Usage:
//   node scripts/ci/check-rule-sources.mjs [rulesDir] [--fail-if-empty]
//
//   rulesDir        defaults to <repo root>/rules (anchored to this file,
//                   so `npm run` works from any cwd)
//   --fail-if-empty exit 1 when zero rule files exist (enable once M3 ships
//                   real rules; at M0 the rule set is intentionally empty)
//
// Supported file shapes (all parsed from YAML):
//   - a single rule mapping:  { id: ..., source: { name: ..., url: ... } }
//   - a sequence of rules:    [ {...}, {...} ]
//   - an envelope:            { rules: [ {...}, ... ] }
//
// Cross-platform: plain Node ESM, no shell assumptions (PRD 10.1: must work
// in PowerShell via `npm run check:rules`).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

const RULE_TYPES = new Set(["hard", "soft", "banner"]);

function parseArgs(argv) {
  const args = { rulesDir: path.join(REPO_ROOT, "rules"), failIfEmpty: false };
  for (const a of argv) {
    if (a === "--fail-if-empty") args.failIfEmpty = true;
    else if (!a.startsWith("-")) args.rulesDir = path.resolve(process.cwd(), a);
  }
  return args;
}

function findRuleFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        stack.push(full);
      } else if (/\.ya?ml$/i.test(entry.name)) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

function* extractRules(doc) {
  if (doc == null) return;
  if (Array.isArray(doc)) {
    for (const r of doc) if (r && typeof r === "object") yield r;
    return;
  }
  if (typeof doc === "object") {
    if (Array.isArray(doc.rules)) {
      for (const r of doc.rules) if (r && typeof r === "object") yield r;
      return;
    }
    yield doc;
  }
}

function checkRule(rule, fileLabel, errors, warnings) {
  const id = typeof rule.id === "string" && rule.id.trim() ? rule.id.trim() : "(missing id)";
  const where = `${fileLabel} :: ${id}`;

  // Binding (PRD 6.2): source.name and source.url are required.
  const source = rule.source;
  if (!source || typeof source !== "object") {
    errors.push(`${where}: missing source (rule needs source.name and source.url)`);
  } else {
    const name = typeof source.name === "string" ? source.name.trim() : "";
    const url = typeof source.url === "string" ? source.url.trim() : "";
    if (!name) errors.push(`${where}: missing source.name`);
    if (!url) errors.push(`${where}: missing source.url`);
    else if (!/^https?:\/\/\S+$/i.test(url)) errors.push(`${where}: source.url is not a valid http(s) URL: ${url}`);
  }

  // Advisory checks — warnings only, so the gate stays exactly what PRD 6.2 states.
  if (!(typeof rule.id === "string" && rule.id.trim())) warnings.push(`${where}: no id`);
  if (!(typeof rule.description === "string" && rule.description.trim())) warnings.push(`${where}: no description`);
  if (!(typeof rule.check === "string" && rule.check.trim())) warnings.push(`${where}: no check expression`);
  if (rule.type !== undefined && !RULE_TYPES.has(rule.type)) {
    warnings.push(`${where}: type "${rule.type}" is not one of hard|soft|banner`);
  } else if (rule.type === undefined) {
    warnings.push(`${where}: no type (hard|soft|banner)`);
  }
  if (rule.applies_to === undefined) warnings.push(`${where}: no applies_to`);
  if (rule.confidence === undefined) warnings.push(`${where}: no confidence (Certain|Likely|Guessing)`);
  if (!("reviewed_by" in rule) || !("reviewed_on" in rule)) {
    warnings.push(`${where}: reviewed_by/reviewed_on fields not present (use null until RD review)`);
  }
}

export function checkRules(rulesDir, { failIfEmpty = false } = {}) {
  const errors = [];
  const warnings = [];
  const files = findRuleFiles(rulesDir);
  let ruleCount = 0;

  for (const file of files) {
    const label = file;
    let doc;
    try {
      const text = fs.readFileSync(file, "utf8");
      doc = YAML.parse(text, { duplicateKeys: "error" });
    } catch (err) {
      errors.push(`${label}: YAML parse error: ${String(err.message || err).split("\n")[0]}`);
      continue;
    }
    let n = 0;
    for (const rule of extractRules(doc)) {
      n += 1;
      checkRule(rule, label, errors, warnings);
    }
    if (n === 0) warnings.push(`${label}: YAML parsed but contains no rule objects`);
    ruleCount += n;
  }

  if (ruleCount === 0 && failIfEmpty) {
    errors.push(`${rulesDir}: rule set is empty (CI was invoked with --fail-if-empty)`);
  }

  return { errors, warnings, ruleCount, fileCount: files.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { errors, warnings, ruleCount, fileCount } = checkRules(args.rulesDir, {
    failIfEmpty: args.failIfEmpty,
  });

  console.log(`check-rule-sources: ${fileCount} file(s), ${ruleCount} rule(s) under "${args.rulesDir}"`);
  for (const w of warnings) console.log(`  WARN  ${w}`);
  for (const e of errors) console.log(`  ERROR ${e}`);
  if (errors.length > 0) {
    console.log(`FAIL: ${errors.length} error(s). Every rule must cite source.name and source.url (PRD 6.2).`);
    process.exitCode = 1;
  } else {
    console.log(`OK: ${ruleCount} rule(s) pass the source check${ruleCount === 0 ? " (empty rule set is expected until M3)" : ""}.`);
  }
}

// Run as CLI only when invoked directly (importable from tests).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
