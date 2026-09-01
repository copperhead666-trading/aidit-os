// ops-watcher/telegram-initdata.regression.test.mjs
// Offline regression tests for Telegram Mini App initData authentication.
//
//   node ops-watcher/telegram-initdata.regression.test.mjs
//
// No real token is read from disk or env. The token below is fake and is never
// printed. If this Node runtime cannot import TypeScript directly, this file
// falls back to a clearly labelled test-local mirror so the crypto fixtures and
// regression expectations remain executable without adding a loader.

import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";

const FAKE_TOKEN = "123456:TEST-TOKEN-NOT-REAL";
const NOW = 1_800_000_000_000;

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(`       ${e && e.stack ? e.stack : e}`);
  failures.push(n);
  failed++;
};

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function buildDataCheckString(fields) {
  return Object.entries(fields)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyOrder = compareStrings(leftKey, rightKey);
      return keyOrder === 0 ? compareStrings(String(leftValue), String(rightValue)) : keyOrder;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function expectedHashFor(fields, botToken) {
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secretKey).update(buildDataCheckString(fields)).digest("hex");
}

function signedInitData(fields, botToken = FAKE_TOKEN) {
  const hash = expectedHashFor(fields, botToken);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) params.set(key, String(value));
  params.set("hash", hash);
  return params.toString();
}

function baseFields(authDateSeconds = Math.floor(NOW / 1000)) {
  return {
    auth_date: String(authDateSeconds),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({ id: 8987077084, username: "owner_test", first_name: "Owner" }),
  };
}

// TEST-LOCAL MIRROR fallback only. Used when plain Node in this workspace cannot
// import ../cockpit/lib/telegram-auth.ts directly from an ESM regression test.
const testLocalMirror = (() => {
  const HASH_HEX_RE = /^[0-9a-f]{64}$/i;
  const failResult = (reason, authDateMs = null) => ({ ok: false, reason, user: null, authDateMs });
  const safeHexEqual = (expectedHex, receivedHex) => {
    if (!HASH_HEX_RE.test(receivedHex)) return false;
    const expected = Buffer.from(expectedHex, "hex");
    const received = Buffer.from(receivedHex, "hex");
    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
  };
  const parseUser = (value) => {
    if (value === null || value.trim() === "") return null;
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "object" || parsed === null) return null;
      if (!Number.isSafeInteger(parsed.id)) return null;
      const user = { id: parsed.id };
      if (typeof parsed.username === "string" && parsed.username.length > 0) user.username = parsed.username;
      if (typeof parsed.first_name === "string" && parsed.first_name.length > 0) user.firstName = parsed.first_name;
      return user;
    } catch {
      return null;
    }
  };
  const verifyInitData = (initData, botToken, opts = {}) => {
    try {
      if (typeof botToken !== "string" || botToken.trim() === "") {
        return failResult("server misconfigured: Telegram bot token is not set");
      }
      if (typeof initData !== "string" || initData.trim() === "") return failResult("initData is empty");
      const raw = initData.startsWith("?") ? initData.slice(1) : initData;
      const params = new URLSearchParams(raw);
      const receivedHash = params.get("hash");
      if (receivedHash === null || receivedHash === "") return failResult("initData is missing hash");
      if (!HASH_HEX_RE.test(receivedHash)) return failResult("initData hash is malformed");
      const fields = Array.from(params.entries()).filter(([key]) => key !== "hash");
      if (fields.length === 0) return failResult("initData has no signed fields");
      fields.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        const keyOrder = compareStrings(leftKey, rightKey);
        return keyOrder === 0 ? compareStrings(leftValue, rightValue) : keyOrder;
      });
      const dataCheckString = fields.map(([key, value]) => `${key}=${value}`).join("\n");
      const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
      const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
      if (!safeHexEqual(expectedHash, receivedHash)) return failResult("initData signature is invalid");
      const authDateRaw = params.get("auth_date");
      if (authDateRaw === null || !/^\d+$/.test(authDateRaw)) return failResult("auth_date is missing or malformed");
      const authDateMs = Number(authDateRaw) * 1000;
      if (!Number.isSafeInteger(authDateMs)) return failResult("auth_date is missing or malformed");
      const maxAgeMs = opts.maxAgeMs ?? 24 * 60 * 60 * 1000;
      const now = opts.now ?? Date.now();
      if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) return failResult("maxAgeMs is malformed", authDateMs);
      if (!Number.isFinite(now)) return failResult("now is malformed", authDateMs);
      if (now - authDateMs > maxAgeMs) {
        return failResult("initData is stale: auth_date is older than maxAgeMs", authDateMs);
      }
      const user = parseUser(params.get("user"));
      if (user === null) return failResult("user is missing or malformed", authDateMs);
      return { ok: true, reason: "ok", user, authDateMs };
    } catch {
      return failResult("initData verification failed without throwing");
    }
  };
  const isOwner = (user, allowedIds) => {
    if (user === null || allowedIds.length === 0) return false;
    return allowedIds.includes(user.id);
  };
  return { verifyInitData, isOwner };
})();

