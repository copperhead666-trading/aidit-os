// ops-watcher/ahmad-dispatch.mjs
// P0 CANONICAL AHMAD AUTO-ASSIGN + HEARTBEAT — the piece that actually wakes
// the real orchestrator. Everything upstream of this file (telegram-listener.mjs
// creating a DIRECTIVE issue and auto-assigning it to Paperclip's "Ahmad"
// identity record, AHMAD_AGENT_ID) already existed or was fixed alongside this
// file; this is the missing external dispatch step.
//
// WHY EXTERNAL (not Paperclip's native heartbeat/adapter engine):
// Paperclip's OWN "Ahmad" agent record (id cdea95bd-...) is a claude_local
// persona with runtimeConfig.heartbeat.enabled = false. It must STAY false
// forever — enabling it would spawn a SECOND Claude Code CLI instance under
// Paperclip's own engine, sharing the exact same Anthropic account/quota as the
// real orchestrator (this is the "second Ahmad orchestrator" the P0 mission
// explicitly forbids; see config/agent-registry.json hazard_3). This script is
// the same "external dispatch mechanism" pattern already established for the
// 11 DORMANT hermes_generic specialists (hazard_1) and for GIBRAN's real
// dispatch (review-runner.mjs spawns `hermes` directly, never Paperclip's
// engine, even though GIBRAN also has a claude_local-labeled Paperclip record
// used purely for assignment/attribution) — AHMAD_AGENT_ID here plays the exact
// same "identity of record, not the execution path" role GIBRAN's id already
// plays in review-runner.mjs.
//
// WAKE PATHS (two, by design — mission requires both, doing different jobs):
//   1. FAST PATH (assignment-triggered): telegram-listener.mjs already spawns
//      `node ops-watcher/heartbeat.mjs --once` detached, immediately, the
//      moment a DIRECTIVE issue is created (pre-existing "event-driven wake"
//      code, see telegram-listener.mjs). Adding this script as heartbeat.mjs's
//      7th step means that pre-existing immediate spawn IS the fast path — no
//      new spawn call was needed in telegram-listener.mjs.
//   2. RECOVERY PATH (periodic, fallback only): ops-watcher/heartbeat-daemon.mjs
//      already re-runs heartbeat.mjs (and therefore this step) every 5 minutes
//      unattended. If the fast path was missed (e.g. Paperclip was down at
//      directive-creation time, or the fast-path spawn itself failed), this
//      periodic sweep is what eventually finds and dispatches the orphaned
//      DIRECTIVE issue. It does the SAME work as the fast path, not different
//      work — recovery.md's "re-verify state from canonical sources" rule.
//
// DUPLICATE-DISPATCH PROTECTION (two layers, BOTH required — see KOL-33 incident):
//   LAYER 1 — per-script single-instance lock (NEW, fixes the TOCTOU race that
//     caused KOL-33's 6 duplicate AHMAD DISPATCH markers within ~150ms):
//     runAhmadDispatchOnce() acquires a PID-based file lock for the WHOLE sweep
//     BEFORE doing any Paperclip GET/POST, and releases it in a finally block
//     when the sweep finishes or throws. This reuses the EXACT same
//     acquireLock/releaseLock/isPidAliveReal implementation already exported
//     from ops-watcher/telegram-listener-daemon.mjs (PID-based, stale-lock-aware,
//     already unit-tested). Why this is needed on TOP of the marker-comment
//     guard below: the marker-comment guard is a check-then-act (GET comments ->
//     no marker -> POST marker) with NO lock between the GET and the POST, so
//     when multiple invocations of this script run concurrently (which genuinely
//     happens: telegram-listener.mjs's event-driven wake, heartbeat-daemon.mjs's
//     5-min timer, and a manually/test-triggered heartbeat.mjs run can all
//     overlap), ALL of them read "no marker yet" before any of their POSTs land,
//     and ALL of them post a marker + spawn a real headless claude.exe. The
//     single-instance lock makes the whole sweep mutually exclusive so a
//     concurrent second invocation sees the lock held, logs a clear message, and
//     exits cleanly (no crash, no queue, no retry-loop) rather than racing the
//     first one. This mirrors exactly why telegram-listener-daemon.mjs already
//     needed this pattern (its property 5).
//   LAYER 2 — Paperclip-derived marker comment (pre-existing, the GET/POST
//     check-then-act): before spawning headless AHMAD for an issue, this script
//     POSTs an "AHMAD DISPATCH" marker comment FIRST, then spawns. A LATER sweep
//     (a truly separate run, after the first has released the lock) sees that
//     marker comment already present and skips. This closes the cross-RUN race
//     (fast path ran, lock released, recovery path then fires) but CANNOT close
//     the within-run concurrency race on its own — that is LAYER 1's job. The
//     two layers compose: LAYER 1 makes a single sweep atomic; LAYER 2 makes
//     successive sweeps idempotent.
//
// HEADLESS AHMAD SCOPE: spawned via `claude -p`, with the built-in
// Bash/Write/Edit/NotebookEdit tools disallowed and replaced by the single
// scoped run_command tool in ops-watcher/ahmad-mcp-server.mjs (see that file's
// header for why plain --allowedTools sub-pattern scoping does not work here —
// verified empirically, not assumed). In addition to run_command, the built-in
// Artifact tool is also explicitly granted via --allowedTools so headless AHMAD
// can publish visual content (KPI mockups, widget/dashboard designs, etc.) for
// the OWNER to view via a Telegram-delivered link — Telegram itself cannot
// render rich visual content, so a published Artifact page is the channel
// through which the OWNER actually sees a design rather than only a plain-text
// description. This does NOT conflict with the Bash/Write/Edit/NotebookEdit
// boundary those disallowed tools enforce: Artifact is a PRESENTATION capability
// (it renders a standalone viewable page), not a filesystem-write or
// shell-execution capability, so headless AHMAD still cannot implement code
// directly and must still delegate real implementation to HATTA via run_command
// — only whole-tool-name entries are used in --allowedTools/--disallowedTools,
// never sub-pattern scoping (which this file's own header documents was found
// unreliable empirically; do not reintroduce it). Spawned DETACHED
// (fire-and-forget): AHMAD may need to delegate to HATTA and wait for a real
// build+test+GIBRAN cycle, which can run long (this session's own history shows
// single phases taking many minutes) — blocking heartbeat.mjs's sequential
// sweep on that would delay every other step (telegram-listener, cockpit, etc.)
// for the same sweep. Completion is therefore NOT observed via this script's
// own exit code; it is observed the way this whole org already verifies
// everything: by re-querying Paperclip afterward (a status/label change, a
// completion comment) and by the OWNER receiving the Telegram message the
// headless AHMAD process itself sends as part of its own work.
//
//   node ops-watcher/ahmad-dispatch.mjs --once

