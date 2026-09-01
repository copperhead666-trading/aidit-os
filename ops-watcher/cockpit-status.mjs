// ops-watcher/cockpit-status.mjs — PHASE 6 (COCKPIT) for the FounderOS-Aidit
// agent org. A NEW, HONEST status aggregator over what genuinely exists in THIS
// workspace today. It is a point-in-time READ-ONLY snapshot — it never writes
// Paperclip state, never dispatches an LLM, never creates an agent record.
//
// It ADAPTS the *design* of the legacy "Bennett cockpit" (status model:
// orchestrator status, activation, queue counts, quota pools, dispatch
// failures) to the CURRENT real Paperclip/runtime truth here — it does NOT
// rebuild the legacy SQLite-backed FounderDb schema, and it does NOT invent the
// legacy's pause/resume/activation/quota-metering concepts which have no real
// data source in this workspace.
//
//   node ops-watcher/cockpit-status.mjs                 # human-readable text -> stdout
//   node ops-watcher/cockpit-status.mjs --json          # machine-readable JSON -> stdout
//   node ops-watcher/cockpit-status.mjs --html <path>   # self-contained static HTML snapshot -> <path>
//
// === What it reports, each fact clearly sourced ===
//   paperclip : reachable? base/port/companyId/issueCount (live discovery via
//               discoverPaperclipPort + listIssues).
//   queue     : real issue counts by status (todo/in_progress/in_review/backlog/
//               blocked/done/cancelled + other) from a live Paperclip issues
//               list; count labeled OWNER_REQUIRED (the Phase-5 Telegram-pending
//               queue); count labeled NEEDS_REWORK.
//   lanes     : real probeLaneAvailability results for ollama/nous/kimi REUSED
//               from routing.mjs (never re-probed by hand) + isInCooldown for
//               each lane (REUSED from routing.mjs).
//   review    : count of issues currently REVIEW_REQUIRED with no VERDICT
//               comment yet vs. count that reached done via a GIBRAN VERDICT
//               comment. The VERDICT: marker + verdict predicate are reused
//               verbatim from watcher.mjs's detectReviewWaiting /
//               review-runner.mjs's findAgentVerdict, including the HONEST
//               BOARD-RELAY model: a VERDICT comment authored by the board
//               (authorType:"user", authorAgentId:null, with a metadata
//               agent_link row) counts as a real verdict too (accepting both
//               camelCase and snake_case author fields — the live API emits
//               camelCase).
//   observability : tail of ops-watcher/events.jsonl; count of error-shaped
//               detector events in the last 24h by timestamp + the single most
//               recent one.
//   quota     : HONEST. This workspace has NO real usage-metering data source
//               (no dailyQuotaLimit/usedToday concept exists, unlike the legacy
//               FounderDb). We report "not available" rather than fabricate
//               numbers. Do NOT replace this with invented figures.
//
// Crash-proof: a Paperclip/network failure is reported in the status object
// (paperclip.reachable=false, queue.error, ...) and the run still completes and
// prints — same never-throw contract as watcher.mjs / paperclip-write-client.mjs.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverPaperclipPort,
  httpGet,
  listIssues,
  CANONICAL_COMPANY_ID,
} from "./paperclip-write-client.mjs";
import {
  probeLaneAvailability,
  isInCooldown,
  LANE_PROBES,
} from "./routing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_FILE = path.join(__dirname, "events.jsonl");

// Status keys we tally explicitly (Paperclip issue statuses observed in this
// workspace). Unknown statuses roll into `other` so we never silently drop one.
const STATUS_KEYS = [
  "todo", "in_progress", "in_review", "backlog", "blocked", "done", "cancelled",
];
// Lanes we report, REUSED from routing.mjs's LANE_PROBES (do not invent lanes).
const LANE_KEYS = Object.keys(LANE_PROBES); // ["ollama","nous","kimi"]
// 24h window for the observability scan.
const OBSERVABILITY_WINDOW_MS = 24 * 60 * 60 * 1000;

