// ops-watcher/lane-cost-report.mjs
// Reports cost per landed change by lane without treating exit 0 as correctness.

import { promises as defaultFs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_TIMEOUT_MS = 480_000;

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function positiveInt(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function isTimedOut(run, timeoutMs) {
  if (run && run.timedOut === true) return true;
  return Number.isFinite(run && run.durationMs) && run.durationMs >= timeoutMs;
}

function laneName(run) {
  return typeof (run && run.lane) === "string" && run.lane.trim() ? run.lane : "unknown";
}

function parseUsageLines(text) {
  const runs = [];
  let skipped = 0;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      runs.push(JSON.parse(line));
    } catch {
      skipped++;
    }
  }
  return { runs, skipped };
}

function withinWindow(run, fromMs, nowMs) {
  const parsed = Date.parse(run && run.ts);
  if (!Number.isFinite(parsed)) return true;
  return parsed >= fromMs && parsed <= nowMs;
}

function blankCost() {
  return {
    runs: 0,
    ok: 0,
    failed: 0,
    timedOut: 0,
    okRate: 0,
    totalMs: 0,
    wastedMs: 0,
    wastedRate: 0,
    p50DurationMs: 0,
    p95DurationMs: 0,
    avgPromptLength: 0,
    timeoutRate: 0,
    measured: 0,
    verifyPassed: 0,
    deliveredCount: 0,
    deliveryRate: null,
  };
}

function measuredOutcome(run) {
  const outcome = run && run.outcome;
  return outcome && typeof outcome === "object" && !Array.isArray(outcome) ? outcome : null;
}

function summarizeRuns(runs, opts = {}) {
  const timeoutMs = positiveInt(opts.timeoutMs, DEFAULT_TIMEOUT_MS);
  const item = blankCost();
  const durations = [];
  let promptTotal = 0;
  let promptCount = 0;

  for (const run of Array.isArray(runs) ? runs : []) {
    const durationMs = finiteNumber(run && run.durationMs);
    const ok = Boolean(run && run.ok === true);
    const timedOut = isTimedOut(run, timeoutMs);
    const outcome = measuredOutcome(run);

    item.runs++;
    item.ok += ok ? 1 : 0;
    item.failed += ok ? 0 : 1;
    item.timedOut += timedOut ? 1 : 0;
    item.measured += outcome ? 1 : 0;
    item.verifyPassed += outcome && outcome.verifyPassed === true ? 1 : 0;
    item.deliveredCount += outcome && outcome.deliveredWhatWasAsked === true ? 1 : 0;
    item.totalMs += durationMs;
    item.wastedMs += ok ? 0 : durationMs;
    durations.push(durationMs);

    if (Number.isFinite(run && run.promptLength)) {
      promptTotal += run.promptLength;
      promptCount++;
    }
  }

  item.okRate = item.runs === 0 ? 0 : item.ok / item.runs;
  item.wastedRate = item.totalMs === 0 ? 0 : item.wastedMs / item.totalMs;
  item.p50DurationMs = percentile(durations, 50);
  item.p95DurationMs = percentile(durations, 95);
  item.avgPromptLength = promptCount === 0 ? 0 : promptTotal / promptCount;
  item.timeoutRate = item.runs === 0 ? 0 : item.timedOut / item.runs;
  item.deliveryRate = item.measured === 0 ? null : item.deliveredCount / item.measured;
  return item;
}

export function costPerLane(runs, opts = {}) {
  const byLane = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    const lane = laneName(run);
    if (!byLane.has(lane)) byLane.set(lane, []);
    byLane.get(lane).push(run);
  }

  const out = {};
  for (const [lane, laneRuns] of [...byLane.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out[lane] = summarizeRuns(laneRuns, opts);
  }
  return out;
}

export function slowestRuns(runs, n = 10, opts = {}) {
  const timeoutMs = positiveInt(opts.timeoutMs, DEFAULT_TIMEOUT_MS);
  const limit = positiveInt(n, 10);
  return (Array.isArray(runs) ? runs : [])
    .map((run) => ({
      ts: run && run.ts,
      lane: laneName(run),
      durationMs: finiteNumber(run && run.durationMs),
      ok: Boolean(run && run.ok === true),
      timedOut: isTimedOut(run, timeoutMs),
      promptLength: Number.isFinite(run && run.promptLength) ? run.promptLength : null,
    }))
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, limit);
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function measuredPct(value) {
  return Number.isFinite(value) ? pct(value) : "n/a";
}

