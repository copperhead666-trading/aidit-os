// ops-watcher/health-os.regression.test.mjs
// Offline regression coverage for the HEALTH OS v1 scaffold. NO real state file
// I/O — readState/writeState are injected in-memory fixtures (matching how
// steward.regression.test.mjs / review-runner.regression.test.mjs avoid touching
// real state). NO real wearable export file — probeWearableSource is injected.
// NO real disk for the core logic; one optional temp-file test exercises the
// REAL defaultReadState/defaultWriteState against a per-test temp path and
// cleans it up.
//
//   node ops-watcher/health-os.regression.test.mjs
//
// Covers:
//   - valid check-in recorded (persists to injected state)
//   - out-of-range / missing check-in field rejected without crashing
//   - mode determination in all 3 states (NORMAL / LOW-ENERGY / EMERGENCY),
//     including check-in-only graceful degradation when no wearable signals
//   - wearable ingestion gracefully handles a missing source (no-data, no throw)
//   - wearable ingestion handles a throwing probe without crashing
//   - protected-anchor flagging (match + no-match)
//   - smoking event logging (valid types + invalid type rejected without crash)
//   - real fs readState/writeState round-trip against a temp state file (cleaned up)

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import {
  recordMorningCheckIn,
  determineDailyMode,
  ingestWearableExport,
  checkProtectedAnchor,
  recordSmokingEvent,
} from "./health-os.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_STATE = path.join(__dirname, "health-os.regression.state.tmp");

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };

// ---- In-memory fake state store (mirrors steward.regression.test.mjs's
// fakeStateStore pattern: passes state between calls, never touches real disk) ----
function fakeStateStore(initial) {
  let stored = initial ? JSON.parse(JSON.stringify(initial)) : null;
  return {
    readState: async () => (stored ? JSON.parse(JSON.stringify(stored)) : null),
    writeState: async (_file, state) => {
      stored = JSON.parse(JSON.stringify(state));
    },
    getStored: () => stored,
  };
}

// ---- Shared base deps builder (in-memory state, silent log) ----
function baseDeps(overrides = {}) {
  const store = fakeStateStore();
  return {
    stateFile: "/test/health-os-state.json", // path is irrelevant for in-memory store
    readState: store.readState,
    writeState: store.writeState,
    log: () => {},
    now: () => 1_700_000_000_000,
    _store: store,
    ...overrides,
  };
}

const T0 = 1_700_000_000_000; // fixed timestamp for deterministic assertions

// =====================================================================
// T1: valid check-in recorded and persisted to state
// =====================================================================
async function t1_validCheckInRecorded() {
  const deps = baseDeps();
  const r = await recordMorningCheckIn(
    { energy: 4, mood: 3, focus: 5, body: 4, now: T0 },
    deps,
  );
  assert.equal(r.ok, true, "T1: ok true");
  assert.equal(r.persisted, true, "T1: persisted true");
  assert.equal(r.checkIn.energy, 4);
  assert.equal(r.checkIn.mood, 3);
  assert.equal(r.checkIn.focus, 5);
  assert.equal(r.checkIn.body, 4);
  assert.equal(r.checkIn.at, new Date(T0).toISOString(), "T1: at is ISO of now");

  const stored = deps._store.getStored();
  assert.ok(stored, "T1: state persisted");
  assert.ok(Array.isArray(stored.checkIns), "T1: checkIns array exists");
  assert.equal(stored.checkIns.length, 1, "T1: exactly one check-in");
  assert.deepEqual(stored.checkIns[0], r.checkIn, "T1: stored record matches returned record");
  ok("T1: valid check-in recorded and persisted to state");
}