import { promises as fs } from "node:fs";
import { openSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  discoverPaperclipPort,
  httpGet,
  httpPost,
  httpPatch,
} from "./paperclip-write-client.mjs";
import {
  acquireLock as acquireLockReal,
  releaseLock as releaseLockReal,
  isPidAliveReal,
} from "./telegram-listener-daemon.mjs";
import { AHMAD_AGENT_ID } from "./telegram-listener.mjs";
import { retrieveDispatchContext as retrieveDispatchContextReal } from "./ahmad-context-retrieval.mjs";
import { readLaneHealth } from "./lane-usage.mjs";
import { judgeWrite } from "./write-delivery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export const COMPANY_ID = "a7011f31-8891-4581-b8fb-bbda8ac6a890";
const DISPATCH_MARKER = "AHMAD DISPATCH";
// Separate marker for the stuck-recovery dispatch path, so the two dispatch
// paths (DIRECTIVE vs stuck-recovery) have INDEPENDENT idempotency tracking —
// an issue already dispatched for stuck recovery must not be re-dispatched by
// the stuck path on a later sweep, and vice versa for the DIRECTIVE path.
const STUCK_RECOVERY_MARKER = "AHMAD STUCK-RECOVERY DISPATCH";
// DELIBERATE DUPLICATE of STUCK_RUNNING_MIN in ops-watcher/watcher.mjs (same
// value, 45). We do NOT import it from watcher.mjs because importing from
// watcher.mjs would pull in that module's own heavy dependencies/side effects
// (collectSnapshot, the full detector pipeline, state persistence) into
// ahmad-dispatch.mjs's simpler footprint. This mirrors the EXACT SAME
// already-documented pattern this codebase uses for CANONICAL_COMPANY_ID being
// duplicated between watcher.mjs and paperclip-write-client.mjs (watcher.mjs's
// own comment explains: the two modules have a circular-import relationship via
// discoverPaperclipPort/httpGet, so a documented duplicated constant is the
// honest fix). watcher.mjs and ahmad-dispatch.mjs must stay in sync on this
// value — watcher.regression.test.mjs asserts the watcher side stays equal to
// 45; ahmad-dispatch.regression.test.mjs asserts this side's stuck-recovery
// threshold behaves identically.
const STUCK_THRESHOLD_MIN = 45;
const TERMINAL_STATUSES = new Set(["done", "cancelled"]);
const MCP_CONFIG_PATH = path.join(__dirname, "ahmad-mcp-config.json");
// Headless AHMAD is spawned detached/fire-and-forget (see spawnHeadlessAhmadReal's
// header comment for why); its stdout (the --output-format json final result) was
// previously stdio:"ignore" — completely discarded — which meant a run that skipped
// a required step (e.g. the KOL-73 soak test, 2026-08-31, where the Paperclip
// wrap-up comment was silently skipped even though the Telegram completion message
// was sent) left NO record of what the headless instance actually did or reasoned.
// Now captured to a per-run log file so a skipped/wrong step is diagnosable after
// the fact instead of only inferable from side effects.
const DISPATCH_RUN_LOG_DIR = path.join(__dirname, "ahmad-dispatch-runs");
const CONTEXT_RETRIEVAL_TIMEOUT_MS = 6000;
// LAYER 1: single-instance lock for the whole --once sweep. Reuses the EXACT
// same PID-based, stale-lock-aware implementation exported from
// telegram-listener-daemon.mjs (acquireLock/releaseLock/isPidAliveReal). A
// concurrent second invocation sees the lock held, logs clearly, and exits
// cleanly (returns { refused: true }) instead of racing the first.
const LOCK_FILE = path.join(__dirname, "ahmad-dispatch.lock");

