// ops-watcher/night-record.regression.test.mjs
//
// The night's record is the only thing that tells the owner what ran while he
// slept. It has one job it can fail silently at: reporting a quiet night as an
// empty frame, which reads as a broken page rather than as "nothing needed
// doing".
//
// Run with:
//   node ops-watcher/night-record.regression.test.mjs

import assert from "node:assert/strict";
import { KINDS } from "./ledger-schema.mjs";
import { foldNight, nightHeadline } from "./night-record.mjs";

let passed = 0;
let failed = 0;
const failures = [];
async function t(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${e && e.stack ? e.stack : e}`);
    failures.push(name);
    failed++;
  }
}

const DAY = "2026-09-05";
const OTHER = "2026-09-04";
const ev = (kind, subject, data = {}, ts = `${DAY}T02:00:00.000Z`) => ({ seq: 1, kind, subject, actor: "system", source: "runner", data, ts, shadow: null });

await t("a quiet night SAYS it ran and found nothing, rather than rendering empty", () => {
  const rec = foldNight([], { day: DAY });
  assert.equal(rec.quiet, true);
  assert.deepEqual(rec.ran, []);
  assert.deepEqual(rec.awaiting, []);
  const line = nightHeadline(rec);
  assert.match(line, /Tidak ada directive yang dijalankan/);
  assert.match(line, new RegExp(DAY), "the day is named, so a stale page is obvious");
  assert.match(line, /Sistem berjalan/, "and it states the loop was awake — the difference between quiet and broken");
  assert.notEqual(line.trim(), "", "a quiet night is never an empty string");
});

await t("a completed directive reports its files, its VERIFY and the result", () => {
  const rec = foldNight([
    ev(KINDS.EXECUTION_STARTED, "KOL-90", {}, `${DAY}T02:00:00.000Z`),
    ev(KINDS.EXECUTION_DONE, "KOL-90", {
      filesChanged: ["config/ventures.json"],
      verify: "node ops-watcher/verify-file.mjs --path config/ventures.json --contains metrik_terakhir",
      verifyOk: true,
    }, `${DAY}T02:05:00.000Z`),
  ], { day: DAY });

  assert.equal(rec.ran.length, 1);
  const r = rec.ran[0];
  assert.equal(r.identifier, "KOL-90");
  assert.equal(r.outcome, "done");
  assert.deepEqual(r.filesChanged, ["config/ventures.json"]);
  assert.match(r.verify, /^node ops-watcher\//);
  assert.equal(r.verifyOk, true);
  assert.equal(r.startedAt, `${DAY}T02:00:00.000Z`);
  assert.equal(r.finishedAt, `${DAY}T02:05:00.000Z`);
  assert.equal(rec.quiet, false);
  assert.match(nightHeadline(rec), /1 selesai/);
});

await t("a VERIFY result is never invented when the ledger does not carry one", () => {
  // Reporting a check that may never have run is worse than reporting nothing.
  const rec = foldNight([ev(KINDS.EXECUTION_DONE, "KOL-91", { filesChanged: ["a.mjs"] })], { day: DAY });
  assert.equal(rec.ran[0].verify, null, "no verify command recorded");
  assert.equal(rec.ran[0].verifyOk, null, "and therefore no verdict claimed");

  const reverted = foldNight([ev(KINDS.EXECUTION_REVERTED, "KOL-92", { reason: "verify-red" })], { day: DAY });
  assert.equal(reverted.ran[0].verifyOk, false, "a revert is a red verify, and that IS known");
  assert.equal(reverted.ran[0].reason, "verify-red");
});

await t("every outcome kind is counted under its own name", () => {
  const rec = foldNight([
    ev(KINDS.EXECUTION_DONE, "A"),
    ev(KINDS.EXECUTION_NOOP, "B"),
    ev(KINDS.EXECUTION_FAILED, "C", { reason: "lane timeout" }),
    ev(KINDS.EXECUTION_REVERTED, "D", { reason: "full-suite-red" }),
  ], { day: DAY });
  assert.deepEqual(rec.counts, { done: 1, "no-op": 1, failed: 1, reverted: 1 });
  assert.equal(rec.ran.length, 4);
  const line = nightHeadline(rec);
  for (const fragment of ["1 selesai", "1 dikembalikan", "1 gagal", "1 tanpa perubahan"]) {
    assert.ok(line.includes(fragment), `headline states "${fragment}": ${line}`);
  }
});

await t("only the requested day is reported", () => {
  const rec = foldNight([
    ev(KINDS.EXECUTION_DONE, "TODAY", {}, `${DAY}T02:00:00.000Z`),
    ev(KINDS.EXECUTION_DONE, "YESTERDAY", {}, `${OTHER}T02:00:00.000Z`),
  ], { day: DAY });
  assert.deepEqual(rec.ran.map((r) => r.identifier), ["TODAY"]);
});

await t("a refused plan is NOT reported as work done — it is reported as waiting", () => {
  // Listing a refusal under "what ran" would be the report claiming credit for
  // having refused something.
  const rec = foldNight([
    ev(KINDS.DIRECTIVE_PLAN_REFUSED, "KOL-93", { reason: "file-scope-out-of-scope" }),
  ], { day: DAY });
  assert.deepEqual(rec.ran, [], "nothing ran");
  assert.equal(rec.awaiting.length, 1, "but something is waiting for him");
  assert.equal(rec.awaiting[0].identifier, "KOL-93");
  assert.equal(rec.quiet, false, "a night with a refusal is not a quiet night");
  assert.match(nightHeadline(rec), /1 menunggu keputusan Anda/);
});

await t("a card he already answered is not reported as still waiting", () => {
  const rec = foldNight([
    ev(KINDS.CARD_SENT, "KOL-94", {}, `${DAY}T02:00:00.000Z`),
    ev(KINDS.DECISION_APPROVED, "KOL-94", {}, `${DAY}T03:00:00.000Z`),
    ev(KINDS.CARD_SENT, "KOL-95", {}, `${DAY}T02:10:00.000Z`),
  ], { day: DAY });
  assert.deepEqual(rec.awaiting.map((a) => a.identifier), ["KOL-95"], "the answered one drops out");
});

await t("the same directive waiting twice is listed once per reason, not once per event", () => {
  const rec = foldNight([
    ev(KINDS.CARD_SENT, "KOL-96", {}, `${DAY}T02:00:00.000Z`),
    ev(KINDS.CARD_SENT, "KOL-96", {}, `${DAY}T04:00:00.000Z`),
    ev(KINDS.CAP_EXECUTION_REACHED, "KOL-96", {}, `${DAY}T05:00:00.000Z`),
  ], { day: DAY });
  assert.equal(rec.awaiting.length, 2, "two distinct reasons, not three events");
  assert.deepEqual(rec.awaiting.map((a) => a.kind), [KINDS.CARD_SENT, KINDS.CAP_EXECUTION_REACHED]);
});

await t("records are ordered by when they finished", () => {
  const rec = foldNight([
    ev(KINDS.EXECUTION_DONE, "SECOND", {}, `${DAY}T05:00:00.000Z`),
    ev(KINDS.EXECUTION_DONE, "FIRST", {}, `${DAY}T03:00:00.000Z`),
  ], { day: DAY });
  assert.deepEqual(rec.ran.map((r) => r.identifier), ["FIRST", "SECOND"]);
});

await t("malformed events are skipped, never crash the page", () => {
  const rec = foldNight([
    null,
    {},
    { kind: KINDS.EXECUTION_DONE },
    { kind: "nonsense.kind", subject: "X", ts: `${DAY}T02:00:00.000Z` },
    ev(KINDS.EXECUTION_DONE, "GOOD"),
  ], { day: DAY });
  assert.deepEqual(rec.ran.map((r) => r.identifier), ["GOOD"]);
  assert.equal(foldNight(null, { day: DAY }).quiet, true, "a missing ledger is a quiet night, not a crash");
});

console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
process.exit(0);