// VERDICT marker — reused verbatim from watcher.mjs's detectReviewWaiting
// (`/VERDICT\s*:/i`) and review-runner.mjs's VERDICT_RE. We do NOT reinvent it.
const VERDICT_RE = /VERDICT\s*:/i;
// Verdict predicate — mirrors review-runner.mjs's findAgentVerdict and
// watcher.mjs's commentIsVerdict. A comment counts as a verdict when it carries
// the VERDICT marker AND is authored EITHER by an agent (the legacy
// agent-attributed model: authorAgentId/author_agent_id/derived... truthy) OR by
// the board (the HONEST BOARD-RELAY model used by review-runner.mjs's
// runReviewSweep: authorType:"user", authorAgentId:null, with a metadata
// agent_link row). Recognizing board-relay verdicts here keeps doneViaVerdict /
// hasUnconsumedVerdict accurate under the new production model (otherwise a
// board-relay PASS that reached done would not be counted as "done via GIBRAN
// VERDICT"). We accept both camelCase (what the live API emits) and snake_case
// (what watcher.mjs checks) for robustness.
function commentHasAgentVerdict(c) {
  if (!c) return false;
  if (!VERDICT_RE.test(String(c.body || ""))) return false;
  const agentId =
    c.authorAgentId || c.author_agent_id ||
    c.derivedAuthorAgentId || c.derived_author_agent_id;
  if (agentId) return true;
  const at = String(c.authorType || c.author_type || "").toLowerCase();
  return at === "user";
}
function issueHasAgentVerdict(comments) {
  return Array.isArray(comments) && comments.some(commentHasAgentVerdict);
}

// Case-insensitive label-name extraction (handles string labels and {name}
// objects, as the live API returns).
function labelNames(it) {
  return (it.labels || [])
    .map((l) => (typeof l === "string" ? l : (l && l.name) || ""))
    .map((s) => String(s).toUpperCase());
}
function hasLabelName(it, name) {
  return labelNames(it).includes(String(name).toUpperCase());
}

function tallyByStatus(issues) {
  const by = {};
  for (const k of STATUS_KEYS) by[k] = 0;
  by.other = 0;
  for (const it of issues) {
    const s = String(it.status || "").toLowerCase();
    if (STATUS_KEYS.includes(s)) by[s] += 1;
    else by.other += 1;
  }
  return by;
}

// ---- events.jsonl scan (read-only tail) ----
// "Error-shaped" detectors: everything watcher.mjs emits EXCEPT
// `watcher-heartbeat` (the health beat) and `review-waiting` (a routing signal,
// not a failure). The task names worker-lane-unavailable / paperclip-unreachable
// as examples; the set below is the full known anomaly/error detector roster.
const ERROR_SHAPED_DETECTORS = new Set([
  "worker-lane-unavailable",
  "paperclip-unreachable",
  "stuck-running",
  "blocked-unnotified",
  "gbrain-store-missing",
  "graphify-active-missing",
  "graphify-legacy-missing",
]);

async function scanEvents(file, now, windowMs = OBSERVABILITY_WINDOW_MS) {
  const out = { file, exists: false, totalLines: 0, errorEventCount24h: 0, lastErrorEvent: null };
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return out; // no file yet -> honest empty
  }
  out.exists = true;
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  out.totalLines = lines.length;
  const cutoff = now - windowMs;
  const events = [];
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; } // skip malformed lines
    if (!ev || typeof ev !== "object") continue;
    events.push(ev);
  }
  // newest-first for "most recent" selection
  events.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  for (const ev of events) {
    const det = String(ev.detector || "");
    if (!ERROR_SHAPED_DETECTORS.has(det)) continue;
    if (typeof ev.ts === "number" && ev.ts < cutoff) continue; // outside 24h window
    out.errorEventCount24h += 1;
    if (!out.lastErrorEvent) {
      out.lastErrorEvent = {
        ts: ev.ts || null,
        iso: ev.ts ? new Date(ev.ts).toISOString() : null,
        detector: det,
        target_role: ev.target_role || null,
        payload: ev.payload || null,
      };
    }
  }
  return out;
}

