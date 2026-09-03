// ops-watcher/ledger.regression.test.mjs
// Offline regression coverage for the single ledger writer. NO disk, NO clock,
// NO network: the filesystem is an in-memory fake and `_now` is injected, so
// every run is byte-deterministic and nothing under state/ is ever touched.
// Run with:
//   node ops-watcher/ledger.regression.test.mjs

import assert from "node:assert/strict";
import { append, appendMany, readAll, readSince, lastSeq } from "./ledger.mjs";
import { KINDS } from "./ledger-schema.mjs";

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => { console.log(`FAIL: ${n}`); if (e) console.log(`  ${e && e.stack ? e.stack : e}`); failures.push(n); failed++; };

const LEDGER = "/mem/ledger.jsonl";
const LOCK = "/mem/ledger.lock";
const NOW = Date.parse("2026-09-03T02:00:00.000Z");
const TS = "2026-09-03T02:00:00.000Z";

// ── the in-memory filesystem ───────────────────────────────────────────
// Only the five methods ledger.mjs is allowed to use. Anything else it reached
// for would be an immediate TypeError, which is the point: the seam is small
// enough to fake completely.

function enoent(p) { const e = new Error(`ENOENT: ${p}`); e.code = "ENOENT"; return e; }
function eexist(p) { const e = new Error(`EEXIST: ${p}`); e.code = "EEXIST"; return e; }

function memfs(initial = {}) {
  const files = new Map(Object.entries(initial));
  const fs = {
    files,
    // Hooks the tests use to simulate a hostile world.
    onAppend: null,
    failReadWith: null,
    async mkdir() { return undefined; },
    async readFile(p) {
      if (fs.failReadWith && p === LEDGER) throw fs.failReadWith;
      if (!files.has(p)) throw enoent(p);
      return files.get(p);
    },
    async writeFile(p, data, opts = {}) {
      if (opts.flag === "wx" && files.has(p)) throw eexist(p);
      files.set(p, String(data));
    },
    async appendFile(p, data) {
      if (fs.onAppend) { await fs.onAppend(p, String(data), files); return; }
      files.set(p, (files.get(p) ?? "") + String(data));
    },
    async unlink(p) {
      if (!files.has(p)) throw enoent(p);
      files.delete(p);
    },
  };
  return fs;
}

function deps(_fs, over = {}) {
  return { _fs, _now: () => NOW, ledgerFile: LEDGER, lockFile: LOCK, ...over };
}

function ev(over = {}) {
  return {
    ts: TS,
    kind: KINDS.DIRECTIVE_CREATED,
    subject: "KOL-62",
    actor: "system",
    source: "runner",
    data: {},
    shadow: null,
    ...over,
  };
}

function lines(fs) {
  return String(fs.files.get(LEDGER) ?? "").split("\n").filter((l) => l !== "");
}

// ── the empty case ─────────────────────────────────────────────────────

async function t1_missing_file_reads_as_empty_with_lastSeq_zero() {
  const fs = memfs();
  const r = await readAll(deps(fs));
  assert.equal(r.ok, true, "T1: a missing log is not an error, it is an empty log");
  assert.deepEqual(r.events, [], "T1: a missing log has no events");
  assert.equal(r.corrupt, 0, "T1: a missing log has no corrupt lines");
  assert.equal(await lastSeq(deps(fs)), 0, "T1: lastSeq on a missing log is 0, not NaN or a throw");

  const empty = memfs({ [LEDGER]: "" });
  assert.deepEqual((await readAll(deps(empty))).events, [], "T1: an empty file reads as no events");
  assert.equal(await lastSeq(deps(empty)), 0, "T1: lastSeq on an empty file is 0");
  ok("T1: an empty or missing log reads as [] with lastSeq 0");
}

// ── seq assignment ─────────────────────────────────────────────────────

