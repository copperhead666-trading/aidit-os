// ops-watcher/ahmad-dispatch.regression.test.mjs
// Offline regression coverage for the AHMAD auto-dispatch sweep. NO real
// Paperclip, NO real claude spawn — httpGet/httpPost/httpPatch and
// spawnAhmad are all injected. Run with:
//   node ops-watcher/ahmad-dispatch.regression.test.mjs

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { runAhmadDispatchOnce, buildTaskPacket, COMPANY_ID } from "./ahmad-dispatch.mjs";
import {
  acquireLock,
  releaseLock,
  isPidAliveReal,
} from "./telegram-listener-daemon.mjs";
import { AHMAD_AGENT_ID } from "./telegram-listener.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Real PID-based lock implementation against a per-test temp file (NOT the
// production LOCK_FILE) so this stays fully offline/deterministic and never
// collides with a real sweep or another test run.
const TMP_LOCK = path.join(__dirname, "ahmad-dispatch.regression.lock.tmp");

// Fixed "now" for deterministic stuck-threshold tests (50 minutes after a lock
// that is 50 minutes old = stale; 5 minutes after a lock that is 5 minutes old =
// fresh).
const NOW = 2_000_000_000_000;

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };

function issue(overrides = {}) {
  return {
    id: "iss-1",
    identifier: "KOL-100",
    status: "todo",
    labels: [{ name: "DIRECTIVE" }],
    assigneeAgentId: AHMAD_AGENT_ID,
    title: "OWNER DIRECTIVE: test",
    description: "do the thing",
    ...overrides,
  };
}

// A stuck issue: in_progress, NOT a DIRECTIVE issue, NOT OWNER_REQUIRED, with a
// stale executionLockedAt (default 50 minutes ago — past the 45-min threshold).
function stuckIssue(overrides = {}) {
  const lockedAgoMin = overrides._lockedAgoMin != null ? overrides._lockedAgoMin : 50;
  const { _lockedAgoMin: _drop, ...rest } = overrides;
  return issue({
    id: "iss-stuck",
    identifier: "KOL-200",
    status: "in_progress",
    labels: [], // NOT a DIRECTIVE issue — so it doesn't match the DIRECTIVE path
    assigneeAgentId: AHMAD_AGENT_ID,
    title: "Stuck work item",
    description: "something stalled mid-implementation",
    executionLockedAt: new Date(NOW - lockedAgoMin * 60_000).toISOString(),
    ...rest,
  });
}

