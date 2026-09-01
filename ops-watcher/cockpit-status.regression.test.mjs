// ops-watcher/cockpit-status.regression.test.mjs
// PHASE 6 (COCKPIT) regression tests. Offline: node:assert/strict + a local
// node:http mock Paperclip (same pattern as hardening.regression.test.mjs).
// No live Paperclip, no live Ollama/hermes/kimi probes, no real LLM. The Paperclip
// issues/comments endpoints are served by a local mock; the routing lane probes
// and cooldown checks are injected fakes. events.jsonl is pointed at temp files.
//
//   node ops-watcher/cockpit-status.regression.test.mjs
//
// Covers:
//   (Q1) correct issue-status tallying (by status + OWNER_REQUIRED/NEEDS_REWORK).
//   (Q2) correct lane-health passthrough (probe result + cooldown passthrough,
//        reusing routing.mjs's contract, not re-probed by hand).
//   (Q3) correct VERDICT-comment scanning re-using the detectReviewWaiting-style
//        logic: REVIEW_REQUIRED w/ no verdict -> awaiting; REVIEW_REQUIRED w/
//        agent VERDICT -> unconsumed; done w/ agent VERDICT -> doneViaVerdict.
//   (Q4) the honest "not available" quota message is NEVER replaced by fabricated
//        numbers, in the status object, the text view, and the HTML view.
//   (Q5) no crash on a Paperclip/network error (dead port -> reachable=false,
//        buildCockpitStatus returns cleanly; text/html still render).

import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { buildCockpitStatus, formatText, formatHtml } from "./cockpit-status.mjs";
import { listIssues } from "./paperclip-write-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANY_ID = "a7011f31-8891-4581-b8fb-bbda8ac6a890";

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name); failed++;
}

function sendJson(res, code, obj) { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); }

function startMock(state) {
  const server = http.createServer((req, res) => {
    const u = req.url || "";
    const m = req.method;
    try {
      if (u === `/api/companies/${COMPANY_ID}/issues` && m === "GET")
        return sendJson(res, 200, state.issues);
      const cm = u.match(/^\/api\/issues\/([^/]+)\/comments$/);
      if (cm && m === "GET") return sendJson(res, 200, state.commentsByIssue[cm[1]] || []);
      res.statusCode = 404; res.end();
    } catch (err) {
      res.statusCode = 500; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: String(err && err.message) }));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      port: server.address().port,
      base: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => server.close(() => r())),
    }));
  });
}

function makeIssue(opts) {
  return Object.assign({
    id: randomUUID(), companyId: COMPANY_ID, identifier: "KOL-" + Math.random().toString(36).slice(2, 6),
    title: "t", description: "", status: "todo", labels: [], labelIds: [], assigneeAgentId: null,
  }, opts);
}
function lbl(name) { return { name }; }

// Fake lane probes/cooldown injected into buildCockpitStatus. `probes` maps
// lane -> probe result object; `cooldowns` maps lane -> cooldown result object.
function fakeLaneDeps(probes, cooldowns) {
  return {
    probeLaneAvailability: async (lane) => probes[lane] || { lane, available: false, probe: "none", signal: "no-fake", reason: "no fake configured" },
    isInCooldown: async (lane) => cooldowns[lane] || { inCooldown: false, lane, remainingMs: 0, failureCount: 0 },
  };
}

async function tmpEventsFile(lines) {
  const f = path.join(__dirname, `_cockpit_test_${randomUUID()}.jsonl`);
  if (lines && lines.length) await fs.writeFile(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return f;
}

// =====================================================================
// Q1: issue-status tallying
// =====================================================================
async function testIssueStatusTally() {
  const name = "Q1 issue-status tallying + OWNER_REQUIRED/NEEDS_REWORK counts";
  const state = {
    issues: [
      makeIssue({ status: "todo", labels: [lbl("OWNER_REQUIRED")] }),
      makeIssue({ status: "todo" }),
      makeIssue({ status: "in_progress" }),
      makeIssue({ status: "in_review", labels: [lbl("REVIEW_REQUIRED")] }),
      makeIssue({ status: "backlog" }),
      makeIssue({ status: "blocked" }),
      makeIssue({ status: "done" }),
      makeIssue({ status: "done" }),
      makeIssue({ status: "cancelled", labels: [lbl("NEEDS_REWORK")] }),
      makeIssue({ status: "weird-status" }), // -> other
    ],
    commentsByIssue: {},
  };
  const srv = await startMock(state);
  const evFile = await tmpEventsFile(null);
  try {
    const s = await buildCockpitStatus({
      base: srv.base, companyId: COMPANY_ID, listIssues,
      now: 1_700_000_000_000, eventsFile: evFile,
      ...fakeLaneDeps({}, {}),
    });
    assert.equal(s.paperclip.reachable, true, "paperclip reachable");
    assert.equal(s.paperclip.issueCount, 10);
    assert.equal(s.queue.total, 10);
    assert.equal(s.queue.byStatus.todo, 2);
    assert.equal(s.queue.byStatus.in_progress, 1);
    assert.equal(s.queue.byStatus.in_review, 1);
    assert.equal(s.queue.byStatus.backlog, 1);
    assert.equal(s.queue.byStatus.blocked, 1);
    assert.equal(s.queue.byStatus.done, 2);
    assert.equal(s.queue.byStatus.cancelled, 1);
    assert.equal(s.queue.byStatus.other, 1, "unknown status rolls into other");
    assert.equal(s.queue.ownerRequired, 1);
    assert.equal(s.queue.needsRework, 1);
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); try { await fs.unlink(evFile); } catch { /* */ } }
}

