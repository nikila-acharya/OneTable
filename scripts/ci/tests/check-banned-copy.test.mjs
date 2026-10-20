// Self-tests for check-banned-copy.mjs — run with `npm test --prefix scripts/ci`.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTermRegex, checkBannedCopy, extractUnits } from "../check-banned-copy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures");

test("term regex: word boundary, case-insensitive, plain plural; not substring", () => {
  assert.match("Treats illness", buildTermRegex("treat"));
  assert.match("it is a cure", buildTermRegex("cure"));
  assert.match("cures", buildTermRegex("cure"));
  assert.doesNotMatch("a treatment plan", buildTermRegex("treat"));
  assert.doesNotMatch("secure the server", buildTermRegex("cure"));
});

test("phrase regex: flexible inner whitespace, boundary-anchored", () => {
  assert.match("CHEAT   MEAL", buildTermRegex("cheat meal"));
  assert.match("Burn off calories", buildTermRegex("burn off"));
  assert.doesNotMatch("fireburn off calories", buildTermRegex("burn off"));
  assert.doesNotMatch("a cheat meals club", buildTermRegex("cheat meal")); // plural only for single words
});

test("extractUnits: strings + JSX text are units; comments are not", () => {
  const src = [
    '// treat this comment as safe',
    'const a = "guilt-free dinners";',
    'const b = <p>Cheat meal ideas</p>;',
    '/* cure claims in a block comment */',
  ].join("\n");
  const { units } = extractUnits(src);
  const texts = units.map((u) => u.text);
  assert.ok(texts.includes("guilt-free dinners"));
  assert.ok(texts.includes("Cheat meal ideas"));
  assert.ok(!texts.some((t) => t.includes("treat this comment")));
  assert.ok(!texts.some((t) => t.includes("cure claims")));
});

test("extractUnits: regex literals with quotes do not confuse the scanner", () => {
  const src = 'const re = /["\']/g;\nconst after = "burn off the toast";';
  const { units } = extractUnits(src);
  assert.ok(units.some((u) => u.text === "burn off the toast"));
});

test("fixture scan: exactly the planted hits, clean files stay clean", () => {
  const res = checkBannedCopy({
    configPath: path.join(FIX, "copy", "config.json"),
    root: path.join(FIX, "copy"),
  });
  assert.equal(res.findings.length, 4, JSON.stringify(res.findings, null, 2));
  const terms = res.findings.map((f) => f.term).sort();
  assert.deepEqual(terms, ["burn off", "cheat meal", "guilt-free", "treat"]);
  for (const f of res.findings) {
    assert.match(f.file, /Home\.tsx$/);
    assert.ok(f.line >= 1);
  }
});

test("allow-pragma suppresses the line it sits on", () => {
  const res = checkBannedCopy({
    configPath: path.join(FIX, "copy", "config.json"),
    root: path.join(FIX, "copy"),
  });
  const cleanFile = path.join(FIX, "copy", "app", "clean.ts");
  assert.ok(!res.findings.some((f) => f.file === cleanFile));
  // sanity: clean.ts really does contain the string "treat" + pragma
  const { units } = extractUnits(
    // same content the fixture file carries for that line
    'const msg = "treat"; // banned-copy-allow: internal engineering term'
  );
  assert.ok(units.some((u) => u.text === "treat"));
});

test("TS generics and comparisons are not mistaken for JSX text", () => {
  const res = checkBannedCopy({
    configPath: path.join(FIX, "copy", "config.json"),
    root: path.join(FIX, "copy"),
  });
  assert.ok(!res.findings.some((f) => /types\.ts$/.test(f.file)));
});

test("repo smoke: M0 tree (no app/ yet) passes with scope notice", () => {
  const res = checkBannedCopy();
  assert.deepEqual(res.findings, []);
  assert.ok(res.scopesMissing.length >= 1, "app/ and components/ do not exist at M0");
  assert.ok(res.termCount > 0);
});