function coldPacketFor(it) {
  const ident = it.identifier || it.id;
  return [
    `You are AHMAD, the primary owner-facing orchestrator for Active FounderOS-Aidit, running headless (spawned by ops-watcher/ahmad-dispatch.mjs from an OWNER Telegram directive).`,
    ``,
    `Paperclip issue ${ident} (id ${it.id}) is assigned to you. This is the OWNER's directive:`,
    `--- title ---`,
    String(it.title || ""),
    `--- description ---`,
    String(it.description || ""),
    ``,
    `Your tools are scoped to a single run_command MCP tool (Bash/Write/Edit are disallowed for this session) — see its description for exactly what it accepts. You cannot edit files directly; when implementation is needed, delegate it via run_command to one of the implementation lanes below, then independently re-verify the result from canonical sources (re-read the file/output) rather than trusting its own stdout claim, per this org's orchestration/recovery skills.`,
    ``,
    `Implementation lanes available to you via run_command (pick the one that fits the task; you may run 'node ops-watcher/routing.mjs --probe-all' via run_command BEFORE picking a lane to see live availability, and you should prefer a lane reported available over one reported unavailable/in cooldown):`,
    `COST NOTE: HATTA, HATTA-FLASH, SJAHRIR, and CORLEONE are ALL paid flat-rate subscriptions the OWNER already pays for regardless of usage (Ollama Cloud Pro, Kimi Code, and ChatGPT Plus respectively — none of them are free). There is no per-call cost difference between them, so never pick one because it seems "cheaper" — none is. Pick based on which lane genuinely fits the task. The OWNER has specifically said CORLEONE has been sitting underused relative to what is being paid for and wants it used MORE — treat CORLEONE as a first-class choice for a fair share of tasks, not only as a fallback when HATTA/SJAHRIR are unavailable.`,
    `  - HATTA: 'node ops-watcher/hatta-dispatch.mjs "<prompt>"' — a strong general-purpose implementation lane (Ollama Cloud Pro). Good default for ordinary implementation work.`,
    `  - HATTA-FLASH: 'node ops-watcher/hatta-flash-dispatch.mjs "<prompt>"' — the same paid lane, using a smaller/faster model (glm-5.3-flash:cloud). Prefer this over plain HATTA for trivial, low-risk, low-context tasks (a one-line text edit, a quick lookup/summary, a short throwaway script) where speed matters more than depth — not because it is cheaper (it is the same subscription), simply faster for light work.`,
    `  - SJAHRIR: 'node ops-watcher/sjahrir-dispatch.mjs "<prompt>"' — prefer when the task needs heavy context, deep research, or synthesis. This project's own routing.mjs (resolveSjahrirModel) documents the split: synthesis/research -> use the K3-256K model; bounded coding -> K2.7 Code; escalation -> full K3. Pick SJAHRIR when the work is context-heavy rather than for ordinary implementation.`,
    `  - CORLEONE: 'node ops-watcher/corleone-dispatch.mjs "<prompt>"' — a strong implementation lane via the Codex CLI (ChatGPT Plus). The OWNER wants this lane used more, not just as a fallback — actively consider it for a reasonable share of ordinary implementation tasks, the same way you would consider HATTA, rather than reaching for it only when other lanes are in cooldown.`,
    `  - GRAPHIFY-ANALYST: 'node ops-watcher/graphify-analyst.mjs "<structural question>"' — NOT an implementation lane; use this when you need to answer a structural/multi-hop question about how code relates across files (e.g. "what calls X", "what depends on Y") using the existing code graph, before deciding how to implement something. It discloses if the graph is stale rather than answering silently on outdated structure.`,
    ``,
    `LANGUAGE: the OWNER is an Indonesian speaker. Every message you send the OWNER — the Paperclip comment in step 1 below AND the ahmad-notify.mjs message in step 2 — MUST be written in professional Bahasa Indonesia, not English. Keep code, file paths, commands, and technical identifiers verbatim (untranslated); translate only the surrounding prose.`,
    ``,
    `When you are done (or if you determine no action is needed), you MUST, via run_command, BOTH of the following — neither is optional, and step 1 must happen before step 2:`,
    `  1. Post a comment on issue ${ident} (node ops-watcher/review-runner.mjs / a small inline call, or have HATTA's result posted) describing, in Bahasa Indonesia, what you did and the outcome. This is the durable audit record in Paperclip — do not skip it even after step 2 is sent.`,
    `  2. Send the OWNER a completion message, in Bahasa Indonesia, via node ops-watcher/ahmad-notify.mjs "<your message text>" so they see a real response on their phone (ops-watcher/telegram-notify.mjs is a DIFFERENT script scoped only to OWNER_REQUIRED decision buttons — it will not send this).`,
    `Never claim something is done without independently re-verifying it from Paperclip or the filesystem — this org's standing rule.`,
  ].join("\n");
}

// Helper: inject the REAL lock implementation against the temp lock file, so
// the existing offline tests run under the same single-instance guard the
// production sweep uses (and so a leftover temp lock from a prior aborted run
// is recovered by the staleness check, not wedged).
function withRealLock(deps) {
  return {
    lockFile: TMP_LOCK,
    acquireLock,
    releaseLock,
    isAlive: isPidAliveReal,
    _fs: fs,
    retrieveContext: async () => ({
      status: "empty",
      evidence: [],
      canonical_pointers: [],
      stale_warnings: [],
      conflicts: [],
    }),
    ...deps,
  };
}

async function t1_dispatchesUnmarkedAssignedDirective() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  let spawned = null;
  const posted = [];
  const r = await runAhmadDispatchOnce(withRealLock({
    base: "http://127.0.0.1:9999",
    httpGet: async (url) => {
      if (url.endsWith("/issues")) return { networkError: false, body: [issue()] };
      if (url.includes("/comments")) return { networkError: false, body: [] };
      throw new Error("unexpected GET " + url);
    },
    httpPost: async (url, body) => { posted.push({ url, body }); return { networkError: false, status: 201, body: { id: "cmt-1" } }; },
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    spawnAhmad: (packet) => { spawned = packet; return { pid: 4242 }; },
    log: () => {},
  }));
  assert.equal(r.results.length, 1, "T1: one issue processed");
  assert.equal(r.results[0].outcome, "dispatched", "T1: outcome=dispatched");
  assert.equal(r.results[0].pid, 4242, "T1: spawn pid surfaced");
  assert.ok(spawned, "T1: spawnAhmad was actually invoked");
  assert.ok(/KOL-100/.test(spawned), "T1: task packet references the issue identifier");
  assert.equal(posted.length, 1, "T1: exactly one marker comment posted");
  assert.ok(/^AHMAD DISPATCH/.test(posted[0].body.body), "T1: marker comment starts with AHMAD DISPATCH");
  ok("T1: dispatches an unmarked DIRECTIVE issue assigned to AHMAD");
}