const iso = () => new Date().toISOString();

function hasLabel(it, name) {
  const want = String(name).toUpperCase();
  return (it.labels || []).some((l) => {
    const n = typeof l === "string" ? l : l && l.name ? l.name : "";
    return String(n).toUpperCase() === want;
  });
}

// Stuck-recovery detector — matches watcher.mjs's now-fixed detectStuckRunning
// logic exactly: same field name `executionLockedAt` (camelCase, matching the
// live Paperclip API shape), same status string `in_progress`, same threshold
// direction (locked must be at least STUCK_THRESHOLD_MIN minutes ago). Returns
// false when executionLockedAt is missing/null/NaN (no lock timestamp means we
// can't tell if it's actually stale — matches the real Paperclip semantics).
function isStuckInProgress(it, nowMs) {
  if ((it.status || "").toLowerCase() !== "in_progress") return false;
  const locked = it.executionLockedAt ? Date.parse(it.executionLockedAt) : NaN;
  if (!Number.isFinite(locked)) return false;
  return (nowMs - locked) >= STUCK_THRESHOLD_MIN * 60_000;
}

// Shared closing instructions — the "Your tools are scoped..." paragraph through
// the final "Never claim something is done..." line. Identical prose for both
// the DIRECTIVE packet and the stuck-recovery packet, so both give headless
// AHMAD the same tool-scope boundary, the same implementation-lane menu, the
// same Bahasa-Indonesia language rule, and the same completion protocol.
// Render measured lane reliability for the packet. Availability only means a
// lane answers; this is what it is like to WAIT for it. Hard-coding these
// numbers is what made the old menu wrong — it advertised HATTA as the good
// default while HATTA was timing out on ~44% of its runs — so they are always
// derived from the log, never written by hand.
function laneHealthSuffix(health, laneName) {
  const h = health && health[laneName];
  if (!h || !Number.isFinite(h.n)) return " (keandalan terukur: belum ada data)";
  return ` (keandalan terukur: ${h.successRate}% sukses, ${h.timeoutRate}% timeout, n=${h.n})`;
}

function buildSharedClosingInstructions(ident, health = null) {
  return [
    `Your tools are scoped to a single run_command MCP tool (Bash/Write/Edit are disallowed for this session) — see its description for exactly what it accepts. You cannot edit files directly; when implementation is needed, delegate it via run_command to one of the implementation lanes below, then independently re-verify the result from canonical sources (re-read the file/output) rather than trusting its own stdout claim, per this org's orchestration/recovery skills.`,
    ``,
    `Implementation lanes available to you via run_command (pick the one that fits the task; you may run 'node ops-watcher/routing.mjs --probe-all' via run_command BEFORE picking a lane to see live availability AND measured reliability. Availability only means a lane answers. Prefer a lane that is both available and reliable, and do not send a large or multi-file task to a lane with a high measured timeout rate.)`,
    `COST NOTE: HATTA, HATTA-FLASH, SJAHRIR, and CORLEONE are ALL paid flat-rate subscriptions the OWNER already pays for regardless of usage (Ollama Cloud Pro, Kimi Code, and ChatGPT Plus respectively — none of them are free). There is no per-call cost difference between them, so never pick one because it seems "cheaper" — none is. Pick based on which lane genuinely fits the task. The OWNER has specifically said CORLEONE has been sitting underused relative to what is being paid for and wants it used MORE — treat CORLEONE as a first-class choice for a fair share of tasks, not only as a fallback when HATTA/SJAHRIR are unavailable.`,
    `  - HATTA: 'node ops-watcher/hatta-dispatch.mjs "<prompt>"' — a general-purpose implementation lane (Ollama Cloud Pro).${laneHealthSuffix(health, "hatta")}`,
    `  - HATTA-FLASH: 'node ops-watcher/hatta-flash-dispatch.mjs "<prompt>"' — the same paid lane, using a smaller/faster model (glm-5.3-flash:cloud). Prefer this over plain HATTA for trivial, low-risk, low-context tasks (a one-line text edit, a quick lookup/summary, a short throwaway script) where speed matters more than depth — not because it is cheaper (it is the same subscription), simply faster for light work.${laneHealthSuffix(health, "hatta-flash")}`,
    `  - SJAHRIR: 'node ops-watcher/sjahrir-dispatch.mjs "<prompt>"' — prefer when the task needs heavy context, deep research, or synthesis. This project's own routing.mjs (resolveSjahrirModel) documents the split: synthesis/research -> use the K3-256K model; bounded coding -> K2.7 Code; escalation -> full K3. Pick SJAHRIR when the work is context-heavy rather than for ordinary implementation.${laneHealthSuffix(health, "sjahrir")}`,
    `  - CORLEONE: 'node ops-watcher/corleone-dispatch.mjs "<prompt>"' — a strong implementation lane via the Codex CLI (ChatGPT Plus). The OWNER wants this lane used more, not just as a fallback — actively consider it for a reasonable share of ordinary implementation tasks, the same way you would consider HATTA, rather than reaching for it only when other lanes are in cooldown.${laneHealthSuffix(health, "corleone")}`,
    `  - GRAPHIFY-ANALYST: 'node ops-watcher/graphify-analyst.mjs "<structural question>"' — NOT an implementation lane; use this when you need to answer a structural/multi-hop question about how code relates across files (e.g. "what calls X", "what depends on Y") using the existing code graph, before deciding how to implement something. It discloses if the graph is stale rather than answering silently on outdated structure.`,
    ``,
    `LANGUAGE: the OWNER is an Indonesian speaker. Every message you send the OWNER — the Paperclip comment in step 1 below AND the ahmad-notify.mjs message in step 2 — MUST be written in professional Bahasa Indonesia, not English. Keep code, file paths, commands, and technical identifiers verbatim (untranslated); translate only the surrounding prose.`,
    ``,
    `When you are done (or if you determine no action is needed), you MUST, via run_command, BOTH of the following — neither is optional, and step 1 must happen before step 2:`,
    `  1. Post a comment on issue ${ident} (node ops-watcher/review-runner.mjs / a small inline call, or have HATTA's result posted) describing, in Bahasa Indonesia, what you did and the outcome. This is the durable audit record in Paperclip — do not skip it even after step 2 is sent.`,
    `  2. Send the OWNER a completion message, in Bahasa Indonesia, via node ops-watcher/ahmad-notify.mjs "<your message text>" so they see a real response on their phone (ops-watcher/telegram-notify.mjs is a DIFFERENT script scoped only to OWNER_REQUIRED decision buttons — it will not send this).`,
    `Never claim something is done without independently re-verifying it from Paperclip or the filesystem — this org's standing rule.`,
  ];
}