// ---- core status builder (dependency-injected for testability) ----
// deps: { base, companyId, httpGet, listIssues, probeLaneAvailability,
//         isInCooldown, now, eventsFile }
// Every external call is crash-proof; a failure populates an `error`/`reachable`
// field rather than throwing. Returns a plain status object.
export async function buildCockpitStatus(deps = {}) {
  const now = deps.now || Date.now();
  const companyId = deps.companyId || CANONICAL_COMPANY_ID;
  const _httpGet = deps.httpGet || httpGet;
  const _listIssues = deps.listIssues || listIssues;
  const _probeLane = deps.probeLaneAvailability || probeLaneAvailability;
  const _isInCooldown = deps.isInCooldown || isInCooldown;
  const eventsFile = deps.eventsFile || EVENTS_FILE;

  const status = {
    schema: "founderos-aidit-cockpit/1",
    generatedAt: new Date(now).toISOString(),
    generatedAtMs: now,
    paperclip: {
      reachable: false,
      base: deps.base || null,
      port: deps.base ? Number(deps.base.match(/:(\d+)$/)?.[1] || null) : null,
      companyId,
      issueCount: 0,
      error: null,
    },
    queue: { byStatus: {}, ownerRequired: 0, needsRework: 0, total: 0, error: null },
    lanes: {},
    review: {
      reviewRequiredTotal: 0,
      awaitingVerdict: 0,
      hasUnconsumedVerdict: 0,
      doneTotal: 0,
      doneViaVerdict: 0,
      scannedIssues: 0,
      error: null,
    },
    observability: { file: eventsFile, exists: false, errorEventCount24h: 0, lastErrorEvent: null },
    quota: {
      available: false,
      note: "not available in this workspace (no metering data source exists yet)",
    },
  };

  // --- lane health (REUSED from routing.mjs; never re-probed by hand) ---
  for (const lane of LANE_KEYS) {
    let probe, cooldown;
    try {
      probe = await _probeLane(lane);
    } catch (err) {
      probe = { lane, available: false, probe: "error", signal: "probe-threw", reason: String(err && err.message || err) };
    }
    try {
      cooldown = await _isInCooldown(lane);
    } catch (err) {
      cooldown = { inCooldown: false, lane, remainingMs: 0, failureCount: 0, error: String(err && err.message || err) };
    }
    status.lanes[lane] = {
      available: !!probe.available,
      probe: probe.probe || null,
      signal: probe.signal || null,
      reason: probe.reason || null,
      models: probe.models || null,
      version: probe.version || null,
      inCooldown: !!cooldown.inCooldown,
      cooldownRemainingMs: cooldown.remainingMs || 0,
      cooldownExpiresAt: cooldown.expiresAt || null,
      failureCount: cooldown.failureCount || 0,
      lastFailureReason: cooldown.lastFailureReason || null,
    };
  }

  // --- events.jsonl scan (independent of Paperclip reachability) ---
  try {
    status.observability = await scanEvents(eventsFile, now);
  } catch (err) {
    status.observability = {
      file: eventsFile, exists: false, errorEventCount24h: 0, lastErrorEvent: null,
      error: String(err && err.message || err),
    };
  }

  // --- Paperclip issues (crash-proof) ---
  if (!deps.base) {
    status.paperclip.error = "no Paperclip base resolved (instance not running / not discovered)";
    status.queue.error = "paperclip unreachable";
    status.review.error = "paperclip unreachable";
    return status;
  }
  const issuesRes = await _listIssues(deps.base, companyId);
  if (issuesRes.networkError) {
    status.paperclip.error = `listIssues network error: ${issuesRes.networkErrorMessage}`;
    status.queue.error = `paperclip unreachable: ${issuesRes.networkErrorMessage}`;
    status.review.error = `paperclip unreachable: ${issuesRes.networkErrorMessage}`;
    return status;
  }
  if (issuesRes.authRequired) {
    status.paperclip.error = "listIssues auth required (no token resolved)";
    status.queue.error = "paperclip auth required";
    status.review.error = "paperclip auth required";
    return status;
  }
  const issues = Array.isArray(issuesRes.issues) ? issuesRes.issues : [];
  status.paperclip.reachable = true;
  status.paperclip.issueCount = issues.length;

  // queue tally
  status.queue.byStatus = tallyByStatus(issues);
  status.queue.total = issues.length;
  for (const it of issues) {
    if (hasLabelName(it, "OWNER_REQUIRED")) status.queue.ownerRequired += 1;
    if (hasLabelName(it, "NEEDS_REWORK")) status.queue.needsRework += 1;
  }

  // review scan — fetch comments for every REVIEW_REQUIRED issue and every done
  // issue (bounded by the live issue count; each fetch is crash-proof). This is
  // what lets us honestly distinguish "awaiting verdict" from "reached done via
  // a GIBRAN VERDICT comment".
  const reviewRequired = issues.filter((it) => hasLabelName(it, "REVIEW_REQUIRED"));
  const doneIssues = issues.filter((it) => String(it.status || "").toLowerCase() === "done");
  status.review.reviewRequiredTotal = reviewRequired.length;
  status.review.doneTotal = doneIssues.length;

  const toScan = new Map();
  for (const it of reviewRequired) toScan.set(it.id, { it, kind: "review" });
  for (const it of doneIssues) if (!toScan.has(it.id)) toScan.set(it.id, { it, kind: "done" });

  let scanned = 0;
  for (const { it, kind } of toScan.values()) {
    let comments = [];
    if (it._fixtureComments && Array.isArray(it._fixtureComments)) {
      // offline-test shortcut (tests may pre-attach comments to avoid a server)
      comments = it._fixtureComments;
    } else {
      const r = await _httpGet(`${deps.base}/api/issues/${it.id}/comments`);
      if (!r.networkError && Array.isArray(r.body)) comments = r.body;
    }
    scanned += 1;
    const hasVerdict = issueHasAgentVerdict(comments);
    if (kind === "review") {
      if (hasVerdict) status.review.hasUnconsumedVerdict += 1;
      else status.review.awaitingVerdict += 1;
    } else if (kind === "done") {
      if (hasVerdict) status.review.doneViaVerdict += 1;
    }
  }
  status.review.scannedIssues = scanned;

  return status;
}