async function t2_skipsAlreadyDispatched() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  let spawned = false;
  const r = await runAhmadDispatchOnce(withRealLock({
    base: "http://127.0.0.1:9999",
    httpGet: async (url) => {
      if (url.endsWith("/issues")) return { networkError: false, body: [issue()] };
      if (url.includes("/comments")) return { networkError: false, body: [{ body: "AHMAD DISPATCH (ops-watcher/ahmad-dispatch — earlier): waking headless AHMAD for KOL-100." }] };
      throw new Error("unexpected GET " + url);
    },
    httpPost: async () => { throw new Error("must not post — already dispatched"); },
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    spawnAhmad: () => { spawned = true; return { pid: 1 }; },
    log: () => {},
  }));
  assert.equal(spawned, false, "T2: spawnAhmad must NOT be invoked when already dispatched");
  assert.equal(r.results.length, 0, "T2: no result recorded for an already-dispatched issue (pure skip)");
  ok("T2: duplicate-dispatch guard — Paperclip-derived marker comment prevents a second wake");
}

async function t3_skipsOwnerRequired() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  let spawned = false;
  const r = await runAhmadDispatchOnce(withRealLock({
    base: "http://127.0.0.1:9999",
    httpGet: async (url) => {
      if (url.endsWith("/issues")) return { networkError: false, body: [issue({ labels: [{ name: "DIRECTIVE" }, { name: "OWNER_REQUIRED" }] })] };
      throw new Error("unexpected GET " + url);
    },
    httpPost: async () => { throw new Error("must not post — OWNER_REQUIRED blocks all automatic action"); },
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    spawnAhmad: () => { spawned = true; return { pid: 1 }; },
    log: () => {},
  }));
  assert.equal(spawned, false, "T3: OWNER_REQUIRED must block dispatch even on a DIRECTIVE issue assigned to AHMAD");
  ok("T3: OWNER_REQUIRED guard checked first, blocks automatic dispatch");
}

async function t4_skipsNonDirectiveOrUnassigned() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  let spawned = false;
  const r = await runAhmadDispatchOnce(withRealLock({
    base: "http://127.0.0.1:9999",
    httpGet: async (url) => {
      if (url.endsWith("/issues")) {
        return {
          networkError: false,
          body: [
            issue({ id: "a", labels: [] }), // no DIRECTIVE label
            issue({ id: "b", assigneeAgentId: "some-other-agent" }), // not assigned to AHMAD
            issue({ id: "c", status: "done" }), // terminal status
          ],
        };
      }
      throw new Error("unexpected GET " + url);
    },
    httpPost: async () => { throw new Error("must not post"); },
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    spawnAhmad: () => { spawned = true; return { pid: 1 }; },
    log: () => {},
  }));
  assert.equal(spawned, false, "T4: none of these 3 issues qualify for dispatch");
  assert.equal(r.results.length, 0, "T4: no results recorded");
  ok("T4: skips issues missing DIRECTIVE label, not assigned to AHMAD, or terminal status");
}

async function t5_commentsNetworkErrorSkipsWithoutDoubleDispatchRisk() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  let spawned = false;
  const r = await runAhmadDispatchOnce(withRealLock({
    base: "http://127.0.0.1:9999",
    httpGet: async (url) => {
      if (url.endsWith("/issues")) return { networkError: false, body: [issue()] };
      if (url.includes("/comments")) return { networkError: true, networkErrorMessage: "ECONNRESET" };
      throw new Error("unexpected GET " + url);
    },
    httpPost: async () => { throw new Error("must not post — can't confirm no existing marker"); },
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    spawnAhmad: () => { spawned = true; return { pid: 1 }; },
    log: () => {},
  }));
  assert.equal(spawned, false, "T5: a comments-list network error must not risk a duplicate spawn");
  assert.equal(r.results[0].outcome, "skipped-comments-network-error", "T5: outcome reflects the safe skip");
  ok("T5: comments-list network error -> safe skip, never spawns on an unknown marker state");
}