async function t2_first_append_gets_seq_one_and_writes_exactly_one_line() {
  const fs = memfs();
  const r = await append(ev(), deps(fs));
  assert.equal(r.ok, true, `T2: the first append must succeed, got ${r.reason}`);
  assert.equal(r.seq, 1, "T2: seq starts at 1, never 0");
  assert.equal(lines(fs).length, 1, "T2: exactly one line is written, no more and no less");
  assert.equal(JSON.parse(lines(fs)[0]).seq, 1, "T2: the line on disk carries the seq that was returned");
  ok("T2: the first append gets seq 1 and writes exactly one line");
}

async function t3_seq_is_strictly_monotonic_across_separate_appends() {
  const fs = memfs();
  const seqs = [];
  for (let i = 0; i < 4; i++) {
    const r = await append(ev({ subject: `KOL-${i}` }), deps(fs));
    assert.equal(r.ok, true, `T3: append ${i} must succeed, got ${r.reason}`);
    seqs.push(r.seq);
  }
  assert.deepEqual(seqs, [1, 2, 3, 4], "T3: each separate call takes the next number, none reused");
  assert.deepEqual(lines(fs).map((l) => JSON.parse(l).seq), [1, 2, 3, 4], "T3: disk agrees with what was returned");
  assert.equal(await lastSeq(deps(fs)), 4, "T3: lastSeq is the highest on disk");
  ok("T3: seq is strictly monotonic across separate append calls");
}

async function t4_the_writer_assigns_seq_and_ignores_one_the_caller_supplied() {
  const fs = memfs();
  await append(ev(), deps(fs));
  const r = await append(ev({ seq: 999 }), deps(fs));
  assert.equal(r.ok, true, "T4: a caller-supplied seq is not itself a validation failure");
  assert.equal(r.seq, 2, "T4: the writer owns seq — a caller cannot pick 999 and jump the sequence");
  ok("T4: a caller-supplied seq is discarded; the writer assigns it");
}

// ── rejection leaves nothing behind ────────────────────────────────────

async function t5_invalid_event_is_rejected_and_the_file_is_byte_identical() {
  const fs = memfs();
  await append(ev(), deps(fs));
  const before = fs.files.get(LEDGER);

  for (const bogus of [
    ev({ kind: "directive.executed" }),        // a plausible typo, not in KINDS
    ev({ actor: "robot" }),
    ev({ source: "slack" }),
    ev({ ts: "3 September 2026" }),
    ev({ data: null }),
    ev({ subject: "   " }),
    ev({ shadow: 42 }),
  ]) {
    const r = await append(bogus, deps(fs));
    assert.equal(r.ok, false, `T5: ${JSON.stringify(bogus.kind)} / bad field must be rejected, not written`);
    assert.equal(r.seq, null, "T5: a rejected append returns no seq");
    assert.ok(r.reason, "T5: a rejection always says why");
    assert.equal(fs.files.get(LEDGER), before, "T5: the log is byte-identical after a rejection");
  }
  ok("T5: a rejected event leaves the file byte-identical and returns a reason");
}

async function t6_a_rejection_does_not_advance_seq() {
  const fs = memfs();
  await append(ev(), deps(fs));
  const rejected = await append(ev({ kind: "nonsense" }), deps(fs));
  assert.equal(rejected.ok, false, "T6: the invalid event is rejected");
  assert.equal(await lastSeq(deps(fs)), 1, "T6: a rejection does not burn a number");
  const next = await append(ev(), deps(fs));
  assert.equal(next.seq, 2, "T6: the next valid append takes 2 — no gap, and nothing reused");
  ok("T6: a rejected append neither advances seq nor leaves a gap");
}

async function t7_junk_input_never_throws() {
  const fs = memfs();
  for (const junk of [null, undefined, 42, "KOL-1", [], [1, 2]]) {
    const r = await append(junk, deps(fs));
    assert.equal(r.ok, false, `T7: ${JSON.stringify(junk)} must be answered with ok:false, not a throw`);
  }
  assert.equal(fs.files.size, 0, "T7: junk never even creates the log or the lock");
  ok("T7: junk input is answered, never thrown on");
}

