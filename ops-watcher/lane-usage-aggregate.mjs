// ops-watcher/lane-usage-aggregate.mjs
// Aggregates append-only per-run lane usage into portable JSON and Markdown.

import { promises as defaultFs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function blankLane() {
  return {
    runs: 0,
    ok: 0,
    failed: 0,
    timedOut: 0,
    okRate: 0,
    durationMs: 0,
    wastedMs: 0,
    wastedRate: 0,
    p50DurationMs: 0,
    p95DurationMs: 0,
  };
}

export function parseUsageLines(text) {
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

export function aggregateRuns(runs, opts = {}) {
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const nowMs = numberOrZero(now());
  const days = Number.isFinite(opts.days) && opts.days > 0 ? opts.days : 30;
  const fromMs = nowMs - days * 24 * 60 * 60 * 1000;
  const generatedAt = new Date(nowMs).toISOString();
  const laneDurations = new Map();
  const lanes = {};
  const totals = { runs: 0, ok: 0, failed: 0, timedOut: 0, durationMs: 0, wastedMs: 0 };

  for (const run of Array.isArray(runs) ? runs : []) {
    const parsedTs = Date.parse(run && run.ts);
    if (Number.isFinite(parsedTs) && (parsedTs < fromMs || parsedTs > nowMs)) continue;

    const lane = typeof (run && run.lane) === "string" && run.lane.trim() ? run.lane : "unknown";
    const durationMs = numberOrZero(run && run.durationMs);
    const isOk = Boolean(run && run.ok === true);
    const timedOut = Boolean(run && run.timedOut === true);

    if (!lanes[lane]) {
      lanes[lane] = blankLane();
      laneDurations.set(lane, []);
    }

    totals.runs++;
    totals.ok += isOk ? 1 : 0;
    totals.failed += isOk ? 0 : 1;
    totals.timedOut += timedOut ? 1 : 0;
    totals.durationMs += durationMs;
    totals.wastedMs += isOk ? 0 : durationMs;

    const item = lanes[lane];
    item.runs++;
    item.ok += isOk ? 1 : 0;
    item.failed += isOk ? 0 : 1;
    item.timedOut += timedOut ? 1 : 0;
    item.durationMs += durationMs;
    item.wastedMs += isOk ? 0 : durationMs;
    laneDurations.get(lane).push(durationMs);
  }

  for (const [lane, item] of Object.entries(lanes)) {
    item.okRate = item.runs === 0 ? 0 : item.ok / item.runs;
    item.wastedRate = item.durationMs === 0 ? 0 : item.wastedMs / item.durationMs;
    item.p50DurationMs = percentile(laneDurations.get(lane) || [], 50);
    item.p95DurationMs = percentile(laneDurations.get(lane) || [], 95);
  }

  return {
    generatedAt,
    window: { from: new Date(fromMs).toISOString(), to: generatedAt, days },
    totals,
    lanes,
    skippedLines: Number.isFinite(opts.skippedLines) ? opts.skippedLines : 0,
  };
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

export function renderAggregateMarkdown(aggregate) {
  const lines = [
    "| lane | runs | okRate | p50DurationMs | wastedRate |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const [lane, item] of Object.entries(aggregate.lanes || {}).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| ${lane} | ${item.runs} | ${pct(item.okRate)} | ${item.p50DurationMs} | ${pct(item.wastedRate)} |`);
  }
  const totals = aggregate.totals || { runs: 0, ok: 0, durationMs: 0, wastedMs: 0 };
  const totalOkRate = totals.runs === 0 ? 0 : totals.ok / totals.runs;
  const totalWastedRate = totals.durationMs === 0 ? 0 : totals.wastedMs / totals.durationMs;
  lines.push(`| totals | ${totals.runs} | ${pct(totalOkRate)} |  | ${pct(totalWastedRate)} |`);
  lines.push("");
  lines.push("ok means exit 0 only.");
  return lines.join("\n") + "\n";
}

export async function writeAggregate(opts = {}) {
  const {
    usageFile = "ops-watcher/lane-usage.jsonl",
    outDir = "state/lane-usage/",
    jsonName = "aggregate.json",
    markdownName = "aggregate.md",
    days = 30,
    _fs = defaultFs,
    now = Date.now,
  } = opts;

  const usagePath = resolveFromRoot(usageFile);
  const targetDir = resolveFromRoot(outDir);
  const jsonFile = path.join(targetDir, jsonName);
  const markdownFile = path.join(targetDir, markdownName);

  try {
    const text = await _fs.readFile(usagePath, "utf8");
    const parsed = parseUsageLines(text);
    const aggregate = aggregateRuns(parsed.runs, { days, now, skippedLines: parsed.skipped });
    const markdown = renderAggregateMarkdown(aggregate);
    await _fs.mkdir(targetDir, { recursive: true });
    await _fs.writeFile(jsonFile, JSON.stringify(aggregate, null, 2) + "\n", "utf8");
    await _fs.writeFile(markdownFile, markdown, "utf8");
    return { ok: true, file: jsonFile, aggregate, error: null };
  } catch (err) {
    return { ok: false, file: jsonFile, aggregate: null, error: err && err.stack ? err.stack : String(err) };
  }
}

function parseArgs(argv) {
  const args = { days: 30, outDir: "state/lane-usage/" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--days") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) args.days = n;
    } else if (argv[i] === "--out") {
      args.outDir = argv[++i] || args.outDir;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await writeAggregate({ days: args.days, outDir: args.outDir });
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  process.stdout.write(renderAggregateMarkdown(result.aggregate));
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
    console.error("lane-usage-aggregate fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
