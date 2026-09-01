// BOUNDED foreground polling loop for the live Telegram callback retest.
// NOT a daemon. Runs runListenerOnce repeatedly (each sweep ~8s long-poll) with
// a short sleep between sweeps, up to a deadline (seconds, argv[2], default 60).
// Exits EARLY the moment a real callback is processed (outcome other than
// "non-callback-skipped"). Uses the REAL persisted state file so the offset
// survives across invocations (re-invoking this continues the same window).
//
//   node ops-watcher/telegram-listener-bounded-loop.mjs <seconds>
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverPaperclipPort } from "./paperclip-write-client.mjs";
import { runListenerOnce } from "./telegram-listener.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "telegram-listener.state.json");

const deadlineSec = Number.parseInt(process.argv[2] || "60", 10);
const start = Date.now();

async function readStateSummary() {
  try {
    const v = JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
    return `offset=${v.offset} updatedAt=${v.updatedAt || "?"}`;
  } catch (err) {
    return `NO STATE FILE (code=${err && err.code || "?"}) -> offset defaults to 0`;
  }
}

async function main() {
  const port = await discoverPaperclipPort();
  if (!port) { console.log("NO PAPERCLIP INSTANCE — cannot run loop"); process.exit(1); }
  const base = `http://127.0.0.1:${port}`;
  console.log(`[bounded-loop] START ${new Date(start).toISOString()} deadline=${deadlineSec}s`);
  console.log(`[bounded-loop] state-before: ${await readStateSummary()}`);

  let sweep = 0;
  let tapReceived = false;
  while (Date.now() - start < deadlineSec * 1000) {
    sweep++;
    const t0 = Date.now();
    const r = await runListenerOnce({ base, log: (m) => console.log(`  ${m}`) });
    const dur = Date.now() - t0;
    const processed = (r.results || []).filter((x) => x.outcome && x.outcome !== "non-callback-skipped");
    console.log(`[bounded-loop] sweep #${sweep} (${dur}ms): updates=${(r.results||[]).length} processed=${processed.length} error=${r.error || "none"}${r.persistError ? " persistError="+r.persistError : ""}`);
    for (const x of r.results) {
      console.log(`    - update ${x.update_id}: ${x.action || "?"} ${x.shortId || x.identifier || ""} -> ${x.outcome}`);
    }
    if (processed.length > 0) {
      tapReceived = true;
      console.log(`[bounded-loop] *** REAL CALLBACK PROCESSED on sweep #${sweep}: ${JSON.stringify(processed)} ***`);
      console.log(`[bounded-loop] state-after: ${await readStateSummary()}`);
      console.log(`[bounded-loop] STOP (tap received) after ${Math.round((Date.now()-start)/1000)}s`);
      process.exit(0);
    }
    // short sleep between sweeps (Telegram long-poll already blocks ~3s)
    await new Promise((res) => setTimeout(res, 1500));
  }
  console.log(`[bounded-loop] state-after: ${await readStateSummary()}`);
  console.log(`[bounded-loop] WINDOW EXPIRED after ${deadlineSec}s (${sweep} sweeps) — ${tapReceived ? "tap received" : "NO TAP arrived in window"}`);
  process.exit(0);
}
main().catch((e) => { console.error("bounded-loop crashed:", e); process.exit(1); });