// ── one writer, enforced ───────────────────────────────────────────────

async function t8_second_writer_is_blocked_while_the_lock_is_held() {
  const fs = memfs();
  // Writer A is parked inside its appendFile. Writer B runs while A holds the
  // lock — this is the real interleaving, not a hand-placed lock file.
  let releaseA;
  const parked = new Promise((resolve) => { releaseA = resolve; });
  let bResult = null;
  fs.onAppend = async (p, data, files) => {
    fs.onAppend = null;                       // only park the first writer
    bResult = await append(ev({ subject: "B" }), deps(fs));
    await parked;
    files.set(p, (files.get(p) ?? "") + data);
  };

  const aPromise = append(ev({ subject: "A" }), deps(fs));
  releaseA();
  const a = await aPromise;

  assert.equal(a.ok, true, `T8: writer A must succeed, got ${a.reason}`);
  assert.equal(bResult.ok, false, "T8: writer B must be refused while A holds the lock");
  assert.match(String(bResult.reason), /lock/i, "T8: B's reason names the lock");
  assert.equal(bResult.retryable, true, "T8: a lock refusal is retryable, not a permanent failure");
  assert.equal(lines(fs).length, 1, "T8: exactly one line landed — B did not interleave into the log");
  assert.equal(JSON.parse(lines(fs)[0]).subject, "A", "T8: the line is A's, the writer that held the lock");
  ok("T8: a second writer is blocked while the lock is held, and does not write");
}

async function t9_the_lock_is_released_even_when_the_append_is_rejected() {
  const fs = memfs();
  const r = await append(ev({ kind: "nope" }), deps(fs));
  assert.equal(r.ok, false, "T9: the event is rejected");
  assert.equal(fs.files.has(LOCK), false, "T9: the lock is released on the failure path, not only the happy one");
  const after = await append(ev(), deps(fs));
  assert.equal(after.ok, true, "T9: the next writer is not wedged out by the previous rejection");
  ok("T9: the lock is released in a finally, including after a rejection");
}

async function t10_a_fresh_lock_is_never_broken() {
  const fs = memfs({ [LOCK]: JSON.stringify({ pid: 4242, startedAt: new Date(NOW - 5_000).toISOString() }) });
  const r = await append(ev(), deps(fs, { staleLockMs: 120_000 }));
  assert.equal(r.ok, false, "T10: a five-second-old lock is a live writer, not a corpse");
  assert.match(String(r.reason), /4242/, "T10: the refusal names the pid that holds it");
  assert.equal(fs.files.has(LEDGER), false, "T10: nothing was written past a live lock");
  ok("T10: a lock younger than the stale threshold is never broken");
}

async function t11_a_stale_lock_is_broken_with_a_recorded_reason() {
  const fs = memfs({ [LOCK]: JSON.stringify({ pid: 4242, startedAt: new Date(NOW - 600_000).toISOString() }) });
  const logged = [];
  const r = await append(ev(), deps(fs, { staleLockMs: 120_000, log: (m) => logged.push(m) }));
  assert.equal(r.ok, true, `T11: a ten-minute-old lock must not wedge the ledger, got ${r.reason}`);
  assert.ok(r.broke, "T11: the result records that a lock was broken");
  assert.match(String(r.broke.reason), /stale threshold/, "T11: the recorded reason says why it was broken");
  assert.equal(r.broke.previous.pid, 4242, "T11: the previous holder is kept for diagnosis");
  assert.ok(logged.some((m) => /stale lock/.test(m)), "T11: breaking a lock is logged, never silent");
  ok("T11: a stale lock is broken, with the reason recorded on the result and logged");
}