// ---- text formatter (compact human-readable lines) ----
export function formatText(s) {
  const L = [];
  L.push(`FounderOS-Aidit Cockpit Status — ${s.generatedAt}`);
  const pc = s.paperclip;
  if (pc.reachable) {
    L.push(`Paperclip: REACHABLE at ${pc.base} (company ${pc.companyId}) — ${pc.issueCount} issue(s)`);
  } else {
    L.push(`Paperclip: UNREACHABLE${pc.base ? " at " + pc.base : ""}${pc.error ? " — " + pc.error : ""}`);
  }
  L.push("");

  // queue
  if (s.queue.error) {
    L.push(`Queue: ${s.queue.error}`);
  } else {
    const b = s.queue.byStatus;
    const parts = STATUS_KEYS.map((k) => `${k}:${b[k] || 0}`).join("  ");
    L.push(`Queue (by status, total ${s.queue.total}):`);
    L.push(`  ${parts}  other:${b.other || 0}`);
    L.push(`  OWNER_REQUIRED:${s.queue.ownerRequired}  NEEDS_REWORK:${s.queue.needsRework}`);
  }
  L.push("");

  // lanes
  // NOTE: the colon is placed immediately after the lane name, then the combined
  // "lane:" token is padEnd'd to a fixed width. Putting padEnd on the bare lane
  // name and then a literal ":" produced "ollama :" (space before colon) which
  // broke lane-label matching; the colon must hug the name.
  L.push("Lane health (reused routing.mjs probes):");
  for (const lane of LANE_KEYS) {
    const l = s.lanes[lane];
    const label = (lane + ":").padEnd(8); // "ollama:" -> "ollama: ", "nous:" -> "nous:   "
    if (!l) { L.push(`  ${label} (no data)`); continue; }
    const up = l.available ? "UP  " : "DOWN";
    const cd = l.inCooldown
      ? `cooldown: YES (${Math.round((l.cooldownRemainingMs || 0) / 1000)}s left, failures ${l.failureCount})`
      : "cooldown: no";
    const sig = l.signal ? ` [${l.signal}]` : "";
    const models = l.models && l.models.length ? `; ${l.models.length} models` : "";
    L.push(`  ${label} ${up}  probe:${l.probe}${sig}${models}  ${cd}`);
    if (!l.available && l.reason) L.push(`           reason: ${l.reason}`);
  }
  L.push("");

  // review
  if (s.review.error) {
    L.push(`Review: ${s.review.error}`);
  } else {
    L.push("Review (VERDICT: scan reused from watcher.mjs / review-runner.mjs):");
    L.push(`  REVIEW_REQUIRED: ${s.review.reviewRequiredTotal}  awaiting verdict: ${s.review.awaitingVerdict}  has unconsumed verdict: ${s.review.hasUnconsumedVerdict}`);
    L.push(`  done total: ${s.review.doneTotal}  done via GIBRAN VERDICT: ${s.review.doneViaVerdict}  (scanned comments on ${s.review.scannedIssues} issue(s))`);
  }
  L.push("");

  // observability
  const ob = s.observability;
  L.push(`Observability (events.jsonl, last 24h):`);
  if (ob.error) {
    L.push(`  scan error: ${ob.error}`);
  } else if (!ob.exists) {
    L.push(`  events file not present (${ob.file})`);
  } else {
    L.push(`  file: ${ob.file}  total lines: ${ob.totalLines}  error-shaped events (24h): ${ob.errorEventCount24h}`);
    if (ob.lastErrorEvent) {
      const e = ob.lastErrorEvent;
      L.push(`  most recent: ${e.detector} @ ${e.iso || e.ts} (target ${e.target_role})`);
      L.push(`    payload: ${JSON.stringify(e.payload)}`);
    } else {
      L.push(`  most recent: (none in window)`);
    }
  }
  L.push("");

  // quota — HONEST
  L.push("Quota / cost:");
  if (s.quota.available) {
    L.push(`  (unexpected: quota.available=true) ${JSON.stringify(s.quota)}`);
  } else {
    L.push(`  ${s.quota.note}`);
  }

  return L.join("\n");
}