// =====================================================================
// T2: out-of-range check-in field rejected without crashing
// =====================================================================
async function t2_outOfRangeRejected() {
  // (a) energy = 6 (above max)
  const depsA = baseDeps();
  const rA = await recordMorningCheckIn({ energy: 6, mood: 3, focus: 3, body: 3 }, depsA);
  assert.equal(rA.ok, false, "T2a: ok false for energy=6");
  assert.equal(rA.field, "energy", "T2a: field is energy");
  assert.ok(/must be an integer 1-5/.test(rA.reason), "T2a: reason explains range");
  assert.equal(depsA._store.getStored(), null, "T2a: no state written on rejection");

  // (b) mood = 0 (below min)
  const depsB = baseDeps();
  const rB = await recordMorningCheckIn({ energy: 3, mood: 0, focus: 3, body: 3 }, depsB);
  assert.equal(rB.ok, false, "T2b: ok false for mood=0");
  assert.equal(rB.field, "mood", "T2b: field is mood");

  // (c) focus missing (undefined)
  const depsC = baseDeps();
  const rC = await recordMorningCheckIn({ energy: 3, mood: 3, body: 3 }, depsC);
  assert.equal(rC.ok, false, "T2c: ok false for missing focus");
  assert.equal(rC.field, "focus", "T2c: field is focus");

  // (d) body = 3.5 (non-integer)
  const depsD = baseDeps();
  const rD = await recordMorningCheckIn({ energy: 3, mood: 3, focus: 3, body: 3.5 }, depsD);
  assert.equal(rD.ok, false, "T2d: ok false for non-integer body=3.5");
  assert.equal(rD.field, "body", "T2d: field is body");

  // (e) completely empty input — rejected on the first field, no crash
  const depsE = baseDeps();
  const rE = await recordMorningCheckIn({}, depsE);
  assert.equal(rE.ok, false, "T2e: ok false for empty input");
  assert.equal(rE.field, "energy", "T2e: first field rejected");

  ok("T2: out-of-range / missing / non-integer check-in fields rejected without crashing (no state change)");
}

// =====================================================================
// T3: mode determination — NORMAL (high scores, check-in-only)
// =====================================================================
function t3_modeNormal() {
  const r = determineDailyMode(
    { checkIn: { energy: 5, mood: 5, focus: 5, body: 5 }, wearableSignals: null },
    { log: () => {} },
  );
  assert.equal(r.mode, "NORMAL", "T3: all-5s -> NORMAL");
  assert.ok(r.score >= 4.5, `T3: score high (got ${r.score})`);
  assert.equal(r.components.reason, "check-in-only", "T3: check-in-only (no wearable)");
  ok("T3: all-5 check-in with no wearable -> NORMAL (check-in-only degradation)");
}

// =====================================================================
// T4: mode determination — EMERGENCY (all 1s, check-in-only)
// =====================================================================
function t4_modeEmergency() {
  const r = determineDailyMode(
    { checkIn: { energy: 1, mood: 1, focus: 1, body: 1 }, wearableSignals: null },
    { log: () => {} },
  );
  assert.equal(r.mode, "EMERGENCY", "T4: all-1s -> EMERGENCY");
  assert.ok(r.score < 2.0, `T4: score below LOW_ENERGY_THRESHOLD (got ${r.score})`);
  ok("T4: all-1 check-in with no wearable -> EMERGENCY");
}

// =====================================================================
// T5: mode determination — LOW-ENERGY (mid scores, check-in-only)
// =====================================================================
function t5_modeLowEnergy() {
  // energy=2, mood=3, focus=3, body=3 -> weighted ~2.65 -> LOW-ENERGY
  const r = determineDailyMode(
    { checkIn: { energy: 2, mood: 3, focus: 3, body: 3 }, wearableSignals: null },
    { log: () => {} },
  );
  assert.equal(r.mode, "LOW-ENERGY", `T5: mid scores -> LOW-ENERGY (score=${r.score})`);
  assert.ok(r.score >= 2.0 && r.score < 3.5, `T5: score in LOW-ENERGY band (got ${r.score})`);
  ok("T5: mid-range check-in -> LOW-ENERGY");
}

// =====================================================================
// T6: wearable signal pulls mode DOWN (NORMAL -> LOW-ENERGY via poor sleep)
// =====================================================================
function t6_wearablePullsDown() {
  // Subjective alone (4,4,4,4 -> 4.0 -> NORMAL). Add poor wearable sleepQuality=1
  // and recoveryScore=1 to pull the combined score down into LOW-ENERGY.
  const subjOnly = determineDailyMode(
    { checkIn: { energy: 4, mood: 4, focus: 4, body: 4 }, wearableSignals: null },
    { log: () => {} },
  );
  assert.equal(subjOnly.mode, "NORMAL", "T6: subjective-only is NORMAL");

  const withWearable = determineDailyMode(
    {
      checkIn: { energy: 4, mood: 4, focus: 4, body: 4 },
      wearableSignals: { sleepQuality: 1, recoveryScore: 1, restingHr: null },
    },
    { log: () => {} },
  );
  assert.ok(withWearable.score < subjOnly.score, "T6: wearable pulls score down");
  assert.equal(withWearable.components.reason, "check-in+wearable", "T6: reason reflects wearable present");
  assert.equal(withWearable.components.wearableUsed, true, "T6: wearableUsed true");
  // With strong downward pull from two 1-rated wearable signals, mode drops.
  assert.notEqual(withWearable.mode, subjOnly.mode, "T6: mode changes when wearable pulls down");
  ok(`T6: poor wearable signals pull mode down (NORMAL ${subjOnly.mode} -> ${withWearable.mode}, score ${subjOnly.score.toFixed(2)} -> ${withWearable.score.toFixed(2)})`);
}

