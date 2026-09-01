// ops-watcher/pause-gate.regression.test.mjs
// Offline regression tests for ops-watcher/pause-gate.mjs.
//
//   node ops-watcher/pause-gate.regression.test.mjs
//
// The injected fs NEVER touches the real ops-watcher/PAUSED flag.

import assert from "node:assert/strict";
import {
  PAUSE_FILE,
  clearPause,
  isPaused,
  pauseBanner,
  readPause,
  setPaused,
} from "./pause-gate.mjs";

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

function memoryFs(seed = {}) {
  const files = new Map(Object.entries(seed));
  return {
    files,
    existsSync(p) {
      return files.has(p);
    },
    readFileSync(p) {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: no such file or directory, open '${p}'`);
        err.code = "ENOENT";
        throw err;
      }
      return files.get(p);
    },
    writeFileSync(p, body) {
      files.set(p, String(body));
    },
    unlinkSync(p) {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: no such file or directory, unlink '${p}'`);
        err.code = "ENOENT";
        throw err;
      }
      files.delete(p);
    },
  };
}

function throwingFs() {
  const boom = () => { throw new Error("fs unavailable"); };
  return {
    existsSync: boom,
    readFileSync: boom,
    writeFileSync: boom,
    unlinkSync: boom,
  };
}

function testNoFileRunning() {
  const name = "(1) no file -> paused:false and empty banner";
  try {
    const fs = memoryFs();
    const state = readPause({ fs });
    assert.deepEqual(state, { paused: false, reason: "", atIso: null, by: null });
    assert.equal(isPaused({ fs }), false);
    assert.equal(pauseBanner(state), "");
    ok(name);
  } catch (err) { bad(name, err); }
}

function testSetThenReadRoundTrip() {
  const name = "(2) setPaused then readPause round-trips reason/by with ISO timestamp";
  try {
    const fs = memoryFs();
    const result = setPaused({ reason: "1839 zombie processes", by: "owner-phone", now: "2026-09-01T04:05:06.000Z" }, { fs });
    assert.equal(result.ok, true);
    assert.equal(result.wrote, true);
    const state = readPause({ fs });
    assert.equal(state.paused, true);
    assert.equal(state.reason, "1839 zombie processes");
    assert.equal(state.by, "owner-phone");
    assert.equal(new Date(state.atIso).toISOString(), state.atIso);
    assert.match(pauseBanner(state), /FounderOS PAUSED sejak 2026-09-01T04:05:06\.000Z oleh owner-phone/);
    ok(name);
  } catch (err) { bad(name, err); }
}

function testExistenceCheckThrowsFailClosed() {
  const name = "(3) existence check throws -> paused true and reason names unreadable flag";
  try {
    const state = readPause({ fs: throwingFs() });
    assert.equal(state.paused, true);
    assert.match(state.reason, /could not be read/i);
    assert.ok(state.reason.includes(PAUSE_FILE));
    assert.equal(isPaused({ fs: throwingFs() }), true);
    ok(name);
  } catch (err) { bad(name, err); }
}

function testUnparseableContentFailClosed() {
  const name = "(4) unparseable file content -> paused true and reason says flag could not be read";
  try {
    const fs = memoryFs({ [PAUSE_FILE]: "this is not json" });
    const state = readPause({ fs });
    assert.equal(state.paused, true);
    assert.match(state.reason, /could not be read/i);
    ok(name);
  } catch (err) { bad(name, err); }
}

function testClearExistingFlag() {
  const name = "(5) clearPause existing flag -> cleared true then paused false";
  try {
    const fs = memoryFs();
    setPaused({ reason: "stop", by: "owner", now: "2026-09-01T01:00:00.000Z" }, { fs });
    const cleared = clearPause({ fs });
    assert.deepEqual(cleared, { ok: true, cleared: true });
    assert.equal(readPause({ fs }).paused, false);
    ok(name);
  } catch (err) { bad(name, err); }
}

function testClearAbsentFlag() {
  const name = "(6) clearPause with no flag -> ok true cleared false";
  try {
    const fs = memoryFs();
    assert.deepEqual(clearPause({ fs }), { ok: true, cleared: false });
    ok(name);
  } catch (err) { bad(name, err); }
}

function testSetTwiceUpdatesOneFlag() {
  const name = "(7) setPaused twice updates reason/time and keeps exactly one flag";
  try {
    const fs = memoryFs();
    setPaused({ reason: "first", by: "owner", now: "2026-09-01T01:00:00.000Z" }, { fs });
    setPaused({ reason: "second", by: "phone", now: "2026-09-01T02:00:00.000Z" }, { fs });
    assert.equal(fs.files.size, 1);
    assert.deepEqual([...fs.files.keys()], [PAUSE_FILE]);
    const state = readPause({ fs });
    assert.equal(state.paused, true);
    assert.equal(state.reason, "second");
    assert.equal(state.by, "phone");
    assert.equal(state.atIso, "2026-09-01T02:00:00.000Z");
    ok(name);
  } catch (err) { bad(name, err); }
}

function testEveryExportReturnsWhenFsThrows() {
  const name = "(8) every export returns rather than throws when fs throws on every operation";
  try {
    const fs = throwingFs();
    assert.doesNotThrow(() => readPause({ fs }));
    assert.doesNotThrow(() => isPaused({ fs }));
    assert.doesNotThrow(() => setPaused({ reason: "x", by: "y", now: "2026-09-01T00:00:00.000Z" }, { fs }));
    assert.doesNotThrow(() => clearPause({ fs }));
    assert.doesNotThrow(() => pauseBanner(readPause({ fs })));
    assert.equal(readPause({ fs }).paused, true);
    assert.equal(setPaused({ reason: "x", by: "y" }, { fs }).ok, false);
    assert.equal(clearPause({ fs }).ok, false);
    ok(name);
  } catch (err) { bad(name, err); }
}

function testWrittenPayloadHasHumanSentence() {
  const name = "(9) written payload contains a plain human sentence explaining the flag";
  try {
    const fs = memoryFs();
    setPaused({ reason: "manual stop", by: "owner", now: "2026-09-01T00:00:00.000Z" }, { fs });
    const payload = JSON.parse(fs.files.get(PAUSE_FILE));
    assert.equal(typeof payload.note, "string");
    assert.match(payload.note, /FounderOS sedang PAUSED/i);
    assert.match(payload.note, /menghapus file ini akan me-resume sistem/i);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher pause-gate regression tests");
  testNoFileRunning();
  testSetThenReadRoundTrip();
  testExistenceCheckThrowsFailClosed();
  testUnparseableContentFailClosed();
  testClearExistingFlag();
  testClearAbsentFlag();
  testSetTwiceUpdatesOneFlag();
  testEveryExportReturnsWhenFsThrows();
  testWrittenPayloadHasHumanSentence();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => { console.error("pause-gate regression runner crashed:", err); process.exit(1); });