async function t6_perIssueTryCatchDoesNotKillSweep() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  let secondSpawned = false;
  const r = await runAhmadDispatchOnce(withRealLock({
    base: "http://127.0.0.1:9999",
    httpGet: async (url) => {
      if (url.endsWith("/issues")) return { networkError: false, body: [issue({ id: "boom" }), issue({ id: "ok-one", identifier: "KOL-101" })] };
      if (url.includes("/comments")) return { networkError: false, body: [] };
      throw new Error("unexpected GET " + url);
    },
    httpPost: async (url, body) => {
      if (String(body.body).includes("KOL-100")) throw new Error("simulated post crash for the first issue");
      return { networkError: false, status: 201, body: { id: "cmt-2" } };
    },
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    spawnAhmad: (packet) => { if (/KOL-101/.test(packet)) secondSpawned = true; return { pid: 7 }; },
    log: () => {},
  }));
  assert.equal(r.results.length, 2, "T6: both issues produce a result despite the first one throwing");
  assert.equal(r.results[0].outcome, "error", "T6: first issue recorded as error, not a crash");
  assert.equal(r.results[1].outcome, "dispatched", "T6: second issue still processed after the first threw");
  assert.equal(secondSpawned, true, "T6: sweep continued to the second issue's real dispatch");
  ok("T6: a thrown error for one issue does not kill the sweep for the next issue");
}

// ---- T7 (regression for KOL-33): concurrent sweeps must not double-dispatch ----
// Reproduces the TOCTOU race that caused 6 duplicate AHMAD DISPATCH markers on
// KOL-33 within ~150ms: two runAhmadDispatchOnce() calls against the SAME
// injected issue, with a comments GET that deliberately WIDENS the race window
// (small async delay) so that WITHOUT the single-instance lock both calls would
// read "no marker yet" before either POST lands, and both would post a marker +
// spawn. WITH the lock, the second call is refused before any Paperclip
// read/write — only one marker is posted and only one AHMAD spawned.
//
// Determinism note: the reused PID-based acquireLock (from
// telegram-listener-daemon.mjs) is itself a read-then-write, so to make this
// test deterministic we do NOT fire both acquireLocks at the exact same
// instant. Instead we let sweep A acquire the lock and PROVABLY enter its
// sweep (its issues-list GET runs only AFTER acquireLock has resolved and written
// the lock file), and only THEN launch sweep B against the same live state. This
// faithfully reproduces the real concurrency (B runs while A's sweep is in
// flight — A is parked in its comments-GET delay) while guaranteeing B observes
// A's already-held lock. isAlive is injected so A's lock PID is treated as
// alive (a real running holder), exactly as in production.
async function t7_concurrentSweepsDoNotDoubleDispatch() {
  await fs.unlink(TMP_LOCK).catch(() => {});

  // Shared mutable "Paperclip" state, read+written by both sweeps.
  const comments = [];                // live comment list (marker appended on POST)
  let markerPosts = 0;                // count of AHMAD DISPATCH marker POSTs
  let spawnCount = 0;                 // count of spawnAhmad invocations
  let getCommentsCalls = 0;           // how many times comments were GETted
  let getIssuesCalls = 0;             // how many times the issues list was GETted

  // Gate: fires the moment sweep A has provably passed the lock and entered its
  // sweep (its issues-list GET is the first Paperclip read, and it only happens
  // after acquireLock resolved with acquired:true). Awaiting this before
  // launching B guarantees B sees A's already-written lock file.
  let signalAInSweep;
  const aInSweep = new Promise((res) => { signalAInSweep = res; });

  // A small artificial delay on the comments GET widens the race window so
  // sweep A is still parked in its comments read when sweep B launches — i.e.
  // the two sweeps genuinely overlap in time against the same live state.
  const GET_DELAY_MS = 25;

  const WINNER_PID = 424242;
  // Only the winner's PID is "alive"; a stale/unknown PID is dead (so a crashed
  // prior holder would be recovered, matching production staleness semantics).
  const isAlive = (pid) => pid === WINNER_PID;

  // Shared http* / spawnAhmad closures (used by both sweeps).
  const sharedDeps = {
    base: "http://127.0.0.1:9999",
    httpGet: async (url) => {
      if (url.endsWith("/issues")) {
        getIssuesCalls += 1;
        // The FIRST issues-list GET is sweep A entering its sweep — signal B to
        // launch now. A is past the lock; B will see it held.
        if (getIssuesCalls === 1) signalAInSweep();
        return { networkError: false, body: [issue()] };
      }
      if (url.includes("/comments")) {
        getCommentsCalls += 1;
        await new Promise((r) => setTimeout(r, GET_DELAY_MS));
        return { networkError: false, body: comments.slice() };
      }
      throw new Error("unexpected GET " + url);
    },
    httpPost: async (url, body) => {
      // Marker comment POST: record it AND mutate the shared live comment list
      // (the commit point that, without the lock, both concurrent calls reach).
      markerPosts += 1;
      comments.push({ id: `cmt-${markerPosts}`, body: String(body.body) });
      return { networkError: false, status: 201, body: { id: `cmt-${markerPosts}` } };
    },
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    spawnAhmad: () => { spawnCount += 1; return { pid: 9000 + spawnCount }; },
    log: () => {},
  };

  // Launch sweep A (do not await yet) — it acquires the lock and enters its sweep.
  const pA = runAhmadDispatchOnce(withRealLock({
    ...sharedDeps,
    lockPid: WINNER_PID,
    isAlive,
  }));

  // Wait until A has provably acquired the lock and is inside its sweep.
  await aInSweep;

  // NOW launch sweep B against the same live state while A is still parked in
  // its comments-GET delay. B's acquireLock reads A's lock file, sees WINNER_PID
  // alive -> refused. B performs NO Paperclip read/write/spawn.
  const rB = await runAhmadDispatchOnce(withRealLock({
    ...sharedDeps,
    lockPid: WINNER_PID + 1,
    isAlive,
  }));

  // Collect A's result (it finishes the dispatch: marker POST + spawn).
  const rA = await pA;

  // ---- KOL-33 regression assertions ----
  assert.equal(markerPosts, 1, `T7: exactly ONE marker comment posted under concurrency (got ${markerPosts}) — KOL-33 regression`);
  assert.equal(spawnCount, 1, `T7: exactly ONE headless AHMAD spawned under concurrency (got ${spawnCount})`);
  assert.ok(comments.some((c) => /^AHMAD DISPATCH/.test(c.body)), "T7: the single posted marker is an AHMAD DISPATCH marker");

  // Exactly one sweep refused, exactly one performed the real dispatch.
  const refused = [rA, rB].filter((r) => r.refused);
  const dispatched = [rA, rB].filter((r) => r.results && r.results.some((x) => x.outcome === "dispatched"));
  assert.equal(refused.length, 1, "T7: exactly one concurrent sweep is refused (the loser sees the lock held)");
  assert.equal(dispatched.length, 1, "T7: exactly one concurrent sweep performs the real dispatch");
  assert.equal(rB.refused, true, "T7: the second-launched sweep (B) is the one refused");
  assert.equal(rB.results.length, 0, "T7: the refused sweep records no issue results");

  // The refused sweep must NOT have touched Paperclip at all — no issues GET, no
  // comments GET, no POST, no spawn. Only the winner ever reads comments.
  assert.equal(getIssuesCalls, 1, `T7: issues-list GETted exactly once (refused sweep never reads Paperclip) — got ${getIssuesCalls}`);
  assert.equal(getCommentsCalls, 1, `T7: comments GETted exactly once (refused sweep never reads Paperclip) — got ${getCommentsCalls}`);

  // Clean up the temp lock.
  await fs.unlink(TMP_LOCK).catch(() => {});
  ok("T7: KOL-33 regression — two concurrent sweeps cannot both post an AHMAD DISPATCH marker (single-instance lock closes the TOCTOU race)");
}