// =====================================================================
// Q2: lane-health passthrough (reuses routing.mjs contract, not re-probed)
// =====================================================================
async function testLaneHealthPassthrough() {
  const name = "Q2 lane-health passthrough (probe + cooldown from routing.mjs contract)";
  const probes = {
    ollama: { lane: "ollama", available: true, probe: "http", signal: "ollama /api/tags reachable", models: ["a", "b"], reason: "ok" },
    nous: { lane: "nous", available: false, probe: "spawn", signal: "exit_127", reason: "binary not responsive" },
    kimi: { lane: "kimi", available: true, probe: "spawn", signal: "binary-responsive", version: "kimi 1.2", reason: "ok" },
  };
  const cooldowns = {
    ollama: { inCooldown: false, lane: "ollama", remainingMs: 0, failureCount: 0 },
    nous: { inCooldown: true, lane: "nous", remainingMs: 42_000, failureCount: 2, expiresAt: 123, lastFailureReason: "429" },
    kimi: { inCooldown: false, lane: "kimi", remainingMs: 0, failureCount: 0 },
  };
  const evFile = await tmpEventsFile(null);
  try {
    const s = await buildCockpitStatus({
      base: null, companyId: COMPANY_ID, // base null is fine; lanes are independent
      now: 1_700_000_000_000, eventsFile: evFile,
      ...fakeLaneDeps(probes, cooldowns),
    });
    assert.equal(s.lanes.ollama.available, true);
    assert.equal(s.lanes.ollama.probe, "http");
    assert.deepEqual(s.lanes.ollama.models, ["a", "b"]);
    assert.equal(s.lanes.ollama.inCooldown, false);
    assert.equal(s.lanes.nous.available, false);
    assert.equal(s.lanes.nous.signal, "exit_127");
    assert.equal(s.lanes.nous.inCooldown, true);
    assert.equal(s.lanes.nous.cooldownRemainingMs, 42_000);
    assert.equal(s.lanes.nous.failureCount, 2);
    assert.equal(s.lanes.nous.lastFailureReason, "429");
    assert.equal(s.lanes.kimi.available, true);
    assert.equal(s.lanes.kimi.version, "kimi 1.2");
    // text view surfaces lane state
    const txt = formatText(s);
    assert.match(txt, /ollama:\s+UP/, "text shows ollama UP");
    assert.match(txt, /nous:\s+DOWN/, "text shows nous DOWN");
    assert.match(txt, /cooldown: YES/, "text shows cooldown YES for nous");
    ok(name);
  } catch (err) { bad(name, err); } finally { try { await fs.unlink(evFile); } catch { /* */ } }
}

