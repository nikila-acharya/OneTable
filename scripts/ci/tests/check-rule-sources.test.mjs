// Self-tests for check-rule-sources.mjs — run with `npm test --prefix scripts/ci`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkRules } from "../check-rule-sources.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures");
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

test("valid single rule passes with zero errors", () => {
  const r = checkRules(path.join(FIX, "rules-ok"));
  assert.equal(r.fileCount, 1);
  assert.equal(r.ruleCount, 1);
  assert.deepEqual(r.errors, []);
});

test("top-level array shape is counted", () => {
  const r = checkRules(path.join(FIX, "rules-ok-array"));
  assert.equal(r.ruleCount, 2);
  assert.deepEqual(r.errors, []);
});

test("envelope { rules: [...] } shape is counted", () => {
  const r = checkRules(path.join(FIX, "rules-ok-envelope"));
  assert.equal(r.ruleCount, 1);
  assert.deepEqual(r.errors, []);
});

test("binding errors: missing source, missing name, missing url, bad url", () => {
  const r = checkRules(path.join(FIX, "rules-bad-missing-source"));
  assert.equal(r.errors.length, 4);
  const joined = r.errors.join("\n");
  assert.match(joined, /missing source\b/);
  assert.match(joined, /missing source\.name/);
  assert.match(joined, /missing source\.url/);
  assert.match(joined, /not a valid http\(s\) URL/);
});

test("unparsable YAML is an error, not a crash", () => {
  const r = checkRules(path.join(FIX, "rules-bad-yaml"));
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /YAML parse error/);
});

test("advisory schema gaps warn but do not fail the gate", () => {
  const r = checkRules(path.join(FIX, "rules-warn-advisory"));
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.length >= 4, `expected >=4 warnings, got ${r.warnings.length}`);
});

test("empty rules dir passes by default; --fail-if-empty fails it", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "onetable-rules-"));
  try {
    const r = checkRules(tmp);
    assert.deepEqual(r.errors, []);
    assert.equal(r.ruleCount, 0);
    const strict = checkRules(tmp, { failIfEmpty: true });
    assert.equal(strict.errors.length, 1);
    assert.match(strict.errors[0], /rule set is empty/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("repo smoke: the M0 rules/ dir (README only) passes", () => {
  const r = checkRules(path.join(REPO_ROOT, "rules"));
  assert.equal(r.fileCount, 0, "rules/ holds only README.md at M0");
  assert.deepEqual(r.errors, []);
});