async function t8_contextBundleWithEvidenceIsInjectedCompactly() {
  const it = issue();
  const calls = [];
  const packet = await buildTaskPacket(it, {
    env: { GBRAIN_HOME: "X:\\brain" },
    now: () => 12345,
    retrieveContext: async (query, deps) => {
      calls.push({ query, deps });
      return {
        status: "ok",
        evidence: [{
          title: "Task Packet Standard",
          canonical_pointer: "gbrain get task-packet-standard",
          excerpt: "THIS RAW EXCERPT MUST NOT BE DUMPED",
        }],
        canonical_pointers: ["ops-watcher/ahmad-dispatch.mjs:buildTaskPacket"],
        stale_warnings: [{ source: "gbrain:agent-registry", warning: "Indexed page is older than config/agent-registry.json." }],
        conflicts: [],
      };
    },
  });

  assert.equal(calls.length, 1, "T8: retrieveContext called exactly once");
  assert.equal(calls[0].query.issue, it, "T8: issue object passed through to retrieval");
  assert.equal(calls[0].query.targetRole, "AHMAD", "T8: targetRole fixed to AHMAD");
  assert.equal(calls[0].query.taskKind, "owner-directive", "T8: taskKind fixed to owner-directive");
  assert.equal(calls[0].query.now, 12345, "T8: now is passed into retrieval");
  assert.equal(calls[0].deps.gbrainHome, "X:\\brain", "T8: GBRAIN_HOME passed as retrieval dependency");
  assert.ok(packet.includes("--- prior context (Cognitive Core retrieval, may be incomplete or stale) ---"), "T8: labeled prior-context section included");
  assert.ok(packet.includes("Task Packet Standard -> gbrain get task-packet-standard"), "T8: evidence title and pointer included");
  assert.ok(packet.includes("ops-watcher/ahmad-dispatch.mjs:buildTaskPacket"), "T8: canonical pointer included");
  assert.ok(packet.includes("Indexed page is older than config/agent-registry.json."), "T8: stale warning included");
  assert.ok(!packet.includes("THIS RAW EXCERPT MUST NOT BE DUMPED"), "T8: raw evidence excerpt is not dumped into the packet");
  ok("T8: ContextBundle evidence is injected as a labeled, compact prior-context section");
}

