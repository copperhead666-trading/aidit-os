// ops-watcher/load-env-local.regression.test.mjs
// Offline regression tests for ops-watcher/load-env-local.cjs.
//
//   node ops-watcher/load-env-local.regression.test.mjs
//
// Injected fs only: this never reads the real repo .env.local.

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const loadEnvLocal = require("./load-env-local.cjs");

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => `       ${l}`).join("\n"));
  failures.push(name);
  failed++;
}

function fakeFs(files) {
  const map = new Map(Object.entries(files));
  return {
    readFileSync(file) {
      if (map.has(file)) return map.get(file);
      const err = new Error(`ENOENT: no such file or directory, open '${file}'`);
      err.code = "ENOENT";
      throw err;
    },
  };
}

function throwingFs(errorCode = "EACCES") {
  return {
    readFileSync(file) {
      const err = new Error(`${errorCode}: cannot read '${file}'`);
      err.code = errorCode;
      throw err;
    },
  };
}

const SAFE_FILE = "unit-test-only.env.local";
const SECRET = "123456789:AAAsuper_secret_loader_test_value_DO_NOT_LEAK";

function testNormalFileAndParsingRules() {
  const name = "normal file parses comments, blanks, CRLF, quotes, spaces, and values containing equals";
  try {
    const env = {};
    const text = [
      "   # comment with leading spaces",
      "",
      "PLAIN=hello",
      "TOKEN=a=b=c",
      "DOUBLE=\"double quoted\"",
      "SINGLE='single quoted'",
      "MISMATCH=\"left alone'",
      "  SPACED_KEY  =  spaced value  ",
      "CRLF=works\r\n",
    ].join("\n");
    const result = loadEnvLocal({ file: SAFE_FILE, env, _fs: fakeFs({ [SAFE_FILE]: text }) });

    assert.equal(result.found, true);
    assert.deepEqual(result.loaded, [
      "PLAIN",
      "TOKEN",
      "DOUBLE",
      "SINGLE",
      "MISMATCH",
      "SPACED_KEY",
      "CRLF",
    ]);
    assert.equal(env.PLAIN, "hello");
    assert.equal(env.TOKEN, "a=b=c");
    assert.equal(env.DOUBLE, "double quoted");
    assert.equal(env.SINGLE, "single quoted");
    assert.equal(env.MISMATCH, "\"left alone'");
    assert.equal(env.SPACED_KEY, "spaced value");
    assert.equal(env.CRLF, "works");
    ok(name);
  } catch (err) { bad(name, err); }
}

function testAlreadySetPreservedAndSkipped() {
  const name = "already-set key is preserved and reported in skipped";
  try {
    const env = { KEEP: "from-explicit-env" };
    const result = loadEnvLocal({
      file: SAFE_FILE,
      env,
      _fs: fakeFs({ [SAFE_FILE]: `KEEP=${SECRET}\nNEW=value\n` }),
    });

    assert.equal(env.KEEP, "from-explicit-env");
    assert.equal(env.NEW, "value");
    assert.deepEqual(result.loaded, ["NEW"]);
    assert.deepEqual(result.skipped, ["KEEP"]);
    ok(name);
  } catch (err) { bad(name, err); }
}

function testMissingFileDoesNotThrow() {
  const name = "missing file returns found:false without throwing";
  try {
    let result;
    assert.doesNotThrow(() => {
      result = loadEnvLocal({ file: "missing.env.local", env: {}, _fs: fakeFs({}) });
    });
    assert.deepEqual(result, { loaded: [], skipped: [], file: "missing.env.local", found: false });
    ok(name);
  } catch (err) { bad(name, err); }
}

function testUnreadableFileDoesNotThrow() {
  const name = "unreadable file returns found:false without throwing";
  try {
    let result;
    assert.doesNotThrow(() => {
      result = loadEnvLocal({ file: SAFE_FILE, env: {}, _fs: throwingFs("EACCES") });
    });
    assert.deepEqual(result, { loaded: [], skipped: [], file: SAFE_FILE, found: false });
    ok(name);
  } catch (err) { bad(name, err); }
}

function testNoValuesLeakInReturnObject() {
  const name = "returned loader metadata never contains secret values";
  try {
    const env = {};
    const result = loadEnvLocal({
      file: SAFE_FILE,
      env,
      _fs: fakeFs({ [SAFE_FILE]: `TELEGRAM_BOT_TOKEN_AHMAD=${SECRET}\nOTHER=visible-only-in-env\n` }),
    });

    const returned = JSON.stringify(result);
    assert.equal(env.TELEGRAM_BOT_TOKEN_AHMAD, SECRET);
    assert.ok(!returned.includes(SECRET), `secret leaked through return object: ${returned}`);
    assert.ok(!returned.includes("visible-only-in-env"), `ordinary value leaked through return object: ${returned}`);
    assert.deepEqual(result.loaded, ["TELEGRAM_BOT_TOKEN_AHMAD", "OTHER"]);
    ok(name);
  } catch (err) { bad(name, err); }
}

function main() {
  console.log("# load-env-local regression tests");
  testNormalFileAndParsingRules();
  testAlreadySetPreservedAndSkipped();
  testMissingFileDoesNotThrow();
  testUnreadableFileDoesNotThrow();
  testNoValuesLeakInReturnObject();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