function buildColdTaskPacket(it, health = null) {
  const ident = it.identifier || it.id;
  const opening = [
    `You are AHMAD, the primary owner-facing orchestrator for Active FounderOS-Aidit, running headless (spawned by ops-watcher/ahmad-dispatch.mjs from an OWNER Telegram directive).`,
    ``,
    `Paperclip issue ${ident} (id ${it.id}) is assigned to you. This is the OWNER's directive:`,
    `--- title ---`,
    String(it.title || ""),
    `--- description ---`,
    String(it.description || ""),
    ``,
  ];
  return [...opening, ...buildSharedClosingInstructions(ident, health)].join("\n");
}

// Stuck-recovery packet — different opening framing (there is no "OWNER
// directive text" for a stuck issue; instead we describe the stuck symptom and
// give AHMAD a two-path decision: fix-and-delegate OR escalate-to-owner), then
// the SAME shared closing block so the tool-scope boundary, implementation-lane
// menu, language rule, and completion protocol are identical to the DIRECTIVE
// packet.
function buildStuckRecoveryPacket(it, health = null) {
  const ident = it.identifier || it.id;
  const opening = [
    `You are AHMAD, the primary owner-facing orchestrator for Active FounderOS-Aidit, running headless (spawned by ops-watcher/ahmad-dispatch.mjs). You are being woken NOT by an OWNER directive, but because Paperclip issue ${ident} appears STUCK: its status is 'in_progress' but there has been no progress for over ${STUCK_THRESHOLD_MIN} minutes (executionLockedAt: ${it.executionLockedAt}).`,
    ``,
    `Paperclip issue ${ident} (id ${it.id}):`,
    `--- title ---`,
    String(it.title || ""),
    `--- description ---`,
    String(it.description || ""),
    ``,
    `Investigate: read the issue's title/description/comments and any related files or logs to understand what it was doing and why it stalled. Then choose exactly ONE path:`,
    `  (a) if you can determine the cause and it's a normal implementation/technical problem, delegate a fix via HATTA/SJAHRIR/CORLEONE as appropriate (same lane-selection guidance as below) and let the normal DIRECTIVE-style flow resume;`,
    `  (b) if resolving this genuinely requires the OWNER's judgment — it has real product, business, legal, financial, or privacy consequences, touches an irreversible action, or concerns a safety-critical system (e.g. real-money trading) — do NOT attempt a fix yourself; instead escalate via 'node ops-watcher/ahmad-escalate.mjs "${ident}" "<your reason, in Bahasa Indonesia>"' and stop.`,
    `Do not do both — pick (a) or (b), not partial work on both.`,
    ``,
  ];
  return [...opening, ...buildSharedClosingInstructions(ident, health)].join("\n");
}