// =====================================================================
// Q3: VERDICT-comment scanning (reused detectReviewWaiting-style logic)
// =====================================================================
async function testVerdictScanning() {
  const name = "Q3 VERDICT-comment scanning (awaiting / unconsumed / doneViaVerdict)";
  const rrNoVerdict = makeIssue({ status: "in_review", labels: [lbl("REVIEW_REQUIRED")] });
  const rrWithVerdict = makeIssue({ status: "in_review", labels: [lbl("REVIEW_REQUIRED")] });
  const doneWithVerdict = makeIssue({ status: "done" });
  const doneNoVerdict = makeIssue({ status: "done" });
  const doneUserVerdictOnly = makeIssue({ status: "done" }); // VERDICT but NOT agent-authored -> not counted
  const todoIrrelevant = makeIssue({ status: "todo" });
  const state = {
    issues: [rrNoVerdict, rrWithVerdict, doneWithVerdict, doneNoVerdict, doneUserVerdictOnly, todoIrrelevant],
    commentsByIssue: {},
  };
  state.commentsByIssue[rrWithVerdict.id] = [
    { id: "c1", body: "looks good\nVERDICT: PASS", authorAgentId: "ce433688-4e0d-4902-addd-b7d27eb081b7" },
  ];
  state.commentsByIssue[doneWithVerdict.id] = [
    { id: "c2", body: "VERDICT: PASS WITH NOTES", authorAgentId: "ce433688-4e0d-4902-addd-b7d27eb081b7" },
  ];
  state.commentsByIssue[doneUserVerdictOnly.id] = [
    // snake_case variant: a VERDICT marker authored by an agent (camelCase) — must count
    { id: "c3", body: "VERDICT: PASS", author_agent_id: "agent-x" },
  ];
  state.commentsByIssue[doneNoVerdict.id] = [
    { id: "c4", body: "some user comment, no verdict marker", authorAgentId: null },
  ];
  const srv = await startMock(state);
  const evFile = await tmpEventsFile(null);
  try {
    const s = await buildCockpitStatus({
      base: srv.base, companyId: COMPANY_ID, listIssues,
      now: 1_700_000_000_000, eventsFile: evFile,
      ...fakeLaneDeps({}, {}),
    });
    // REVIEW_REQUIRED totals
    assert.equal(s.review.reviewRequiredTotal, 2, "two REVIEW_REQUIRED issues");
    assert.equal(s.review.awaitingVerdict, 1, "one REVIEW_REQUIRED with no verdict -> awaiting");
    assert.equal(s.review.hasUnconsumedVerdict, 1, "one REVIEW_REQUIRED with agent verdict -> unconsumed");
    // done via verdict
    assert.equal(s.review.doneTotal, 3, "three done issues");
    assert.equal(s.review.doneViaVerdict, 2, "two done issues reached via an agent VERDICT (camelCase + snake_case)");
    // scanned covers REVIEW_REQUIRED + done (deduped by id)
    assert.equal(s.review.scannedIssues, 5, "scanned 2 review + 3 done = 5");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); try { await fs.unlink(evFile); } catch { /* */ } }
}

// =====================================================================
// Q4: quota honesty — never fabricated
// =====================================================================
async function testQuotaHonesty() {
  const name = "Q4 quota honesty: 'not available' never replaced by fabricated numbers";
  const state = { issues: [], commentsByIssue: {} };
  const srv = await startMock(state);
  const evFile = await tmpEventsFile(null);
  try {
    const s = await buildCockpitStatus({
      base: srv.base, companyId: COMPANY_ID, listIssues,
      now: 1_700_000_000_000, eventsFile: evFile,
      ...fakeLaneDeps({}, {}),
    });
    assert.equal(s.quota.available, false, "quota.available must be false");
    assert.match(s.quota.note, /not available/i, "quota note says not available");
    assert.match(s.quota.note, /no metering data source/i, "quota note explains why");
    // No fabricated numeric fields on quota.
    assert.ok(!("usedToday" in s.quota), "no usedToday field fabricated");
    assert.ok(!("dailyLimit" in s.quota), "no dailyLimit field fabricated");
    assert.ok(!("remainingToday" in s.quota), "no remainingToday field fabricated");
    // text view stays honest
    const txt = formatText(s);
    assert.match(txt, /Quota \/ cost:/);
    assert.match(txt, /not available in this workspace \(no metering data source exists yet\)/);
    assert.doesNotMatch(txt, /usedToday|dailyLimit|remainingToday/i, "text must not invent quota numbers");
    // html view stays honest
    const html = formatHtml(s);
    assert.match(html, /not available in this workspace \(no metering data source exists yet\)/);
    assert.doesNotMatch(html, /usedToday|dailyLimit|remainingToday/i, "html must not invent quota numbers");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); try { await fs.unlink(evFile); } catch { /* */ } }
}