// =====================================================================
// T7: no check-in at all -> graceful NORMAL default (no fabricated emergency)
// =====================================================================
function t7_noCheckInDefaultsNormal() {
  const r = determineDailyMode({ checkIn: null, wearableSignals: null }, { log: () => {} });
  assert.equal(r.mode, "NORMAL", "T7: no check-in -> NORMAL (not fabricated emergency)");
  assert.equal(r.score, null, "T7: score null when no check-in");
  assert.equal(r.components.reason, "no-check-in", "T7: reason no-check-in");
  ok("T7: no check-in available -> graceful NORMAL default (never fabricates LOW-ENERGY/EMERGENCY from nothing)");
}

// =====================================================================
// T8: ingestWearableExport — missing source path -> clean no-data, no throw
// =====================================================================
async function t8_ingestMissingSource() {
  const deps = {
    probeWearableSource: async () => ({ exists: false }),
    log: () => {},
    now: () => T0,
  };
  const r = await ingestWearableExport({ sourcePath: "/no/such/gadgetbridge/export" }, deps);
  assert.equal(r.available, false, "T8: available false");
  assert.equal(r.signals, null, "T8: signals null");
  assert.equal(r.sourcePath, "/no/such/gadgetbridge/export", "T8: sourcePath echoed");
  assert.ok(/no data available/.test(r.reason), "T8: reason says no data available");
  ok("T8: ingestWearableExport with missing source -> clean no-data result, no throw");
}

// =====================================================================
// T9: ingestWearableExport — no sourcePath provided -> clean no-data
// =====================================================================
async function t9_ingestNoSourcePath() {
  const deps = { probeWearableSource: async () => ({ exists: true }), log: () => {}, now: () => T0 };
  const r = await ingestWearableExport({}, deps);
  assert.equal(r.available, false, "T9: available false");
  assert.equal(r.signals, null, "T9: signals null");
  assert.ok(/no sourcePath/.test(r.reason), "T9: reason mentions no sourcePath");
  ok("T9: ingestWearableExport with no sourcePath -> clean no-data result");
}

// =====================================================================
// T10: ingestWearableExport — source EXISTS but no parser -> no-signals (honest)
// =====================================================================
async function t10_ingestExistsNoParser() {
  const deps = { probeWearableSource: async () => ({ exists: true }), log: () => {}, now: () => T0 };
  const r = await ingestWearableExport({ sourcePath: "/some/real/export.json" }, deps);
  assert.equal(r.available, true, "T10: available true (path exists)");
  assert.equal(r.signals, null, "T10: signals null (no parser yet — never fabricate)");
  assert.ok(/not yet implemented/.test(r.reason), "T10: reason says parser not yet implemented");
  assert.equal(r.ingestedAt, new Date(T0).toISOString(), "T10: ingestedAt set");
  ok("T10: ingestWearableExport with existing path but no parser -> honest no-signals (never fabricates wearable data)");
}

// =====================================================================
// T11: ingestWearableExport — throwing probe -> no-data, no crash
// =====================================================================
async function t11_ingestThrowingProbe() {
  const deps = {
    probeWearableSource: async () => { throw new Error("disk on fire"); },
    log: () => {},
    now: () => T0,
  };
  const r = await ingestWearableExport({ sourcePath: "/x" }, deps);
  assert.equal(r.available, false, "T11: available false");
  assert.equal(r.signals, null, "T11: signals null");
  assert.ok(/probe error/.test(r.reason), "T11: reason mentions probe error");
  ok("T11: ingestWearableExport with a throwing probe -> no-data, no crash");
}