// ---- HTML formatter (static, self-contained, no external JS/CSS, no network) ----
// The whole page is pre-rendered here in Node; the HTML contains NO <script> and
// NO external resources, so opening it makes zero network calls. It is a literal
// point-in-time snapshot of the status object.
export function formatHtml(s) {
  const esc = (v) => String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const pc = s.paperclip;
  const pcClass = pc.reachable ? "ok" : "bad";

  const laneRows = LANE_KEYS.map((lane) => {
    const l = s.lanes[lane] || {};
    const cls = l.available ? "ok" : "bad";
    const cd = l.inCooldown
      ? `YES (${Math.round((l.cooldownRemainingMs || 0) / 1000)}s left, ${l.failureCount} failures)`
      : "no";
    return `<tr>
      <td>${esc(lane)}</td>
      <td class="${cls}">${l.available ? "UP" : "DOWN"}</td>
      <td>${esc(l.probe)} [${esc(l.signal)}]</td>
      <td>${esc(l.reason)}</td>
      <td>${esc(cd)}</td>
    </tr>`.replace(/\s*\n\s*/g, " ");
  }).join("");

  const ob = s.observability;
  const lastErr = ob.lastErrorEvent
    ? `${esc(ob.lastErrorEvent.detector)} @ ${esc(ob.lastErrorEvent.iso || ob.lastErrorEvent.ts)} (target ${esc(ob.lastErrorEvent.target_role)}) — <code>${esc(JSON.stringify(ob.lastErrorEvent.payload))}</code>`
    : "(none in window)";

  // Simpler, robust status table (the slice above was convoluted; rebuild cleanly):
  const statusPairs = [];
  for (const k of STATUS_KEYS) statusPairs.push(`<td>${esc(k)}</td><td class="num">${s.queue.byStatus[k] || 0}</td>`);
  statusPairs.push(`<td>other</td><td class="num">${s.queue.byStatus.other || 0}</td>`);
  const statusTableRows = [];
  for (let i = 0; i < statusPairs.length; i += 4) {
    statusTableRows.push(`<tr>${statusPairs.slice(i, i + 4).join("")}</tr>`);
  }
  const queueBlockClean = s.queue.error
    ? `<p class="bad">Queue: ${esc(s.queue.error)}</p>`
    : `<table class="grid"><tbody>${statusTableRows.join("")}</tbody></table>
       <p class="labels">OWNER_REQUIRED: <b>${s.queue.ownerRequired}</b> &nbsp; NEEDS_REWORK: <b>${s.queue.needsRework}</b> &nbsp; total: <b>${s.queue.total}</b></p>`;

  const reviewBlock = s.review.error
    ? `<p class="bad">Review: ${esc(s.review.error)}</p>`
    : `<ul>
        <li>REVIEW_REQUIRED: <b>${s.review.reviewRequiredTotal}</b> — awaiting verdict: <b>${s.review.awaitingVerdict}</b> — has unconsumed verdict: <b>${s.review.hasUnconsumedVerdict}</b></li>
        <li>done total: <b>${s.review.doneTotal}</b> — done via GIBRAN VERDICT: <b>${s.review.doneViaVerdict}</b> (scanned comments on ${s.review.scannedIssues} issue(s))</li>
       </ul>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FounderOS-Aidit Cockpit — ${esc(s.generatedAt)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; max-width: 920px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #666; margin: 0 0 16px; }
  h2 { font-size: 15px; margin: 22px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  table { border-collapse: collapse; width: 100%; }
  table.grid td, table.grid th { border: 1px solid #ddd; padding: 3px 8px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .ok { color: #15803d; font-weight: 600; }
  .bad { color: #b91c1c; font-weight: 600; }
  code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .labels { margin: 8px 0 0; }
  .note { color: #555; font-style: italic; }
  .pill { display:inline-block; padding:1px 8px; border-radius:10px; font-weight:600; font-size:12px; }
  .pill.ok { background:#dcfce7; color:#15803d; }
  .pill.bad { background:#fee2e2; color:#b91c1c; }
</style>
</head>
<body>
<h1>FounderOS-Aidit Cockpit Status</h1>
<p class="sub">Point-in-time snapshot generated ${esc(s.generatedAt)} &middot; schema ${esc(s.schema)}</p>

<h2>Paperclip</h2>
<p>Company <code>${esc(pc.companyId)}</code> &middot; base <code>${esc(pc.base || "(not discovered)")}</code></p>
<p>Reachable: <span class="pill ${pcClass}">${pc.reachable ? "YES" : "NO"}</span>${pc.error ? " &mdash; " + esc(pc.error) : ""} &middot; issues: <b>${pc.issueCount}</b></p>

<h2>Queue</h2>
${queueBlockClean}

<h2>Lane health <span class="note">(reused routing.mjs probes)</span></h2>
<table class="grid"><thead><tr><th>lane</th><th>state</th><th>probe</th><th>reason</th><th>cooldown</th></tr></thead><tbody>${laneRows}</tbody></table>

<h2>Review <span class="note">(VERDICT: scan reused from watcher.mjs / review-runner.mjs)</span></h2>
${reviewBlock}

<h2>Observability <span class="note">(events.jsonl, last 24h)</span></h2>
${ob.error ? `<p class="bad">scan error: ${esc(ob.error)}</p>` : ""}
${!ob.error && !ob.exists ? `<p>events file not present (<code>${esc(ob.file)}</code>)</p>` : `
<p>file: <code>${esc(ob.file)}</code> &middot; total lines: <b>${ob.totalLines}</b> &middot; error-shaped events (24h): <b>${ob.errorEventCount24h}</b></p>
<p>most recent: ${lastErr}</p>`}

<h2>Quota / cost</h2>
<p class="note">${s.quota.available ? esc(JSON.stringify(s.quota)) : esc(s.quota.note)}</p>
</body>
</html>`;
}

// ---- CLI ----
function parseArgs(argv) {
  const out = { mode: "text", htmlPath: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.mode = "json";
    else if (a === "--html") { out.mode = "html"; out.htmlPath = argv[++i] || null; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.mode === "html" && !args.htmlPath) {
    console.error("usage: cockpit-status.mjs --html <path>");
    process.exit(2);
  }
  // Discover the canonical Paperclip endpoint (never trust a hardcoded port).
  let port = null;
  try { port = await discoverPaperclipPort(); } catch { port = null; }
  const base = port ? `http://127.0.0.1:${port}` : null;

  const status = await buildCockpitStatus({ base });

  if (args.mode === "json") {
    process.stdout.write(JSON.stringify(status, null, 2) + "\n");
    return;
  }
  if (args.mode === "html") {
    const html = formatHtml(status);
    await fs.writeFile(args.htmlPath, html, "utf8");
    const stat = await fs.stat(args.htmlPath);
    console.log(`wrote ${args.htmlPath} (${stat.size} bytes)`);
    return;
  }
  process.stdout.write(formatText(status) + "\n");
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
    console.error("cockpit-status fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}