function compactLine(v, max = 180) {
  const s = String(v || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 3).trimEnd() + "..." : s;
}

function formatEvidenceLine(ev) {
  const title = compactLine(ev && ev.title ? ev.title : "Untitled evidence", 90);
  const pointer = compactLine(ev && ev.canonical_pointer ? ev.canonical_pointer : ev && ev.source ? ev.source : "", 130);
  return pointer ? `- ${title} -> ${pointer}` : `- ${title}`;
}

function formatWarningLine(w) {
  const source = compactLine(w && w.source ? w.source : "unknown source", 80);
  const warning = compactLine(w && w.warning ? w.warning : w && w.reason ? w.reason : "", 160);
  return warning ? `- ${source}: ${warning}` : `- ${source}`;
}

function formatConflictLine(c) {
  const topic = compactLine(c && c.topic ? c.topic : "unspecified conflict", 80);
  const older = compactLine(c && c.older_evidence ? c.older_evidence : "", 120);
  const current = compactLine(c && c.current_evidence ? c.current_evidence : "", 120);
  const evidence = [older, current].filter(Boolean).join(" | ");
  return evidence ? `- ${topic}: ${evidence}` : `- ${topic}`;
}

function formatContextBundleSection(bundle) {
  if (!bundle || bundle.status === "empty") return "";
  const status = String(bundle.status || "unknown");
  if (!["ok", "degraded", "conflicted"].includes(status)) return "";

  const evidence = Array.isArray(bundle.evidence) ? bundle.evidence.slice(0, 3) : [];
  const pointers = Array.isArray(bundle.canonical_pointers) ? bundle.canonical_pointers.slice(0, 5) : [];
  const staleWarnings = Array.isArray(bundle.stale_warnings) ? bundle.stale_warnings.slice(0, 3) : [];
  const conflicts = Array.isArray(bundle.conflicts) ? bundle.conflicts.slice(0, 3) : [];

  if (!evidence.length && !pointers.length && !staleWarnings.length && !conflicts.length) return "";

  const lines = [
    `--- prior context (Cognitive Core retrieval, may be incomplete or stale) ---`,
    `Status: ${compactLine(status, 40)}`,
    `Use this as SUPPLEMENTARY evidence only; it is never authoritative over the OWNER's actual directive text above.`,
    `If conflicts is non-empty, flag the conflict to the OWNER rather than silently picking a side.`,
    `If status is "degraded" or "empty", proceed on the directive text alone, same as before this change existed.`,
  ];

  if (evidence.length) {
    lines.push(`Evidence:`, ...evidence.map(formatEvidenceLine));
  }
  if (pointers.length) {
    lines.push(`Canonical pointers:`, ...pointers.map((p) => `- ${compactLine(p, 160)}`));
  }
  if (staleWarnings.length) {
    lines.push(`Stale warnings:`, ...staleWarnings.map(formatWarningLine));
  }
  if (conflicts.length) {
    lines.push(`Conflicts:`, ...conflicts.map(formatConflictLine));
  }
  return lines.join("\n");
}