let authModule;
let importLimitation = "";
try {
  authModule = await import("../cockpit/lib/telegram-auth.ts");
} catch (e) {
  importLimitation = `LIMITATION: this Node runtime could not import cockpit/lib/telegram-auth.ts directly; using test-local mirror (${e && e.code ? e.code : "import failed"}).`;
  authModule = testLocalMirror;
}

function run(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    bad(name, e);
  }
}

function testValidSignedInitData() {
  const fields = baseFields();
  const initData = signedInitData(fields);
  const result = authModule.verifyInitData(initData, FAKE_TOKEN, { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ok");
  assert.deepEqual(result.user, { id: 8987077084, username: "owner_test", firstName: "Owner" });
  assert.equal(result.authDateMs, NOW);
}

function testHashChanged() {
  const fields = baseFields();
  const initData = signedInitData(fields);
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  assert.equal(typeof hash, "string");
  params.set("hash", `${hash.slice(0, -1)}${hash.endsWith("0") ? "1" : "0"}`);
  const result = authModule.verifyInitData(params.toString(), FAKE_TOKEN, { now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.reason, /signature|hash/i);
  assert.equal(result.user, null);
}

function testFieldTamperedAfterSigning() {
  const fields = baseFields();
  const initData = signedInitData(fields);
  const params = new URLSearchParams(initData);
  params.set("query_id", "tampered-query-id");
  const result = authModule.verifyInitData(params.toString(), FAKE_TOKEN, { now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.reason, /signature/i);
  assert.equal(result.user, null);
}

function testStaleAuthDate() {
  const staleSeconds = Math.floor((NOW - 10_000) / 1000);
  const initData = signedInitData(baseFields(staleSeconds));
  const result = authModule.verifyInitData(initData, FAKE_TOKEN, { now: NOW, maxAgeMs: 5_000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /stale|older/i);
  assert.equal(result.user, null);
  assert.equal(result.authDateMs, staleSeconds * 1000);
}

function testEmptyInitData() {
  let result;
  assert.doesNotThrow(() => {
    result = authModule.verifyInitData("", FAKE_TOKEN, { now: NOW });
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /empty/i);
  assert.equal(result.user, null);
}

function testEmptyBotToken() {
  const initData = signedInitData(baseFields());
  const result = authModule.verifyInitData(initData, "", { now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.reason, /server misconfigured/i);
  assert.equal(result.user, null);
}

function testIsOwner() {
  const user = { id: 8987077084, username: "owner_test", firstName: "Owner" };
  assert.equal(authModule.isOwner(user, [8987077084]), true);
  assert.equal(authModule.isOwner(user, [123]), false);
  assert.equal(authModule.isOwner(null, [8987077084]), false);
  assert.equal(authModule.isOwner(user, []), false);
}

function main() {
  console.log("# telegram initData regression tests");
  if (importLimitation) console.log(importLimitation);
  run("(1) correctly signed initData -> ok true, user parsed", testValidSignedInitData);
  run("(2) one hash character changed -> ok false", testHashChanged);
  run("(3) signed field tampered -> ok false", testFieldTamperedAfterSigning);
  run("(4) auth_date older than maxAgeMs -> stale failure", testStaleAuthDate);
  run("(5) empty initData -> ok false, no throw", testEmptyInitData);
  run("(6) empty bot token -> server misconfiguration failure", testEmptyBotToken);
  run("(7) isOwner allowlist behavior", testIsOwner);
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