// =====================================================================
// Q5a: no crash on Paperclip network error (real listIssues vs dead port)
// =====================================================================
async function testNoCrashDeadPort() {
  const name = "Q5a no crash on Paperclip network error (dead port -> reachable=false, clean return)";
  const evFile = await tmpEventsFile(null);
  // Pick a port that is almost certainly closed. Bind+immediately close to get a free port.
  const grabber = http.createServer();
  const freePort = await new Promise((r) => grabber.listen(0, "127.0.0.1", () => r(grabber.address().port)));
  await new Promise((r) => grabber.close(() => r()));
  const deadBase = `http://127.0.0.1:${freePort}`;
  try {
    const s = await buildCockpitStatus({
      base: deadBase, companyId: COMPANY_ID, listIssues,
      now: 1_700_000_000_000, eventsFile: evFile,
      ...fakeLaneDeps({}, {}),
    });
    assert.equal(s.paperclip.reachable, false, "must report unreachable, not throw");
    assert.ok(s.paperclip.error, "paperclip.error populated");
    assert.ok(s.queue.error, "queue.error populated");
    assert.ok(s.review.error, "review.error populated");
    // lanes + observability + quota still populated (independent of Paperclip)
    assert.ok(s.lanes.ollama, "lanes still reported");
    assert.equal(s.quota.available, false, "quota still honest");
    // formatters still render without throwing
    const txt = formatText(s);
    const html = formatHtml(s);
    assert.match(txt, /Paperclip: UNREACHABLE/);
    assert.match(html, /Reachable:/);
    ok(name);
  } catch (err) { bad(name, err); } finally { try { await fs.unlink(evFile); } catch { /* */ } }
}

// =====================================================================
// Q5b: no crash when no base resolved at all (instance not discovered)
// =====================================================================
async function testNoCrashNoBase() {
  const name = "Q5b no crash when Paperclip base is null (instance not discovered)";
  const evFile = await tmpEventsFile(null);
  try {
    const s = await buildCockpitStatus({
      base: null, companyId: COMPANY_ID, listIssues,
      now: 1_700_000_000_000, eventsFile: evFile,
      ...fakeLaneDeps({}, {}),
    });
    assert.equal(s.paperclip.reachable, false);
    assert.equal(s.paperclip.base, null);
    assert.match(s.paperclip.error, /no Paperclip base/);
    assert.equal(s.quota.available, false);
    const txt = formatText(s);
    assert.match(txt, /Paperclip: UNREACHABLE/);
    ok(name);
  } catch (err) { bad(name, err); } finally { try { await fs.unlink(evFile); } catch { /* */ } }
}

// =====================================================================
// Q6 (bonus): observability 24h window + most-recent error event
// =====================================================================
async function testObservabilityWindow() {
  const name = "Q6 observability: 24h window count + most-recent error-shaped event";
  const now = 1_700_000_000_000;
  const lines = [
    { ts: now - 1000, detector: "worker-lane-unavailable", target_role: "AHMAD", payload: { lane: "technical" } },
    { ts: now - 2000, detector: "paperclip-unreachable", target_role: "AHMAD", payload: {} },
    { ts: now - 30 * 60 * 60 * 1000, detector: "stuck-running", target_role: "AHMAD", payload: { issueId: "old" } }, // 30h old -> excluded
    { ts: now - 60_000, detector: "watcher-heartbeat", target_role: "OPS-WATCHER", payload: {} }, // not error-shaped
    { ts: now - 3000, detector: "review-waiting", target_role: "GIBRAN", payload: {} }, // routing signal, not error-shaped
  ];
  const evFile = await tmpEventsFile(lines);
  try {
    const s = await buildCockpitStatus({
      base: null, companyId: COMPANY_ID, listIssues,
      now, eventsFile: evFile,
      ...fakeLaneDeps({}, {}),
    });
    assert.equal(s.observability.exists, true);
    assert.equal(s.observability.totalLines, 5);
    assert.equal(s.observability.errorEventCount24h, 2, "only the two recent error-shaped events count");
    assert.ok(s.observability.lastErrorEvent, "most-recent populated");
    assert.equal(s.observability.lastErrorEvent.detector, "worker-lane-unavailable", "most-recent is the newest by ts");
    assert.equal(s.observability.lastErrorEvent.target_role, "AHMAD");
    ok(name);
  } catch (err) { bad(name, err); } finally { try { await fs.unlink(evFile); } catch { /* */ } }
}

async function main() {
  console.log("# ops-watcher PHASE-6 cockpit regression tests");
  await testIssueStatusTally();
  await testLaneHealthPassthrough();
  await testVerdictScanning();
  await testQuotaHonesty();
  await testNoCrashDeadPort();
  await testNoCrashNoBase();
  await testObservabilityWindow();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}
main().catch((err) => { console.error("cockpit regression runner crashed:", err); process.exit(1); });