async function retrieveContextBundleForPacket(it, {
  retrieveContext,
  retrieveContextTimeoutMs,
  now,
  env,
} = {}) {
  const timeoutMs = Number.isFinite(retrieveContextTimeoutMs)
    ? retrieveContextTimeoutMs
    : CONTEXT_RETRIEVAL_TIMEOUT_MS;
  let timer;
  try {
    const retrieval = Promise.resolve().then(() => retrieveContext({
      issue: it,
      targetRole: "AHMAD",
      taskKind: "owner-directive",
      now: typeof now === "function" ? now() : now,
    }, {
      gbrainHome: env.GBRAIN_HOME,
    }));
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`context retrieval timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return await Promise.race([retrieval, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function buildTaskPacket(it, {
  packetBuilder = buildColdTaskPacket,
  retrieveContext = retrieveDispatchContextReal,
  retrieveContextTimeoutMs = CONTEXT_RETRIEVAL_TIMEOUT_MS,
  now = () => Date.now(),
  env = process.env,
  laneHealth,
} = {}) {
  // Resolved once per packet. Never allowed to break a dispatch: an unreadable
  // log renders "belum ada data" rather than throwing.
  let health = laneHealth;
  if (health === undefined) {
    try { health = await readLaneHealth(); } catch { health = null; }
  }
  const coldPacket = packetBuilder(it, health);
  let bundle;
  try {
    bundle = await retrieveContextBundleForPacket(it, {
      retrieveContext,
      retrieveContextTimeoutMs,
      now,
      env,
    });
  } catch {
    return coldPacket;
  }
  const section = formatContextBundleSection(bundle);
  if (!section) return coldPacket;
  return [
    coldPacket,
    ``,
    section,
  ].join("\n");
}

// ---- Spawn headless AHMAD (real, detached). Injectable for tests. ----
export function spawnHeadlessAhmadReal(packet, { claudeExe = "claude.exe", mcpConfigPath = MCP_CONFIG_PATH, identifier = "unknown" } = {}) {
  const args = [
    "-p", packet,
    "--mcp-config", mcpConfigPath,
    "--disallowedTools", "Bash,Write,Edit,NotebookEdit",
    // A fresh (session-local) MCP server's tools are auto-DENIED under
    // --permission-mode dontAsk unless explicitly granted here — verified live
    // 2026-08-28: without this flag every run_command call came back "denied
    // because Claude Code is running in don't ask mode", even though the tool
    // itself was correctly loaded and Bash was correctly absent. This is the
    // opposite of dontAsk's effect on already-trusted BUILT-IN tools (which it
    // auto-allows) — asymmetry confirmed empirically, not assumed.
    //
    // Artifact (a built-in tool) is granted alongside run_command so headless
    // AHMAD can publish visual content (KPI mockups, widget/dashboard designs)
    // for the OWNER to view via a Telegram-delivered link — Telegram itself
    // cannot render rich visual content, so a Artifact page is the channel.
    // This is a PRESENTATION capability, not a filesystem-write or
    // shell-execution capability, so it does NOT conflict with the
    // Bash/Write/Edit/NotebookEdit disallow boundary above; headless AHMAD
    // still cannot implement code directly and must still delegate real
    // implementation to HATTA via run_command. Only whole-tool-name entries are
    // used here (no sub-pattern scoping — see this file's header).
    "--allowedTools", "mcp__ahmad-tools__run_command,Artifact",
    "--permission-mode", "dontAsk",
    "--output-format", "json",
    "--append-system-prompt", "You are AHMAD (headless dispatch). Delegate implementation to HATTA via the run_command tool; you do not edit files yourself. Every OWNER-facing message you write (Paperclip comments, ahmad-notify.mjs messages) must be in professional Bahasa Indonesia, not English — the OWNER is an Indonesian speaker. Keep code/paths/commands verbatim.",
  ];
  const safeIdent = String(identifier).replace(/[^A-Za-z0-9_-]/g, "_");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let stdio = "ignore";
  let logFile = null;
  try {
    mkdirSync(DISPATCH_RUN_LOG_DIR, { recursive: true });
    logFile = path.join(DISPATCH_RUN_LOG_DIR, `${safeIdent}-${ts}.log`);
    const fd = openSync(logFile, "a");
    stdio = ["ignore", fd, fd];
  } catch {
    // Logging is best-effort — never block the actual dispatch on it.
    stdio = "ignore";
    logFile = null;
  }
  const child = spawn(claudeExe, args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio,
    windowsHide: true,
  });
  child.unref();
  return { pid: child.pid, logFile };
}

// ---- Core, dependency-injected sweep ----
// deps: { base, companyId, httpGet, httpPost, httpPatch, spawnAhmad,
//         retrieveContext, retrieveContextTimeoutMs, log, now,
//         lockFile, acquireLock, releaseLock, isAlive, lockPid, _fs }
//
// LAYER 1 lock: the WHOLE sweep is single-instance. acquireLock is the FIRST
// async action and releaseLock is in a finally, so a sweep that throws, returns
// early (no base / network error / refused), or completes normally always
// releases the lock. A concurrent invocation that finds the lock held gets
// { refused: true, pid } back and does NO Paperclip GET/POST/spawn at all —
// closing the KOL-33 TOCTOU race at its source (the GET-comments / POST-marker
// check-then-act) by making the entire sweep mutually exclusive.
export async function runAhmadDispatchOnce(deps) {
  const {
    base,
    companyId = COMPANY_ID,
    httpGet: _get = httpGet,
    httpPost: _post = httpPost,
    httpPatch: _patch = httpPatch,
    spawnAhmad = spawnHeadlessAhmadReal,
    laneHealth,
    retrieveContext = retrieveDispatchContextReal,
    retrieveContextTimeoutMs = CONTEXT_RETRIEVAL_TIMEOUT_MS,
    log = (m) => console.log(m),
    now = () => Date.now(),
    lockFile = LOCK_FILE,
    acquireLock: _acquireLock = acquireLockReal,
    releaseLock: _releaseLock = releaseLockReal,
    isAlive = isPidAliveReal,
    lockPid = process.pid,
    _fs = fs,
  } = deps;

  const results = [];

  // ---- LAYER 1: single-instance lock for the whole sweep ----
  let lock;
  try {
    lock = await _acquireLock({ lockFile, pid: lockPid, isAlive, _fs });
  } catch (err) {
    // A lock-layer failure must never silently let the race through; treat it
    // as a refusal so we do not double-dispatch on an unknown lock state.
    const msg = (err && err.stack) ? err.stack : String(err);
    log(`ahmad-dispatch: lock acquire threw (${msg}) -> refusing to run (no double-dispatch on unknown lock state)`);
    return { results, error: "lock-failed", refused: true };
  }
  if (!lock.acquired) {
    log(`ahmad-dispatch: REFUSING to run — another --once sweep is already in progress (pid=${lock.pid}). Remove ${path.basename(lockFile)} only if you are sure it is stale. No Paperclip reads/writes performed, no double-dispatch risk.`);
    return { results, refused: true, pid: lock.pid };
  }
  log(`ahmad-dispatch: acquired sweep lock (pid=${lock.pid}) at ${iso()}`);

  try {
    if (!base) {
      log("ahmad-dispatch: no Paperclip base resolved (instance not running)");
      return { results, error: "no-base" };
    }

    const issuesRes = await _get(`${base}/api/companies/${companyId}/issues`);
    if (issuesRes.networkError) {
      log(`ahmad-dispatch: issues list network error: ${issuesRes.networkErrorMessage}`);
      return { results, error: "network" };
    }
    const issues = Array.isArray(issuesRes.body) ? issuesRes.body : [];

    for (const it of issues) {
      const id = it.id;
      const ident = it.identifier || id;

      // OWNER_REQUIRED blocks all automatic action, checked first (recovery.md).
      // Applies to BOTH the DIRECTIVE path and the stuck-recovery path — an
      // already-escalated issue must never get auto-touched again.
      if (hasLabel(it, "OWNER_REQUIRED")) {
        log(`ahmad-dispatch: ${ident} skipped, OWNER_REQUIRED`);
        continue;
      }

      // ---- DIRECTIVE path: OWNER Telegram directive assigned to AHMAD ----
      if (hasLabel(it, "DIRECTIVE") && it.assigneeAgentId === AHMAD_AGENT_ID && !TERMINAL_STATUSES.has((it.status || "").toLowerCase())) {
        // LAYER 2: Paperclip-derived duplicate-dispatch guard (fresh-marker rule,
        // same shape as test-runner.mjs's "TEST RESULT comment already present"
        // rule). Closes the cross-RUN race (a prior sweep already dispatched this
        // issue and released the lock); it cannot close the within-run concurrency
        // race on its own — LAYER 1 does that.
        const cRes = await _get(`${base}/api/issues/${id}/comments`);
        if (!cRes.networkError) {
          const cmts = Array.isArray(cRes.body) ? cRes.body : [];
          if (cmts.some((c) => String(c.body || "").startsWith(DISPATCH_MARKER))) {
            log(`ahmad-dispatch: ${ident} already has an ${DISPATCH_MARKER} marker -> skip (no double-wake)`);
            continue;
          }
        } else {
          log(`ahmad-dispatch: ${ident} comments list network error (${cRes.networkErrorMessage}) -> skipping this sweep to avoid a duplicate on an unknown state`);
          results.push({ id, identifier: ident, outcome: "skipped-comments-network-error" });
          continue;
        }

        log(`ahmad-dispatch: ${ident} DIRECTIVE assigned to AHMAD, undispatched -> waking headless AHMAD`);
        try {
          // Marker posted BEFORE spawn (commit point): if the spawn itself fails
          // after this, the issue is not silently re-tried forever, but it also
          // means a spawn failure needs a human/next-directive to notice — this is
          // the same "no double-dispatch beats a rare missed spawn" trade-off
          // test-runner.mjs already documents (H1) for its own TEST RESULT marker.
          const mc = await _post(`${base}/api/issues/${id}/comments`, {
            body: `${DISPATCH_MARKER} (ops-watcher/ahmad-dispatch — ${iso()}): waking headless AHMAD for ${ident}.`,
            authorType: "user",
          });
          // The marker is the whole idempotency guard: if it is not stored,
          // the next sweep sees no marker and wakes AHMAD again. A rejected
          // write (401/403, 4xx) arrives with networkError false, so testing
          // that flag alone let an unmarked dispatch through.
          const marked = judgeWrite(mc);
          if (!marked.ok) {
            log(`ahmad-dispatch: ${ident} marker comment NOT posted (${marked.reason}) -> NOT spawning (would risk an unmarked duplicate)`);
            results.push({ id, identifier: ident, outcome: "marker-failed" });
            continue;
          }
          const packet = await buildTaskPacket(it, { retrieveContext, retrieveContextTimeoutMs, now, laneHealth });
          const spawned = spawnAhmad(packet, { identifier: ident });
          log(`ahmad-dispatch: ${ident} spawned headless AHMAD (pid=${spawned && spawned.pid}${spawned && spawned.logFile ? `, log=${spawned.logFile}` : ""})`);
          results.push({ id, identifier: ident, outcome: "dispatched", pid: spawned && spawned.pid });
        } catch (err) {
          const msg = (err && err.stack) ? err.stack : String(err);
          log(`ahmad-dispatch: ${ident} UNEXPECTED ERROR (continuing sweep): ${msg}`);
          results.push({ id, identifier: ident, outcome: "error", error: String(err && err.message || err) });
        }
        // DIRECTIVE path handled this issue — skip the stuck-recovery check.
        continue;
      }

      // ---- STUCK-RECOVERY path: in_progress issue stalled past STUCK_THRESHOLD_MIN ----
      // Reached only when the issue did NOT match the DIRECTIVE path above (an
      // issue could in principle be eligible for either path but not both in
      // the same sweep). Already-escalated issues are excluded by the
      // OWNER_REQUIRED guard at the top of the loop. Uses the SAME two-layer
      // idempotency pattern as the DIRECTIVE path but keyed on
      // STUCK_RECOVERY_MARKER for independent tracking — the structure, error
      // handling, and log messages mirror the DIRECTIVE path closely so the two
      // paths read consistently in this file.
      if (isStuckInProgress(it, now())) {
        const cRes = await _get(`${base}/api/issues/${id}/comments`);
        if (!cRes.networkError) {
          const cmts = Array.isArray(cRes.body) ? cRes.body : [];
          if (cmts.some((c) => String(c.body || "").startsWith(STUCK_RECOVERY_MARKER))) {
            log(`ahmad-dispatch: ${ident} already has an ${STUCK_RECOVERY_MARKER} marker -> skip (no double-wake)`);
            continue;
          }
        } else {
          log(`ahmad-dispatch: ${ident} comments list network error (${cRes.networkErrorMessage}) -> skipping this sweep to avoid a duplicate on an unknown state`);
          results.push({ id, identifier: ident, outcome: "skipped-comments-network-error" });
          continue;
        }

        log(`ahmad-dispatch: ${ident} STUCK (in_progress, stale executionLockedAt) -> waking headless AHMAD for stuck recovery`);
        try {
          // Marker posted BEFORE spawn (same commit-point reasoning as the
          // DIRECTIVE path): no double-dispatch beats a rare missed spawn.
          const mc = await _post(`${base}/api/issues/${id}/comments`, {
            body: `${STUCK_RECOVERY_MARKER} (ops-watcher/ahmad-dispatch — ${iso()}): waking headless AHMAD for stuck recovery on ${ident}.`,
            authorType: "user",
          });
          const marked = judgeWrite(mc);
          if (!marked.ok) {
            log(`ahmad-dispatch: ${ident} stuck-recovery marker comment NOT posted (${marked.reason}) -> NOT spawning (would risk an unmarked duplicate)`);
            results.push({ id, identifier: ident, outcome: "marker-failed" });
            continue;
          }
          const packet = await buildTaskPacket(it, { retrieveContext, retrieveContextTimeoutMs, now, packetBuilder: buildStuckRecoveryPacket, laneHealth });
          const spawned = spawnAhmad(packet, { identifier: ident });
          log(`ahmad-dispatch: ${ident} spawned headless AHMAD for stuck recovery (pid=${spawned && spawned.pid}${spawned && spawned.logFile ? `, log=${spawned.logFile}` : ""})`);
          results.push({ id, identifier: ident, outcome: "stuck-recovery-dispatched", pid: spawned && spawned.pid });
        } catch (err) {
          const msg = (err && err.stack) ? err.stack : String(err);
          log(`ahmad-dispatch: ${ident} UNEXPECTED ERROR in stuck-recovery (continuing sweep): ${msg}`);
          results.push({ id, identifier: ident, outcome: "error", error: String(err && err.message || err) });
        }
      }
    }
    return { results };
  } finally {
    // Always release the lock — on success, on an early return (no-base /
    // network error), and on a thrown error — so a crash here never permanently
    // wedges the dispatch lane (the staleness check would also recover it, but
    // cleaning up is correct and matches telegram-listener-daemon.mjs).
    try {
      await _releaseLock({ lockFile, _fs });
      log(`ahmad-dispatch: released sweep lock (pid=${lock.pid})`);
    } catch (err) {
      log(`ahmad-dispatch: WARN lock release threw (${err && err.message}) — staleness check will recover on next start`);
    }
  }
}

// ---- CLI ----
function parseArgs(argv) {
  const out = { once: false };
  for (let i = 2; i < argv.length; i++) if (argv[i] === "--once") out.once = true;
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.once) {
    console.error("usage: node ops-watcher/ahmad-dispatch.mjs --once");
    process.exit(2);
  }
  const port = await discoverPaperclipPort();
  const base = port ? `http://127.0.0.1:${port}` : null;
  const r = await runAhmadDispatchOnce({ base, log: (m) => console.log(m) });
  if (r.refused) {
    console.log(`ahmad-dispatch --once: refused — another sweep is running (pid=${r.pid})`);
    process.exit(0);
  }
  console.log(`ahmad-dispatch --once: processed ${r.results.length} issue(s)`);
  for (const x of r.results) console.log(`  - ${x.identifier}: ${x.outcome}`);
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
    console.error("ahmad-dispatch fatal:", err && err.stack ? err.stack : err);
    // Best-effort lock cleanup on fatal crash (the staleness check would also
    // recover this, but cleaning up is polite — mirrors telegram-listener-daemon).
    fs.unlink(LOCK_FILE).catch(() => {});
    process.exit(1);
  });
}