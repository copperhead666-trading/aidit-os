// ops-watcher/lane-usage-report.mjs — CLI report/summary for lane-usage.jsonl.
//
//   node ops-watcher/lane-usage-report.mjs
//
// Reads ops-watcher/lane-usage.jsonl (if it doesn't exist yet, prints
// "no usage data yet" and exits 0 — NOT an error). Parses each line as JSON,
// skips malformed lines silently, and prints a simple text summary:
//   - Total entries
//   - Per-lane breakdown: count, success count, failure count, avg durationMs
//   - The 5 most recent entries (timestamp + lane + ok)
//
// This is a diagnostic tool, not a dashboard — plain console.log text output.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USAGE_FILE = path.join(__dirname, "lane-usage.jsonl");

async function main() {
  let raw;
  try {
    raw = await fs.readFile(USAGE_FILE, "utf8");
  } catch {
    console.log("no usage data yet");
    process.exit(0);
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }

  if (entries.length === 0) {
    console.log("no usage data yet");
    process.exit(0);
  }

  console.log(`Total entries: ${entries.length}`);
  console.log("");

  // Per-lane breakdown
  const lanes = new Map();
  for (const e of entries) {
    const lane = e.lane || "(unknown)";
    if (!lanes.has(lane)) {
      lanes.set(lane, { count: 0, success: 0, failure: 0, durationSum: 0, durationCount: 0 });
    }
    const s = lanes.get(lane);
    s.count++;
    if (e.ok === true) s.success++;
    else s.failure++;
    if (typeof e.durationMs === "number") {
      s.durationSum += e.durationMs;
      s.durationCount++;
    }
  }

  console.log("Per-lane breakdown:");
  for (const [lane, s] of lanes) {
    const avgDur = s.durationCount > 0 ? Math.round(s.durationSum / s.durationCount) : null;
    const avgStr = avgDur !== null ? `${avgDur}ms` : "n/a";
    console.log(`  ${lane}: count=${s.count} success=${s.success} failure=${s.failure} avgDuration=${avgStr}`);
  }
  console.log("");

  // 5 most recent entries
  const recent = entries.slice(-5);
  console.log("5 most recent entries:");
  for (const e of recent) {
    const ts = e.ts || "?";
    const lane = e.lane || "(unknown)";
    const okStr = e.ok === true ? "ok" : "FAIL";
    console.log(`  ${ts}  ${lane}  ${okStr}`);
  }

  process.exit(0);
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) {
  main().catch((err) => { console.error("fatal:", err); process.exit(1); });
}