async function t12_the_stale_threshold_is_a_real_boundary() {
  const held = (ageMs) => memfs({ [LOCK]: JSON.stringify({ pid: 7, startedAt: new Date(NOW - ageMs).toISOString() }) });
  const under = await append(ev(), deps(held(59_000), { staleLockMs: 60_000 }));
  const over = await append(ev(), deps(held(61_000), { staleLockMs: 60_000 }));
  assert.equal(under.ok, false, "T12: one second under the TTL is still a live lock");
  assert.equal(over.ok, true, `T12: one second over the TTL is breakable, got ${over.reason}`);
  ok("T12: the stale-lock TTL is a real configurable boundary, not a vibe");
}

async function t13_an_unreadable_lock_file_is_treated_as_stale() {
  const fs = memfs({ [LOCK]: "{ this is not json" });
  const r = await append(ev(), deps(fs));
  assert.equal(r.ok, true, `T13: garbage in the lock must not wedge the ledger forever, got ${r.reason}`);
  assert.match(String(r.broke.reason), /readable JSON/, "T13: the reason says the lock could not be trusted");
  ok("T13: a lock file whose age cannot be trusted is broken, with a reason");
}

// ── damage tolerance ───────────────────────────────────────────────────

async function t14_readAll_survives_a_corrupt_middle_line() {
  const good = (seq, subject) => JSON.stringify({ seq, ts: TS, kind: KINDS.DIRECTIVE_CREATED, subject, actor: "system", source: "runner", data: {}, shadow: null });
  const fs = memfs({ [LEDGER]: [good(1, "A"), "{\"seq\":2,\"ts\": TORN", good(3, "C"), ""].join("\n") });
  const r = await readAll(deps(fs));
  assert.equal(r.ok, true, "T14: a damaged log still reads — this is the failure mode that loses everything");
  assert.deepEqual(r.events.map((e) => e.subject), ["A", "C"], "T14: the readable events either side of the damage survive");
  assert.equal(r.corrupt, 1, "T14: the corrupt line is COUNTED, not swallowed");
  assert.deepEqual(r.corruptLines, [2], "T14: the result says which line to go and look at");
  ok("T14: readAll skips a corrupt middle line, counts it, and keeps the rest");
}

async function t15_a_line_that_parses_but_fails_the_schema_is_corrupt_not_an_event() {
  const fs = memfs({ [LEDGER]: JSON.stringify({ seq: 1, ts: TS, kind: "directive.executed", subject: null, actor: "system", source: "runner", data: {}, shadow: null }) + "\n" });
  const r = await readAll(deps(fs));
  assert.deepEqual(r.events, [], "T15: an unknown kind is not an event a reader may act on");
  assert.equal(r.corrupt, 1, "T15: it is counted as corrupt so it cannot vanish quietly");
  ok("T15: a line that parses but fails the schema is corrupt, not a usable event");
}

async function t16_a_seq_on_an_unvalidatable_line_is_still_never_reused() {
  // seq 5 is spent even though the line is not a valid event. Handing 5 out
  // again would put two different facts under one number.
  const fs = memfs({ [LEDGER]: JSON.stringify({ seq: 5, kind: "garbage" }) + "\n" });
  const r = await append(ev(), deps(fs));
  assert.equal(r.ok, true, `T16: a damaged log must still accept new facts, got ${r.reason}`);
  assert.equal(r.seq, 6, "T16: the next seq clears the damaged line's number — gaps are legal, duplicates are not");
  ok("T16: a seq claimed by an unvalidatable line is never handed out again");
}

async function t17_a_torn_previous_line_does_not_swallow_the_new_one() {
  const fs = memfs({ [LEDGER]: "{\"seq\":1,\"ts\":\"2026" }); // no trailing newline
  const r = await append(ev(), deps(fs));
  assert.equal(r.ok, true, `T17: a torn tail must not block the next fact, got ${r.reason}`);
  const read = await readAll(deps(fs));
  assert.equal(read.corrupt, 1, "T17: the damage stays confined to exactly one line");
  assert.equal(read.events.length, 1, "T17: the new event is whole and readable, not grafted onto the torn line");
  ok("T17: a torn previous line does not swallow the newly appended one");
}

