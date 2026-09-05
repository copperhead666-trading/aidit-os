// ops-watcher/lane-usage-aggregate.regression.test.mjs
//
//   node ops-watcher/lane-usage-aggregate.regression.test.mjs

import assert from "node:assert/strict";
import {
  aggregateRuns,
  parseUsageLines,
  renderAggregateMarkdown,
  writeAggregate,
} from "./lane-usage-aggregate.mjs";

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

await t("A1 malformed line is skipped, counted, and does not throw", () => {
  const parsed = parseUsageLines([
    JSON.stringify({ ts: "2026-09-04T00:00:00.000Z", lane: "corleone", ok: true, timedOut: false, durationMs: 100 }),
    "{ broken",
    JSON.stringify({ ts: "2026-09-04T00:00:00.000Z", lane: "hatta", ok: false, timedOut: true, durationMs: 200 }),
  ].join("\n"));
  assert.equal(parsed.runs.length, 2);
  assert.equal(parsed.skipped, 1);
  const aggregate = aggregateRuns(parsed.runs, { now, skippedLines: parsed.skipped });
  assert.equal(aggregate.skippedLines, 1);
});

await t("A2 per-lane okRate, wastedMs, and p50 are computed by hand", () => {
  const aggregate = aggregateRuns([
    { ts: "2026-09-04T00:00:00.000Z", lane: "corleone", ok: true, timedOut: false, durationMs: 100 },
    { ts: "2026-09-04T01:00:00.000Z", lane: "corleone", ok: false, timedOut: true, durationMs: 300 },
    { ts: "2026-09-04T02:00:00.000Z", lane: "corleone", ok: false, timedOut: false, durationMs: 500 },
    { ts: "2026-09-04T03:00:00.000Z", lane: "hatta", ok: true, timedOut: false, durationMs: 80 },
  ], { now });
  assert.equal(aggregate.lanes.corleone.runs, 3);
  assert.equal(aggregate.lanes.corleone.okRate, 1 / 3);
  assert.equal(aggregate.lanes.corleone.wastedMs, 800);
  assert.equal(aggregate.lanes.corleone.p50DurationMs, 300);
  assert.equal(aggregate.lanes.corleone.p95DurationMs, 500);
});

await t("A3 window filter excludes older runs and keeps runs inside days", () => {
  const aggregate = aggregateRuns([
    { ts: "2026-09-01T00:00:00.000Z", lane: "corleone", ok: true, timedOut: false, durationMs: 100 },
    { ts: "2026-09-04T00:00:00.000Z", lane: "corleone", ok: false, timedOut: false, durationMs: 200 },
    { ts: "not-a-date", lane: "hatta", ok: true, timedOut: false, durationMs: 50 },
  ], { now, days: 2 });
  assert.equal(aggregate.totals.runs, 2);
  assert.equal(aggregate.lanes.corleone.runs, 1);
  assert.equal(aggregate.lanes.hatta.runs, 1, "unparseable ts is counted rather than dropped");
});

await t("A4 writeAggregate writes both files and returns ok true", async () => {
  const writes = new Map();
  const fs = {
    readFile: async () => JSON.stringify({ ts: "2026-09-04T00:00:00.000Z", lane: "sjahrir", ok: true, timedOut: false, durationMs: 125 }) + "\n",
    mkdir: async () => {},
    writeFile: async (file, body) => { writes.set(file, body); },
  };
  const result = await writeAggregate({ usageFile: "usage.jsonl", outDir: "out", _fs: fs, now });
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(writes.size, 2);
  assert.ok([...writes.keys()].some((file) => file.endsWith("aggregate.json")));
  assert.ok([...writes.keys()].some((file) => file.endsWith("aggregate.md")));
});

await t("A5 write failure returns ok false with error and does not throw", async () => {
  const fs = {
    readFile: async () => JSON.stringify({ ts: "2026-09-04T00:00:00.000Z", lane: "sjahrir", ok: true, timedOut: false, durationMs: 125 }) + "\n",
    mkdir: async () => {},
    writeFile: async () => { throw new Error("disk full"); },
  };
  const result = await writeAggregate({ usageFile: "usage.jsonl", outDir: "out", _fs: fs, now });
  assert.equal(result.ok, false);
  assert.match(result.error, /disk full/);
});

await t("A6 rendered markdown says ok means exit 0 only", () => {
  const aggregate = aggregateRuns([
    { ts: "2026-09-04T00:00:00.000Z", lane: "gibran", ok: true, timedOut: false, durationMs: 125 },
  ], { now });
  const markdown = renderAggregateMarkdown(aggregate);
  assert.match(markdown, /ok means exit 0 only\./);
  assert.match(markdown, /\| totals \| 1 \| 100% \|/);
});

console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed) {
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  process.exit(1);
}