async function t9_retrieveThrowsColdPacketAndDispatchStillSucceeds() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  const it = issue();
  let spawned = null;
  const r = await runAhmadDispatchOnce(withRealLock({
    base: "http://127.0.0.1:9999",
    httpGet: async (url) => {
      if (url.endsWith("/issues")) return { networkError: false, body: [it] };
      if (url.includes("/comments")) return { networkError: false, body: [] };
      throw new Error("unexpected GET " + url);
    },
    httpPost: async () => ({ networkError: false, status: 201, body: { id: "cmt-throw" } }),
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    retrieveContext: async () => { throw new Error("simulated retrieval failure"); },
    spawnAhmad: (packet) => { spawned = packet; return { pid: 5150 }; },
    log: () => {},
  }));
  assert.equal(r.results[0].outcome, "dispatched", "T9: dispatch still succeeds when retrieval throws");
  assert.equal(r.results[0].pid, 5150, "T9: spawn pid surfaced after retrieval failure");
  assert.equal(spawned, coldPacketFor(it), "T9: thrown retrieval produces the exact pre-change cold packet");
  ok("T9: retrieveContext throw -> byte-for-byte cold packet, dispatch still succeeds");
}

async function t10_emptyContextBundleKeepsColdPacketByteForByte() {
  const it = issue();
  const packet = await buildTaskPacket(it, {
    retrieveContext: async () => ({
      status: "empty",
      evidence: [{ title: "Ignored", canonical_pointer: "ignored" }],
      canonical_pointers: ["ignored"],
      stale_warnings: [],
      conflicts: [],
    }),
  });
  assert.equal(packet, coldPacketFor(it), "T10: empty bundle produces the exact pre-change cold packet");
  assert.ok(!packet.includes("prior context"), "T10: empty bundle leaves no partial prior-context section");
  ok("T10: status empty -> byte-for-byte cold packet");
}

async function t11_conflictedBundleInstructsAhmadToFlagConflict() {
  const packet = await buildTaskPacket(issue(), {
    retrieveContext: async () => ({
      status: "conflicted",
      evidence: [{ title: "Agent Registry", canonical_pointer: "config/agent-registry.json:/p0" }],
      canonical_pointers: [],
      stale_warnings: [],
      conflicts: [{
        topic: "AHMAD dispatch authority",
        older_evidence: "old handoff says disabled",
        current_evidence: "current directive says approved",
      }],
    }),
  });
  assert.ok(packet.includes("If conflicts is non-empty, flag the conflict to the OWNER rather than silently picking a side."), "T11: explicit conflict handling instruction included");
  assert.ok(packet.includes("Conflicts:"), "T11: conflicts subsection included");
  assert.ok(packet.includes("AHMAD dispatch authority"), "T11: conflict topic included");
  assert.ok(packet.includes("old handoff says disabled"), "T11: older evidence included compactly");
  assert.ok(packet.includes("current directive says approved"), "T11: current evidence included compactly");
  ok("T11: conflicted bundle tells headless AHMAD to flag conflicts to OWNER");
}

