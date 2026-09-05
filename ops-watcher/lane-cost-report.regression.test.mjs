// ops-watcher/lane-cost-report.regression.test.mjs
//
//   node ops-watcher/lane-cost-report.regression.test.mjs

import assert from "node:assert/strict";
import {
  buildCostReport,
  costPerLane,
  renderCostReport,
  slowestRuns,
} from "./lane-cost-report.mjs";

let passed = 0;
let failed = 0;
const failures = [];
const ok = (name) => { console.log(`PASS: ${name}`); passed++; };
const bad = (name, err) => {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((line) => "       " + line).join("\n"));
  failures.push(name);
  failed++;
};

async function t(name, fn) {
  try { await fn(); ok(name); } catch (err) { bad(name, err); }
}

const NOW = Date.parse("2026-09-05T00:00:00.000Z");
const now = () => NOW;

await t("C1 known fixtures produce hand-checkable okRate, wastedMs, and p50 per lane", () => {
  const lanes = costPerLane([
    { ts: "2026-09-04T00:00:00.000Z", lane: "corleone", ok: true, timedOut: false, durationMs: 100, promptLength: 10 },
    { ts: "2026-09-04T01:00:00.000Z", lane: "corleone", ok: false, timedOut: false, durationMs: 300, promptLength: 20 },
    { ts: "2026-09-04T02:00:00.000Z", lane: "corleone", ok: false, timedOut: false, durationMs: 500, promptLength: 30 },
    { ts: "2026-09-04T03:00:00.000Z", lane: "hatta", ok: true, timedOut: false, durationMs: 80, promptLength: 12 },
    { ts: "2026-09-04T04:00:00.000Z", lane: "hatta", ok: false, timedOut: false, durationMs: 120, promptLength: 18 },
  ]);
  assert.equal(lanes.corleone.runs, 3);
  assert.equal(lanes.corleone.okRate, 1 / 3);
  assert.equal(lanes.corleone.wastedMs, 800);
  assert.equal(lanes.corleone.p50DurationMs, 300);
  assert.equal(lanes.corleone.avgPromptLength, 20);
  assert.equal(lanes.hatta.okRate, 1 / 2);
  assert.equal(lanes.hatta.wastedMs, 120);
  assert.equal(lanes.hatta.p50DurationMs, 80);
});

await t("C2 timeout ceiling affects timeoutRate but wastedMs still depends only on ok", () => {
  const lanes = costPerLane([
    { ts: "2026-09-04T00:00:00.000Z", lane: "sjahrir", ok: true, timedOut: false, durationMs: 480000, promptLength: 1 },
    { ts: "2026-09-04T01:00:00.000Z", lane: "sjahrir", ok: false, timedOut: true, durationMs: 480000, promptLength: 1 },
    { ts: "2026-09-04T02:00:00.000Z", lane: "sjahrir", ok: false, timedOut: false, durationMs: 1000, promptLength: 1 },
  ], { timeoutMs: 480000 });
  assert.equal(lanes.sjahrir.timedOut, 2);
  assert.equal(lanes.sjahrir.timeoutRate, 2 / 3);
  assert.equal(lanes.sjahrir.wastedMs, 481000);
});

await t("C3 malformed lines are skipped and counted, never thrown on", async () => {
  const fs = {
    readFile: async () => [
      JSON.stringify({ ts: "2026-09-04T00:00:00.000Z", lane: "corleone", ok: true, timedOut: false, durationMs: 100 }),
      "{ broken",
      JSON.stringify({ ts: "2026-09-04T01:00:00.000Z", lane: "corleone", ok: false, timedOut: false, durationMs: 200 }),
    ].join("\n"),
  };
  const result = await buildCostReport({ usageFile: "fake.jsonl", _fs: fs, now });
  assert.equal(result.ok, true);
  assert.equal(result.report.skippedLines, 1);
  assert.equal(result.report.lanes.corleone.runs, 2);
  assert.match(result.markdown, /1 malformed lines skipped/);
});

await t("C4 slowestRuns returns longest first and respects n", () => {
  const runs = slowestRuns([
    { ts: "a", lane: "hatta", ok: true, timedOut: false, durationMs: 10, promptLength: 1 },
    { ts: "b", lane: "hatta", ok: true, timedOut: false, durationMs: 30, promptLength: 2 },
    { ts: "c", lane: "hatta", ok: false, timedOut: false, durationMs: 20, promptLength: 3 },
  ], 2);
  assert.deepEqual(runs.map((run) => run.ts), ["b", "c"]);
  assert.equal(runs.length, 2);
});

await t("C5 markdown states ok means exit 0 only and avoids success rate", () => {
  const markdown = renderCostReport({
    totals: costPerLane([{ ts: "t", lane: "x", ok: true, timedOut: false, durationMs: 1 }]).x,
    lanes: costPerLane([{ ts: "t", lane: "x", ok: true, timedOut: false, durationMs: 1 }]),
    slowestRuns: slowestRuns([{ ts: "t", lane: "x", ok: true, timedOut: false, durationMs: 1 }]),
    skippedLines: 0,
  });
  assert.match(markdown, /ok means exit 0 only/);
  assert.match(markdown, /nothing in the log measures whether the work was correct/);
  assert.doesNotMatch(markdown, /success rate/i);
});

await t("C6 read failure returns ok false with error", async () => {
  const fs = {
    readFile: async () => { throw new Error("no usage file"); },
  };
  const result = await buildCostReport({ usageFile: "missing.jsonl", _fs: fs, now });
  assert.equal(result.ok, false);
  assert.equal(result.report, null);
  assert.match(result.error, /no usage file/);
});

console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed) {
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  process.exit(1);
}