// =====================================================================
// T12: checkProtectedAnchor — flags when a protected anchor label is present
// =====================================================================
function t12_protectedAnchorFlagged() {
  // (a) tags include "learning"
  const rA = checkProtectedAnchor({ proposedChange: { tags: ["deep-work", "learning"] } }, { log: () => {} });
  assert.equal(rA.flagged, true, "T12a: flagged true for learning tag");
  assert.ok(rA.anchors.includes("learning"), "T12a: anchors includes learning");
  assert.ok(/PROTECTED ANCHOR/.test(rA.note), "T12a: note says protected anchor");

  // (b) description mentions "family dinner"
  const rB = checkProtectedAnchor({ proposedChange: { description: "move the family dinner earlier" } }, { log: () => {} });
  assert.equal(rB.flagged, true, "T12b: flagged true for family in description");
  assert.ok(rB.anchors.includes("family"), "T12b: anchors includes family");

  // (c) labels include "sleep"
  const rC = checkProtectedAnchor({ proposedChange: { labels: ["sleep"] } }, { log: () => {} });
  assert.equal(rC.flagged, true, "T12c: flagged true for sleep label");
  assert.ok(rC.anchors.includes("sleep"), "T12c: anchors includes sleep");

  ok("T12: checkProtectedAnchor flags when a protected anchor label/tag/description-token is present");
}

// =====================================================================
// T13: checkProtectedAnchor — no flag when no protected anchor is touched
// =====================================================================
function t13_protectedAnchorNotFlagged() {
  const r = checkProtectedAnchor({ proposedChange: { tags: ["coding", "email", "admin"] } }, { log: () => {} });
  assert.equal(r.flagged, false, "T13: not flagged for unrelated tags");
  assert.equal(r.anchors.length, 0, "T13: no anchors matched");
  assert.ok(/no protected anchor/.test(r.note), "T13: note says no protected anchor");
  ok("T13: checkProtectedAnchor does NOT flag when no protected anchor is touched");
}

// =====================================================================
// T14: smoking event logging — valid types recorded, persisted
// =====================================================================
async function t14_smokingEventLogged() {
  const deps = baseDeps();
  // (a) smoke
  const rA = await recordSmokingEvent({ type: "smoke", note: "after lunch", now: T0 }, deps);
  assert.equal(rA.ok, true, "T14a: ok true for smoke");
  assert.equal(rA.event.type, "smoke");
  assert.equal(rA.event.note, "after lunch");
  assert.equal(rA.event.at, new Date(T0).toISOString());

  // (b) craving (no note)
  const rB = await recordSmokingEvent({ type: "craving" }, deps);
  assert.equal(rB.ok, true, "T14b: ok true for craving");
  assert.equal(rB.event.type, "craving");
  assert.equal(rB.event.note, null, "T14b: note null when not provided");

  // (c) lapse
  const rC = await recordSmokingEvent({ type: "lapse", note: "stressful morning" }, deps);
  assert.equal(rC.ok, true, "T14c: ok true for lapse");

  const stored = deps._store.getStored();
  assert.equal(stored.smokingLog.length, 3, "T14: three smoking events persisted");
  assert.equal(stored.smokingLog[0].type, "smoke", "T14: first event is smoke");
  assert.equal(stored.smokingLog[2].type, "lapse", "T14: third event is lapse");

  // (d) frictionless: a smoking event with ONLY a type and nothing else works
  const rD = await recordSmokingEvent({ type: "smoke" }, deps);
  assert.equal(rD.ok, true, "T14d: ok true for bare smoke (frictionless)");

  ok("T14: valid smoking event types (smoke/craving/lapse) recorded and persisted; bare-type works (frictionless)");
}

// =====================================================================
// T15: smoking event — invalid type rejected without crashing
// =====================================================================
async function t15_smokingInvalidTypeRejected() {
  const deps = baseDeps();
  const r = await recordSmokingEvent({ type: "quit-date", note: "should not be accepted" }, deps);
  assert.equal(r.ok, false, "T15: ok false for invalid type");
  assert.ok(/must be one of/.test(r.reason), "T15: reason explains allowed types");
  assert.equal(r.type, "quit-date", "T15: type echoed");
  // Critically: NO quit-date logic exists — "quit-date" is rejected as a type,
  // and there is no code path that could set a quit date autonomously.
  assert.equal(deps._store.getStored(), null, "T15: no state written on rejection");

  // Also: a smoking event with no type at all is rejected
  const r2 = await recordSmokingEvent({ note: "nothing" }, deps);
  assert.equal(r2.ok, false, "T15b: ok false for missing type");

  ok("T15: invalid/missing smoking event type rejected without crashing; no quit-date code path exists");
}