async function t12_slowRetrieveContextIsBoundedAndSweepStillDispatches() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  let spawned = null;
  const started = Date.now();
  const r = await runAhmadDispatchOnce(withRealLock({
    base: "http://127.0.0.1:9999",
    retrieveContextTimeoutMs: 25,
    httpGet: async (url) => {
      if (url.endsWith("/issues")) return { networkError: false, body: [issue()] };
      if (url.includes("/comments")) return { networkError: false, body: [] };
      throw new Error("unexpected GET " + url);
    },
    httpPost: async () => ({ networkError: false, status: 201, body: { id: "cmt-slow" } }),
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    retrieveContext: async () => new Promise(() => {}),
    spawnAhmad: (packet) => { spawned = packet; return { pid: 6161 }; },
    log: () => {},
  }));
  const elapsedMs = Date.now() - started;
  assert.equal(r.results[0].outcome, "dispatched", "T12: dispatch still succeeds after retrieval timeout");
  assert.equal(r.results[0].pid, 6161, "T12: spawn pid surfaced after retrieval timeout");
  assert.equal(spawned, coldPacketFor(issue()), "T12: timed-out retrieval produces the exact pre-change cold packet");
  assert.ok(elapsedMs < 500, `T12: slow retrieval is bounded by the injected timeout, elapsed ${elapsedMs}ms`);
  ok("T12: slow/timing-out retrieveContext is bounded and does not stall the sweep");
}

// ---- Stuck-recovery path tests (T13–T17) ----

// T13: in_progress + executionLockedAt older than 45 min (no DIRECTIVE, no
// OWNER_REQUIRED) -> dispatched via the stuck-recovery path.
async function t13_stuckInProgressGetsDispatched() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  let spawned = null;
  const posted = [];
  const r = await runAhmadDispatchOnce(withRealLock({
    base: "http://127.0.0.1:9999",
    now: () => NOW,
    httpGet: async (url) => {
      if (url.endsWith("/issues")) return { networkError: false, body: [stuckIssue()] };
      if (url.includes("/comments")) return { networkError: false, body: [] };
      throw new Error("unexpected GET " + url);
    },
    httpPost: async (url, body) => { posted.push({ url, body }); return { networkError: false, status: 201, body: { id: "cmt-stuck" } }; },
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    spawnAhmad: (packet) => { spawned = packet; return { pid: 7777 }; },
    log: () => {},
  }));
  assert.equal(r.results.length, 1, "T13: one issue processed");
  assert.equal(r.results[0].outcome, "stuck-recovery-dispatched", "T13: outcome=stuck-recovery-dispatched");
  assert.equal(r.results[0].pid, 7777, "T13: spawn pid surfaced");
  assert.ok(spawned, "T13: spawnAhmad was actually invoked");
  assert.ok(/KOL-200/.test(spawned), "T13: task packet references the issue identifier");
  assert.ok(/STUCK/.test(spawned), "T13: task packet mentions STUCK");
  assert.ok(/ahmad-escalate\.mjs/.test(spawned), "T13: task packet mentions ahmad-escalate.mjs");
  assert.equal(posted.length, 1, "T13: exactly one marker comment posted");
  assert.ok(/^AHMAD STUCK-RECOVERY DISPATCH/.test(posted[0].body.body), "T13: marker comment starts with AHMAD STUCK-RECOVERY DISPATCH");
  ok("T13: stuck in_progress issue (stale executionLockedAt) -> dispatched via stuck-recovery path");
}

// T14: same but executionLockedAt only 5 minutes old -> NOT dispatched (not stale enough).
async function t14_notStaleEnoughNotDispatched() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  let spawned = false;
  const posted = [];
  const r = await runAhmadDispatchOnce(withRealLock({
    base: "http://127.0.0.1:9999",
    now: () => NOW,
    httpGet: async (url) => {
      if (url.endsWith("/issues")) return { networkError: false, body: [stuckIssue({ _lockedAgoMin: 5 })] };
      if (url.includes("/comments")) return { networkError: false, body: [] };
      throw new Error("unexpected GET " + url);
    },
    httpPost: async (url, body) => { posted.push({ url, body }); return { networkError: false, status: 201, body: { id: "x" } }; },
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    spawnAhmad: () => { spawned = true; return { pid: 1 }; },
    log: () => {},
  }));
  assert.equal(spawned, false, "T14: spawnAhmad must NOT be invoked (only 5 min stale, threshold is 45)");
  assert.equal(posted.length, 0, "T14: no marker comment posted");
  assert.equal(r.results.length, 0, "T14: no results recorded");
  ok("T14: in_progress with executionLockedAt only 5 min old -> NOT dispatched (not stale enough)");
}