export function renderCostReport(report) {
  const lanes = report && report.lanes ? report.lanes : {};
  const totals = report && report.totals ? report.totals : blankCost();
  const slowest = report && Array.isArray(report.slowestRuns) ? report.slowestRuns : [];
  const skippedLines = Number.isFinite(report && report.skippedLines) ? report.skippedLines : 0;
  const laneItems = Object.values(lanes);
  const measuredRuns = laneItems.length ? laneItems.reduce((sum, item) => sum + item.measured, 0) : totals.measured;
  const totalRuns = laneItems.length ? laneItems.reduce((sum, item) => sum + item.runs, 0) : totals.runs;
  const lines = [
    "| lane | runs | okRate | p50DurationMs | p95DurationMs | wastedRate | timeoutRate | measured | verifyPassed | deliveredCount | deliveryRate |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const [lane, item] of Object.entries(lanes).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| ${lane} | ${item.runs} | ${pct(item.okRate)} | ${item.p50DurationMs} | ${item.p95DurationMs} | ${pct(item.wastedRate)} | ${pct(item.timeoutRate)} | ${item.measured} | ${item.verifyPassed} | ${item.deliveredCount} | ${measuredPct(item.deliveryRate)} |`);
  }

  lines.push("");
  lines.push(`Totals: ${totals.runs} runs, ${pct(totals.okRate)} okRate, ${totals.totalMs} totalMs, ${totals.wastedMs} wastedMs (${pct(totals.wastedRate)}), ${pct(totals.timeoutRate)} timeoutRate, ${skippedLines} malformed lines skipped.`);
  lines.push(`${measuredRuns} runs carry a correctness measurement and ${totalRuns - measuredRuns} do not.`);
  lines.push("");
  lines.push("| ts | lane | durationMs | ok | timedOut | promptLength |");
  lines.push("| --- | --- | ---: | --- | --- | ---: |");
  for (const run of slowest) {
    lines.push(`| ${run.ts ?? ""} | ${run.lane} | ${run.durationMs} | ${run.ok} | ${run.timedOut} | ${run.promptLength ?? ""} |`);
  }
  lines.push("");
  lines.push("ok means exit 0 only, and nothing in the log measures whether the work was correct; none of these numbers is a delivery rate.");
  return lines.join("\n") + "\n";
}

export async function buildCostReport(opts = {}) {
  const {
    usageFile = "ops-watcher/lane-usage.jsonl",
    days = 30,
    slowest = 10,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    _fs = defaultFs,
    now = Date.now,
  } = opts;

  const usagePath = resolveFromRoot(usageFile);
  const nowMs = finiteNumber(now());
  const windowDays = positiveInt(days, 30);
  const fromMs = nowMs - windowDays * 24 * 60 * 60 * 1000;

  try {
    const text = await _fs.readFile(usagePath, "utf8");
    const parsed = parseUsageLines(text);
    const runs = parsed.runs.filter((run) => withinWindow(run, fromMs, nowMs));
    const report = {
      generatedAt: new Date(nowMs).toISOString(),
      window: { from: new Date(fromMs).toISOString(), to: new Date(nowMs).toISOString(), days: windowDays },
      totals: summarizeRuns(runs, { timeoutMs }),
      lanes: costPerLane(runs, { timeoutMs }),
      slowestRuns: slowestRuns(runs, slowest, { timeoutMs }),
      skippedLines: parsed.skipped,
    };
    return { ok: true, report, markdown: renderCostReport(report), error: null };
  } catch (err) {
    return { ok: false, report: null, markdown: "", error: err && err.stack ? err.stack : String(err) };
  }
}

function parseArgs(argv) {
  const args = { days: 30, slowest: 10 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--days") {
      args.days = positiveInt(Number(argv[++i]), args.days);
    } else if (argv[i] === "--slowest") {
      args.slowest = positiveInt(Number(argv[++i]), args.slowest);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await buildCostReport(args);
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  process.stdout.write(result.markdown);
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isEntry) {
  main().catch((err) => {
    console.error("lane-cost-report fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