// =====================================================================
// T16: real fs readState/writeState round-trip against a temp state file
// (exercises the REAL defaultReadState/defaultWriteState, then cleans up)
// =====================================================================
async function t16_realFsRoundTrip() {
  // Clean any prior temp state.
  await fs.unlink(TMP_STATE).catch(() => {});

  // Use the REAL default read/write by NOT injecting readState/writeState —
  // but we must reach them. They are not exported, so we exercise them via the
  // public functions with only stateFile injected to the temp path. The real
  // defaultReadState/defaultWriteState are module-internal closures that use
  // the real fs; the public functions default to them when not overridden.
  const realDeps = { stateFile: TMP_STATE, log: () => {}, now: () => T0 };

  // First read on a missing file -> fresh state (no crash).
  const r1 = await recordMorningCheckIn({ energy: 3, mood: 4, focus: 3, body: 4, now: T0 }, realDeps);
  assert.equal(r1.ok, true, "T16: check-in recorded against real fs temp state");
  assert.equal(r1.persisted, true, "T16: persisted to real fs");

  // Second operation reads back the persisted state (proves round-trip).
  const r2 = await recordSmokingEvent({ type: "smoke", now: T0 + 1000 }, realDeps);
  assert.equal(r2.ok, true, "T16: smoking event recorded against real fs");
  assert.ok(r2.state.checkIns.length >= 1, "T16: read-back saw the prior check-in");
  assert.ok(r2.state.smokingLog.length >= 1, "T16: read-back saw the new smoking event");

  // Clean up the temp state file.
  await fs.unlink(TMP_STATE).catch(() => {});
  ok("T16: real fs defaultReadState/defaultWriteState round-trip against a temp state file (cleaned up)");
}

// =====================================================================
// T17: state read failure degrades gracefully (no crash, fresh state used)
// =====================================================================
async function t17_stateReadFailureGraceful() {
  const deps = {
    stateFile: "/test/x",
    readState: async () => { throw new Error("read broken"); },
    writeState: async () => {},
    log: () => {},
    now: () => T0,
  };
  const r = await recordMorningCheckIn({ energy: 3, mood: 3, focus: 3, body: 3, now: T0 }, deps);
  assert.equal(r.ok, true, "T17: check-in still recorded when state read throws (fresh state used)");
  assert.equal(r.checkIn.energy, 3, "T17: record values correct");
  ok("T17: state read failure degrades gracefully (fresh state used, no crash)");
}

// =====================================================================
// T18: state write failure reported but does not crash (persisted:false)
// =====================================================================
async function t18_stateWriteFailureReported() {
  const deps = {
    stateFile: "/test/x",
    readState: async () => ({ checkIns: [], smokingLog: [], currentMode: null, modeUpdatedAt: null, wearableLastIngestedAt: null }),
    writeState: async () => { throw new Error("write broken"); },
    log: () => {},
    now: () => T0,
  };
  const r = await recordMorningCheckIn({ energy: 3, mood: 3, focus: 3, body: 3, now: T0 }, deps);
  assert.equal(r.ok, true, "T18: ok still true (in-memory record kept)");
  assert.equal(r.persisted, false, "T18: persisted false reported on write failure");
  ok("T18: state write failure reported (persisted:false) but does not crash");
}

// =====================================================================
// Runner
// =====================================================================
async function main() {
  const tests = [
    t1_validCheckInRecorded,
    t2_outOfRangeRejected,
    t3_modeNormal,
    t4_modeEmergency,
    t5_modeLowEnergy,
    t6_wearablePullsDown,
    t7_noCheckInDefaultsNormal,
    t8_ingestMissingSource,
    t9_ingestNoSourcePath,
    t10_ingestExistsNoParser,
    t11_ingestThrowingProbe,
    t12_protectedAnchorFlagged,
    t13_protectedAnchorNotFlagged,
    t14_smokingEventLogged,
    t15_smokingInvalidTypeRejected,
    t16_realFsRoundTrip,
    t17_stateReadFailureGraceful,
    t18_stateWriteFailureReported,
  ];
  for (const t of tests) await t();
  // Final cleanup of any temp files this suite may have created.
  await fs.unlink(TMP_STATE).catch(() => {});
  console.log(`\nhealth-os.regression.test.mjs: ${pass}/${tests.length} passed`);
  if (pass !== tests.length) process.exitCode = 1;
}

main();