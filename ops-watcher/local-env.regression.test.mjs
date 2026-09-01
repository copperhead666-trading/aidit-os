// ops-watcher/local-env.regression.test.mjs
// Offline regression tests for ops-watcher/local-env.mjs.
//
//   node ops-watcher/local-env.regression.test.mjs
//
// House style: node:assert/strict, local counter, final
// "REGRESSION RESULT: N passed, M failed", no node:test, no dependencies.
// The injected fs NEVER touches the real <repoRoot>/.env.local.

import assert from "node:assert/strict";
import { parseEnvFile, loadLocalEnv, describeSecretPresence } from "./local-env.mjs";

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(`       ${e && e.stack ? e.stack : e}`);
  failures.push(n);
  failed++;
};

// A fake fs that maps a file path -> file body. Throws ENOENT for unknown paths
// exactly like node:fs.readFileSync would. NEVER points at the real .env.local.
function fakeFs(files) {
  const map = new Map(Object.entries(files));
  return {
    readFileSync(p, enc) {
      if (map.has(p)) return map.get(p);
      const err = new Error(`ENOENT: no such file or directory, open '${p}'`);
      err.code = "ENOENT";
      throw err;
    },
  };
}

const SECRET = "super-secret-token-value-DO-NOT-LEAK-1234567890";
const SAFE_FILE = "test-fixture.env.local"; // an arbitrary, clearly-non-real path

function testParseEnvFileShapes() {
  const name = "(1) parseEnvFile handles quoted, unquoted, export, comments, blank, CRLF, KEY=a=b";
  try {
    const text = [
      "# a leading comment",
      "",
      "PLAIN=hello",
      "export EXPORTED=world",
      "DQUOTE=\"double value\"",
      "SQUOTE='single value'",
      "  SPACED  =  spaced value  ",
      "EQINSIDE=a=b=c",
      "CRLFLINE=crval\r\n",
    ].join("\n");
    const out = parseEnvFile(text);
    assert.equal(out.PLAIN, "hello");
    assert.equal(out.EXPORTED, "world");
    assert.equal(out.DQUOTE, "double value");
    assert.equal(out.SQUOTE, "single value");
    assert.equal(out.SPACED, "spaced value");
    assert.equal(out.EQINSIDE, "a=b=c");
    assert.equal(out.CRLFLINE, "crval");
    // Comments and blank lines do not become keys.
    assert.equal(Object.prototype.hasOwnProperty.call(out, ""), false);
    ok(name);
  } catch (e) { bad(name, e); }
}

function testParseEnvFileIgnoresMalformed() {
  const name = "(2) parseEnvFile ignores malformed lines without throwing";
  try {
    const text = [
      "no_equals_here",
      "=no_key",
      "1BADKEY=starts_with_digit",
      "HAS-DASH=value",
      "GOOD=ok",
      "   ",
      "## pure comment",
    ].join("\n");
    const out = parseEnvFile(text);
    assert.equal(out.GOOD, "ok");
    assert.equal(Object.keys(out).length, 1);
    // Should not throw on garbage input either.
    assert.doesNotThrow(() => parseEnvFile("%%%///\n===\n"));
    ok(name);
  } catch (e) { bad(name, e); }
}

function testLoadLocalEnvPrefersEnvOverFile() {
  const name = "(3) loadLocalEnv prefers an existing env value over the file value";
  try {
    const env = { NOTION_TOKEN: "from-env-wins" };
    const _fs = fakeFs({ [SAFE_FILE]: `NOTION_TOKEN=${SECRET}\nNOTION_PARENT_PAGE_ID=page-from-file\n` });
    const res = loadLocalEnv(["NOTION_TOKEN", "NOTION_PARENT_PAGE_ID"], {
      file: SAFE_FILE,
      env,
      _fs,
    });
    assert.equal(res.found.NOTION_TOKEN, true);
    assert.equal(res.values.NOTION_TOKEN, "from-env-wins");
    assert.equal(res.found.NOTION_PARENT_PAGE_ID, true);
    assert.equal(res.values.NOTION_PARENT_PAGE_ID, "page-from-file");
    ok(name);
  } catch (e) { bad(name, e); }
}

function testLoadLocalEnvMissingFileAllFalseNoThrow() {
  const name = "(4) loadLocalEnv on a missing file returns all-false and does not throw";
  try {
    const env = {};
    const _fs = fakeFs({}); // no files
    let res;
    assert.doesNotThrow(() => {
      res = loadLocalEnv(["NOTION_TOKEN", "NOTION_PARENT_PAGE_ID"], {
        file: "does-not-exist.env.local",
        env,
        _fs,
      });
    });
    assert.equal(res.found.NOTION_TOKEN, false);
    assert.equal(res.found.NOTION_PARENT_PAGE_ID, false);
    assert.equal(res.values.NOTION_TOKEN, "");
    assert.equal(res.values.NOTION_PARENT_PAGE_ID, "");
    ok(name);
  } catch (e) { bad(name, e); }
}

function testLoadLocalEnvDoesNotMutateEnv() {
  const name = "(5) loadLocalEnv never mutates the passed env object";
  try {
    const env = { NOTION_TOKEN: "already-set" };
    const envKeysBefore = Object.keys(env).slice().sort();
    const _fs = fakeFs({ [SAFE_FILE]: `NOTION_TOKEN=${SECRET}\nNOTION_PARENT_PAGE_ID=page\n` });
    const res = loadLocalEnv(["NOTION_TOKEN", "NOTION_PARENT_PAGE_ID"], {
      file: SAFE_FILE,
      env,
      _fs,
    });
    const envKeysAfter = Object.keys(env).slice().sort();
    assert.deepEqual(envKeysAfter, envKeysBefore);
    assert.equal(env.NOTION_TOKEN, "already-set");
    assert.equal(Object.prototype.hasOwnProperty.call(env, "NOTION_PARENT_PAGE_ID"), false);
    // Result must still carry the file value for the missing name.
    assert.equal(res.values.NOTION_PARENT_PAGE_ID, "page");
    ok(name);
  } catch (e) { bad(name, e); }
}

function testDescribeSecretPresenceSafeOnly() {
  const name = "(6) describeSecretPresence reports presence and length only — secret value never appears in JSON";
  try {
    const res = loadLocalEnv(["NOTION_TOKEN"], {
      file: SAFE_FILE,
      env: {},
      _fs: fakeFs({ [SAFE_FILE]: `NOTION_TOKEN=${SECRET}\n` }),
    });
    const summary = describeSecretPresence(res);
    const json = JSON.stringify(summary);
    assert.equal(summary.NOTION_TOKEN.present, true);
    assert.equal(summary.NOTION_TOKEN.length, SECRET.length);
    // The secret value must NOT appear anywhere in the JSON serialization.
    assert.ok(json.indexOf(SECRET) === -1,
      `secret value leaked into describeSecretPresence JSON: ${json}`);
    // Even a non-present key yields length 0 and no value.
    const res2 = { found: { MISSING: false }, values: { MISSING: "" } };
    const summary2 = describeSecretPresence(res2);
    assert.equal(summary2.MISSING.present, false);
    assert.equal(summary2.MISSING.length, 0);
    ok(name);
  } catch (e) { bad(name, e); }
}

function main() {
  console.log("# local-env regression tests");
  testParseEnvFileShapes();
  testParseEnvFileIgnoresMalformed();
  testLoadLocalEnvPrefersEnvOverFile();
  testLoadLocalEnvMissingFileAllFalseNoThrow();
  testLoadLocalEnvDoesNotMutateEnv();
  testDescribeSecretPresenceSafeOnly();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main();