async function t18_an_unverifiable_append_is_rolled_back_to_the_previous_bytes() {
  const fs = memfs();
  await append(ev({ subject: "KEEP" }), deps(fs));
  const before = fs.files.get(LEDGER);
  // Simulate a short write: only half the payload reaches the file.
  fs.onAppend = async (p, data, files) => { files.set(p, (files.get(p) ?? "") + data.slice(0, 20)); };
  const r = await append(ev({ subject: "TORN" }), deps(fs));
  assert.equal(r.ok, false, "T18: a write that did not land whole must not be reported as ok");
  assert.equal(r.seq, null, "T18: no seq is claimed by a write that failed verification");
  assert.equal(fs.files.get(LEDGER), before, "T18: the log is restored to its exact previous bytes — no partial line left behind");
  ok("T18: an append that does not verify is rolled back to the previous bytes");
}

async function t19_an_unreadable_log_refuses_the_append_rather_than_restarting_at_one() {
  const fs = memfs({ [LEDGER]: JSON.stringify({ seq: 9 }) + "\n" });
  const boom = new Error("EACCES: permission denied");
  boom.code = "EACCES";
  fs.failReadWith = boom;
  const r = await append(ev(), deps(fs));
  assert.equal(r.ok, false, "T19: not knowing the last seq means refusing, never guessing");
  assert.match(String(r.reason), /unreadable/, "T19: the reason says the log could not be read");
  assert.equal(fs.files.has(LOCK), false, "T19: the lock is still released on this path");
  ok("T19: an unreadable log refuses the append instead of restarting the sequence");
}

// ── batches ────────────────────────────────────────────────────────────

async function t20_appendMany_assigns_consecutive_seqs_in_one_write() {
  const fs = memfs();
  await append(ev(), deps(fs));
  const r = await appendMany([ev({ subject: "A" }), ev({ subject: "B" }), ev({ subject: "C" })], deps(fs));
  assert.equal(r.ok, true, `T20: a valid batch must land, got ${r.reason}`);
  assert.deepEqual(r.seqs, [2, 3, 4], "T20: the batch takes consecutive numbers");
  assert.equal(r.seq, 4, "T20: seq reports the last number assigned");
  assert.equal(r.written, 3, "T20: three events means three lines");
  assert.deepEqual(lines(fs).map((l) => JSON.parse(l).seq), [1, 2, 3, 4], "T20: disk agrees");
  ok("T20: appendMany assigns consecutive seqs and writes every line");
}

async function t21_appendMany_rolls_back_entirely_when_one_event_is_invalid() {
  const fs = memfs();
  await append(ev({ subject: "KEEP" }), deps(fs));
  const before = fs.files.get(LEDGER);
  const r = await appendMany([ev({ subject: "A" }), ev({ kind: "not.a.kind" }), ev({ subject: "C" })], deps(fs));
  assert.equal(r.ok, false, "T21: one bad event in the batch fails the whole batch");
  assert.equal(r.index, 1, "T21: the result says which event in the batch was the problem");
  assert.equal(r.written, 0, "T21: nothing at all was written");
  assert.equal(fs.files.get(LEDGER), before, "T21: the log is byte-identical — the two valid siblings did not sneak in");
  assert.equal(await lastSeq(deps(fs)), 1, "T21: the failed batch consumed no numbers");
  ok("T21: appendMany is all-or-nothing when one event in the batch is invalid");
}

async function t22_appendMany_rolls_back_entirely_when_the_write_does_not_verify() {
  const fs = memfs();
  await append(ev({ subject: "KEEP" }), deps(fs));
  const before = fs.files.get(LEDGER);
  fs.onAppend = async (p, data, files) => { files.set(p, (files.get(p) ?? "") + data.split("\n")[0]); }; // only the first line lands
  const r = await appendMany([ev({ subject: "A" }), ev({ subject: "B" })], deps(fs));
  assert.equal(r.ok, false, "T22: a batch that only half-landed is not ok");
  assert.equal(fs.files.get(LEDGER), before, "T22: the half-landed batch is rolled back whole");
  ok("T22: a batch whose write does not verify is rolled back entirely");
}