// T15: same but issue already has OWNER_REQUIRED -> NOT dispatched (already escalated).
async function t15_ownerRequiredBlocksStuckRecovery() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  let spawned = false;
  const r = await runAhmadDispatchOnce(withRealLock({
    base: "http://127.0.0.1:9999",
    now: () => NOW,
    httpGet: async (url) => {
      if (url.endsWith("/issues")) return { networkError: false, body: [stuckIssue({ labels: [{ name: "OWNER_REQUIRED" }] })] };
      throw new Error("unexpected GET " + url);
    },
    httpPost: async () => { throw new Error("must not post — OWNER_REQUIRED blocks all automatic action"); },
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    spawnAhmad: () => { spawned = true; return { pid: 1 }; },
    log: () => {},
  }));
  assert.equal(spawned, false, "T15: OWNER_REQUIRED must block stuck-recovery dispatch too");
  assert.equal(r.results.length, 0, "T15: no results recorded");
  ok("T15: in_progress + stale but OWNER_REQUIRED -> NOT dispatched (already escalated, must not be touched again)");
}

// T16: same but a STUCK_RECOVERY_MARKER comment already exists -> NOT dispatched again (idempotency).
async function t16_stuckRecoveryMarkerAlreadyPresentSkips() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  let spawned = false;
  const r = await runAhmadDispatchOnce(withRealLock({
    base: "http://127.0.0.1:9999",
    now: () => NOW,
    httpGet: async (url) => {
      if (url.endsWith("/issues")) return { networkError: false, body: [stuckIssue()] };
      if (url.includes("/comments")) return { networkError: false, body: [{ body: "AHMAD STUCK-RECOVERY DISPATCH (ops-watcher/ahmad-dispatch — earlier): waking headless AHMAD for stuck recovery on KOL-200." }] };
      throw new Error("unexpected GET " + url);
    },
    httpPost: async () => { throw new Error("must not post — already dispatched for stuck recovery"); },
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    spawnAhmad: () => { spawned = true; return { pid: 1 }; },
    log: () => {},
  }));
  assert.equal(spawned, false, "T16: spawnAhmad must NOT be invoked when STUCK-RECOVERY marker already present");
  assert.equal(r.results.length, 0, "T16: no results recorded (pure skip)");
  ok("T16: existing STUCK_RECOVERY_MARKER comment -> NOT dispatched again (idempotency)");
}

// T17: status is "in_progress" but executionLockedAt is missing/null -> NOT dispatched.
async function t17_missingExecutionLockedAtNotDispatched() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  let spawned = false;
  const r = await runAhmadDispatchOnce(withRealLock({
    base: "http://127.0.0.1:9999",
    now: () => NOW,
    httpGet: async (url) => {
      if (url.endsWith("/issues")) return { networkError: false, body: [stuckIssue({ executionLockedAt: null })] };
      if (url.includes("/comments")) return { networkError: false, body: [] };
      throw new Error("unexpected GET " + url);
    },
    httpPost: async () => { throw new Error("must not post — no executionLockedAt means we can't tell if stale"); },
    httpPatch: async () => ({ networkError: false, status: 200, body: {} }),
    spawnAhmad: () => { spawned = true; return { pid: 1 }; },
    log: () => {},
  }));
  assert.equal(spawned, false, "T17: spawnAhmad must NOT be invoked when executionLockedAt is null");
  assert.equal(r.results.length, 0, "T17: no results recorded");
  ok("T17: in_progress but executionLockedAt missing/null -> NOT dispatched (can't tell if actually stale)");
}

async function main() {
  const tests = [
    t1_dispatchesUnmarkedAssignedDirective, t2_skipsAlreadyDispatched,
    t3_skipsOwnerRequired, t4_skipsNonDirectiveOrUnassigned,
    t5_commentsNetworkErrorSkipsWithoutDoubleDispatchRisk,
    t6_perIssueTryCatchDoesNotKillSweep,
    t7_concurrentSweepsDoNotDoubleDispatch,
    t8_contextBundleWithEvidenceIsInjectedCompactly,
    t9_retrieveThrowsColdPacketAndDispatchStillSucceeds,
    t10_emptyContextBundleKeepsColdPacketByteForByte,
    t11_conflictedBundleInstructsAhmadToFlagConflict,
    t12_slowRetrieveContextIsBoundedAndSweepStillDispatches,
    t13_stuckInProgressGetsDispatched,
    t14_notStaleEnoughNotDispatched,
    t15_ownerRequiredBlocksStuckRecovery,
    t16_stuckRecoveryMarkerAlreadyPresentSkips,
    t17_missingExecutionLockedAtNotDispatched,
  ];
  for (const t of tests) await t();
  await fs.unlink(TMP_LOCK).catch(() => {});
  console.log(`\nahmad-dispatch.regression.test.mjs: ${pass}/${tests.length} passed`);
  if (pass !== tests.length) process.exitCode = 1;
}

main();