async function t23_an_empty_batch_writes_nothing() {
  const fs = memfs();
  const r = await appendMany([], deps(fs));
  assert.equal(r.ok, false, "T23: an empty batch is not a successful write");
  assert.equal(fs.files.size, 0, "T23: an empty batch does not create the log or take the lock");
  ok("T23: an empty batch writes nothing and claims nothing");
}

// ── ordered reads ──────────────────────────────────────────────────────

async function t24_readAll_returns_events_in_seq_order_whatever_the_file_order() {
  const line = (seq) => JSON.stringify({ seq, ts: TS, kind: KINDS.DIRECTIVE_CREATED, subject: `S${seq}`, actor: "system", source: "runner", data: {}, shadow: null });
  const fs = memfs({ [LEDGER]: [line(3), line(1), line(2)].join("\n") + "\n" });
  const r = await readAll(deps(fs));
  assert.deepEqual(r.events.map((e) => e.seq), [1, 2, 3], "T24: readers get seq order, not file order");
  ok("T24: readAll returns events in seq order regardless of file order");
}

async function t25_readSince_returns_only_what_came_after() {
  const fs = memfs();
  await appendMany([ev({ subject: "A" }), ev({ subject: "B" }), ev({ subject: "C" })], deps(fs));
  const r = await readSince(1, deps(fs));
  assert.deepEqual(r.events.map((e) => e.seq), [2, 3], "T25: strictly after — seq 1 itself is not returned");
  assert.deepEqual((await readSince(0, deps(fs))).events.map((e) => e.seq), [1, 2, 3], "T25: since 0 is everything");
  assert.deepEqual((await readSince(99, deps(fs))).events, [], "T25: since beyond the end is empty, not a throw");
  ok("T25: readSince returns only the events after the given seq");
}

async function main() {
  const tests = [
    t1_missing_file_reads_as_empty_with_lastSeq_zero,
    t2_first_append_gets_seq_one_and_writes_exactly_one_line,
    t3_seq_is_strictly_monotonic_across_separate_appends,
    t4_the_writer_assigns_seq_and_ignores_one_the_caller_supplied,
    t5_invalid_event_is_rejected_and_the_file_is_byte_identical,
    t6_a_rejection_does_not_advance_seq,
    t7_junk_input_never_throws,
    t8_second_writer_is_blocked_while_the_lock_is_held,
    t9_the_lock_is_released_even_when_the_append_is_rejected,
    t10_a_fresh_lock_is_never_broken,
    t11_a_stale_lock_is_broken_with_a_recorded_reason,
    t12_the_stale_threshold_is_a_real_boundary,
    t13_an_unreadable_lock_file_is_treated_as_stale,
    t14_readAll_survives_a_corrupt_middle_line,
    t15_a_line_that_parses_but_fails_the_schema_is_corrupt_not_an_event,
    t16_a_seq_on_an_unvalidatable_line_is_still_never_reused,
    t17_a_torn_previous_line_does_not_swallow_the_new_one,
    t18_an_unverifiable_append_is_rolled_back_to_the_previous_bytes,
    t19_an_unreadable_log_refuses_the_append_rather_than_restarting_at_one,
    t20_appendMany_assigns_consecutive_seqs_in_one_write,
    t21_appendMany_rolls_back_entirely_when_one_event_is_invalid,
    t22_appendMany_rolls_back_entirely_when_the_write_does_not_verify,
    t23_an_empty_batch_writes_nothing,
    t24_readAll_returns_events_in_seq_order_whatever_the_file_order,
    t25_readSince_returns_only_what_came_after,
  ];
  for (const t of tests) {
    try {
      await t();
    } catch (e) {
      bad(t.name, e);
    }
  }
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((e) => {
  console.error("regression runner crashed:", e);
  process.exit(1);
});
