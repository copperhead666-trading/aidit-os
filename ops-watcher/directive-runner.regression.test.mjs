// Offline regression tests for ops-watcher/directive-runner.mjs.
// No node:test, no dependencies, no real Paperclip writes, no lane execution,
// no real Telegram send. Every outbound call is injected and stubbed.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  commandLineTooLong,
  classifyDirective,
  isPlannable,
  findPlanDecision,
  buildDecisionCardText,
  buildPlanPrompt,
  parsePlan,
  validatePlanScope,
  activeVenturePathsFor,
  routeFilesToGraphs,
  validateVerifyCommand,
  runDirectiveSweepOnce,
  capturePlanForExecution,
  nodeCommandToArgv,
  commentsOldestFirst,
  readStateOutcome,
  UNEXECUTABLE_MARKER,
  buildExecutionPrompt,
  graphFreshnessForAnchors,
  graphNodeLocation,
  graphAnchorStartLine,
  graphAnchorRange,
  scoreAnchorRelevance,
  executeApprovedDirective,
  PLAN_MARKER,
  APPROVED_MARKER,
  REJECTED_MARKER,
  RESULT_MARKER,
  DISPATCH_MARKER,
  EXECUTION_CAP_MARKER,
  DEFAULT_STALLED_AFTER_MS,
  DEFAULT_MAX_PLAN_ATTEMPTS,
  MAX_EXECUTIONS_PER_SWEEP,
  MAX_EXECUTION_ATTEMPTS,
  SWEEP_MIN_INTERVAL_MS,
  planIdentityKey,
  recordExecutionFailure,
  clearExecutionFailures,
  executionCapReached,
  activeGraphAnchorsForFiles,
  graphFreshnessWithContent,
  setGraphContentVerifier,
  clearGraphContentCache,
} from "./directive-runner.mjs";
import { verifyFile } from "./verify-file.mjs";
import { isIdentifierShapedLabel } from "./graphify-refresh.mjs";
import { acquireLock, releaseLock } from "./telegram-listener-daemon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_STATE = path.join(__dirname, "directive-runner.regression.state.tmp");
const NOW = Date.parse("2026-09-01T10:00:00.000Z");
// === TEST ISOLATION (lock file) ===
// Every sweep test injects lockFile: TMP_LOCK — a temp path DISTINCT from the
// real production ops-watcher/directive-runner.lock. Without this, an offline
// test would refuse whenever the live heartbeat happened to be holding the real
// lock mid-sweep, and a killed test would leave a lock on the production path.
const TMP_LOCK = path.join(__dirname, "directive-runner.regression.lock.tmp");
const LOCK_DEPS = { lockFile: TMP_LOCK, acquireLock, releaseLock };
const clearTempLock = () => fs.unlink(TMP_LOCK).catch(() => {});

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => { console.log(`FAIL: ${n}`); if (e) console.log(`       ${e && e.stack ? e.stack : e}`); failures.push(n); failed++; };

function issue(over = {}) {
  return { id: "iss-1", identifier: "KOL-1", title: "Directive", description: "Do work", status: "todo", labels: [{ name: "DIRECTIVE" }], ...over };
}
function c(body, at = "2026-09-01T09:00:00.000Z") {
  return { id: Math.random().toString(16).slice(2), body, createdAt: at, authorType: "user" };
}
const goodPlan = [
  "OBJECTIVE: Menyiapkan perubahan kecil yang diminta owner.",
  "FILES: ops-watcher/foo.mjs, docs/bar.md",
  "STEPS:",
  "- Baca konteks dan batasi perubahan ke file yang disebut.",
  "- Terapkan perubahan lalu verifikasi secara lokal.",
  "VERIFY: node ops-watcher/foo.mjs --check",
  "OUT OF SCOPE: Tidak menjalankan network, Telegram, pm2, git, atau package install.",
  "RISK: low",
].join("\n");
// The prompt tells the lane where the repository physically is. That value is
// DERIVED in directive-runner.mjs (path.resolve(__dirname, "..")), so the golden
// derives it the same way instead of hardcoding one machine's path. Computed
// independently here — this test file sits in the same directory as the module
// under test, so an identical derivation is a real check that the module resolved
// the root correctly, not a tautology that copies the module's own answer.
const TEST_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_ACTIVE_GRAPH_FILE = path.join(TEST_REPO_ROOT, "graphify-out", "active", "graph.json");
const REPO_ROOT_FOR_TEST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TEST_HEAD_COMMIT = (() => {
  try {
    return String(execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT_FOR_TEST, encoding: "utf8", windowsHide: true })).trim();
  } catch {
    return "";
  }
})();

// Writes a real graph beside a stamp naming a DIFFERENT commit — the stale case.
//
// RESTORES whatever was there before. An earlier version of this helper deleted
// unconditionally and DESTROYED the machine's real 8,906-node graph, which then
// had to be rebuilt (48s). A test fixture that can delete production state is a
// worse bug than the one it is testing for.
async function withStaleActiveGraph(graph, fn) {
  const stampFile = `${TEST_ACTIVE_GRAPH_FILE}.commit.stamp`;
  let prevGraph = null;
  let prevStamp = null;
  try { prevGraph = await fs.readFile(TEST_ACTIVE_GRAPH_FILE, "utf8"); } catch { prevGraph = null; }
  try { prevStamp = await fs.readFile(stampFile, "utf8"); } catch { prevStamp = null; }

  // W8: these fixtures describe files that do not exist, so the content check
  // is stubbed for the fixture lifetime. The W8 tests install their own.
  const restoreVerifier = setGraphContentVerifier(FIXTURE_CONTENT_VERDICT);
  await fs.mkdir(path.dirname(TEST_ACTIVE_GRAPH_FILE), { recursive: true });
  await fs.writeFile(TEST_ACTIVE_GRAPH_FILE, JSON.stringify(graph), "utf8");
  await fs.writeFile(stampFile, "0000000000000000000000000000000000000000", "utf8");
  try {
    return await fn();
  } finally {
    restoreVerifier();
    if (prevGraph !== null) await fs.writeFile(TEST_ACTIVE_GRAPH_FILE, prevGraph, "utf8");
    else await fs.unlink(TEST_ACTIVE_GRAPH_FILE).catch(() => {});
    if (prevStamp !== null) await fs.writeFile(stampFile, prevStamp, "utf8");
    else await fs.unlink(stampFile).catch(() => {});
    // Only try to remove the directories when we created them, i.e. nothing was
    // there before. rmdir on a non-empty directory fails harmlessly anyway.
    if (prevGraph === null && prevStamp === null) {
      await fs.rmdir(path.dirname(TEST_ACTIVE_GRAPH_FILE)).catch(() => {});
      await fs.rmdir(path.dirname(path.dirname(TEST_ACTIVE_GRAPH_FILE))).catch(() => {});
    }
  }
}

// RESTORES the stamp as well as the graph.
//
// It used to restore only the graph. The stamp it wrote — the CURRENT HEAD —
// was left behind on the machine's real graph, so after any run of this suite
// the live graph carried a stamp naming a commit it was not built at, and the
// stale-graph guard, which compares stamp against HEAD, certified it as FRESH.
// Measured at f22349d with a clean tree and the guard reporting FRESH:
// buildExecutionPrompt() was at L1716 in the graph and L1858 in the file.
//
// This is the same lesson as withStaleActiveGraph above, which was fixed after
// it destroyed the real graph: a fixture that writes production state and does
// not put it back is a worse bug than the one it is testing for. The neighbour
// got the lesson; this one did not.
const FIXTURE_CONTENT_VERDICT = () => ({ verified: true, checked: 1, skipped: 0, mismatches: [], reason: "fixture tree" });

async function withActiveGraph(graph, fn, { stubContent = true } = {}) {
  const restoreVerifier = stubContent ? setGraphContentVerifier(FIXTURE_CONTENT_VERDICT) : () => {};
  const stampFile = `${TEST_ACTIVE_GRAPH_FILE}.commit.stamp`;
  let previous = null;
  let hadPrevious = true;
  let previousStamp = null;
  try {
    previous = await fs.readFile(TEST_ACTIVE_GRAPH_FILE, "utf8");
  } catch {
    hadPrevious = false;
  }
  try {
    previousStamp = await fs.readFile(stampFile, "utf8");
  } catch {
    previousStamp = null;
  }

  await fs.mkdir(path.dirname(TEST_ACTIVE_GRAPH_FILE), { recursive: true });
  await fs.writeFile(TEST_ACTIVE_GRAPH_FILE, JSON.stringify(graph), "utf8");
  // The graph is only trusted when a stamp beside it names the commit it was
  // built at. Writing the graph without one is exactly the "unstamped graph"
  // case, which is refused on purpose — so a fixture that wants anchors must
  // supply the stamp too.
  await fs.writeFile(stampFile, TEST_HEAD_COMMIT, "utf8");
  try {
    return await fn();
  } finally {
    restoreVerifier();
    if (previousStamp !== null) await fs.writeFile(stampFile, previousStamp, "utf8");
    else await fs.unlink(stampFile).catch(() => {});
    if (hadPrevious) {
      await fs.writeFile(TEST_ACTIVE_GRAPH_FILE, previous, "utf8");
    } else {
      await fs.unlink(TEST_ACTIVE_GRAPH_FILE).catch(() => {});
      // The stamp is NOT unlinked here: it was already restored or removed
      // above. Deleting it again would destroy a real stamp in the case where
      // the graph was absent but the stamp was not.
      await fs.rmdir(path.dirname(TEST_ACTIVE_GRAPH_FILE)).catch(() => {});
      await fs.rmdir(path.dirname(path.dirname(TEST_ACTIVE_GRAPH_FILE))).catch(() => {});
    }
  }
}

const EXPECTED_PLAN_PROMPT_NO_SPECIALIST = String.raw`You are the planning lane for FounderOS-Aidit directive-runner stage 1.
Produce a short approval plan only. Do not execute anything.
Your response MUST be exactly this shape and nothing else:
OBJECTIVE: <one sentence>
FILES: <comma-separated repo-relative paths this plan will touch, or NONE>
STEPS:
- <step>
- <step>
VERIFY: <the single command that proves it worked>
OUT OF SCOPE: <what this deliberately will not do>
RISK: low | medium | high

Hard boundary: repo-relative paths only; nothing under ventures/, .git/, .paperclip/; no .env* files; no network; no message to anyone but the owner; no package installs.
VERIFY contract: the VERIFY line MUST be a single command starting with node ops-watcher/.
The VERIFY line must not contain ; & or | - not even inside a quoted argument. Two commands joined by && will be rejected before the owner ever sees the plan.
This applies to the --matches regex too: write a regex without | alternation, or pick a different single command.
Allowed VERIFY for code changes: node ops-watcher/run-all-tests.mjs --only <suite-file>
Allowed VERIFY for file-content directives: node ops-watcher/verify-file.mjs --path <file> --matches <regex>
PowerShell, cmd, bash, git, or any other command will be rejected before the owner sees the plan.
Line contract: VERIFY occupies exactly ONE line, OUT OF SCOPE is the very next line, and RISK the one after that. A VERIFY spread over several lines - a here-string, a backslash continuation, a wrapped command - makes the parser read the continuation where OUT OF SCOPE should be, and the plan is rejected as missing OUT OF SCOPE.
Nothing may follow the RISK line.
Scope is only this repository: ${TEST_REPO_ROOT}.
Write OBJECTIVE, STEPS, VERIFY, and OUT OF SCOPE in professional Bahasa Indonesia. Keep file paths and commands verbatim.

Issue: KOL-1
Title: Directive
Description:
Do work

Context bundle:
{
  "status": "ok"
}`;

const EXPECTED_EXECUTION_PROMPT_NO_SPECIALIST = String.raw`ISSUE: KOL-1
TITLE: Directive

OBJECTIVE: Menyiapkan perubahan kecil yang diminta owner.

THE EXACT FILES YOU MAY CHANGE (nothing else, listed one per line):
- ops-watcher/foo.mjs
- docs/bar.md

STEPS:
- Baca konteks dan batasi perubahan ke file yang disebut.
- Terapkan perubahan lalu verifikasi secara lokal.

VERIFY (must pass): node ops-watcher/foo.mjs --check

HARD STOPS — violating any aborts the directive and reverts all changes:
  - No other file may be created, edited, renamed, or deleted besides those listed above.
  - Nothing under ventures/ may be touched.
  - No network, no HTTP, no Telegram, no Paperclip.
  - No pm2, no git, no shell, no child processes.
  - No package installs; only Node built-ins and existing local modules.
  - Do NOT weaken, skip, comment out, or delete assertions to make the verification pass.`;

const specialistPacket = Object.freeze({
  taskClass: "frontend-design",
  specialists: ["design-ui-designer"],
  hardStops: ["Do not touch cockpit/", "Do not invent a new design system"],
  requiredStandards: ["docs/standards/prompting-standards.md", "docs/standards/frontend-standards.md"],
  section: [
    "SPECIALIST VOICE (taskClass: frontend-design) — judge this work the way these roles would:",
    "",
    "## UI Designer",
    "Keep interaction details crisp.",
  ].join("\n"),
});

// The EXACT decision-comment prefixes telegram-listener.mjs writes when the
// owner taps APPROVE / REJECT on a decision card (DECISION_COMMENT_PREFIX in
// that file). Reused verbatim here so the test exercises the real wording.
const TG_APPROVE = "OWNER MENYETUJUI via Telegram (2026-09-01T09:30:00.000Z) — ketukan tombol oleh owner via @ahmadsuperbot. Label OWNER_REQUIRED dihapus sehingga alur otomatis dapat dilanjutkan.";
const TG_REJECT = "OWNER MENOLAK via Telegram (2026-09-01T09:30:00.000Z) — ketukan tombol oleh owner via @ahmadsuperbot. Status diubah menjadi cancelled; label OWNER_REJECTED ditambahkan.";
function ownerRequiredBody(at = "2026-09-01T09:00:00.000Z") {
  return `DIRECTIVE OWNER REQUIRED (${at}): directive perlu keputusan owner.`;
}

function makeSweepDeps({ issues, comments, plan = goodPlan, stateFile = TMP_STATE, extra = {} }) {
  const posts = [];
  const cards = [];
  const messages = [];
  const patches = [];
  const labels = [];
  const spies = { execute: 0, telegram: 0, git: 0, pm2: 0 };
  let executeCalls = 0;
  const deps = {
    base: "http://paperclip.test",
    companyId: "C",
    listIssues: async () => ({ issues, networkError: false }),
    httpGet: async (url) => {
      const id = url.match(/\/api\/issues\/([^/]+)\/comments$/)?.[1];
      return { body: comments[id] || [], networkError: false };
    },
    httpPost: async (url, body) => {
      posts.push({ url, body });
      const id = url.match(/\/api\/issues\/([^/]+)\/comments$/)?.[1];
      comments[id] = comments[id] || [];
      comments[id].push({ id: `posted-${posts.length}`, body: body.body, createdAt: new Date(NOW).toISOString(), authorType: body.authorType });
      return { status: 201, body: comments[id].at(-1), networkError: false };
    },
    retrieveContext: async () => ({ status: "ok", evidence: [] }),
    dispatchPlan: async () => ({ ok: true, stdout: plan, stderr: "", timedOut: false }),
    // Default decision-card sender stub: records the call and reports success.
    // Real Telegram is never touched during tests.
    sendDecisionCard: async (arg) => { cards.push(arg); return { sent: true }; },
    // Legacy stage-2 execution seam; kept as a tripwire for older branches.
    execute: async () => { executeCalls++; spies.execute++; return { ok: true }; },
    // Stage 3b executor seam. The default is a harmless injected skip so tests
    // never reach real lane execution unless a test deliberately asks for it.
    executeDirective: async () => { executeCalls++; spies.execute++; return { outcome: "skipped", reason: "default-test-skip" }; },
    sendOwnerMessage: async (text) => { messages.push(text); spies.telegram++; return { sent: true }; },
    patchIssue: async (iss, patch) => { patches.push({ issue: iss, patch }); return { status: 200, body: { ...iss, ...patch }, networkError: false }; },
    // Mirrors addIssueLabelReal's real contract: success is the explicit `ok: true`.
    // The old fake returned only { status, body, networkError:false }, which let a
    // 404 from the real label endpoint count as success in production — the bug
    // that left KOL-68 with an escalation comment and no OWNER_REQUIRED label.
    addIssueLabel: async (iss, label) => { labels.push({ issue: iss, label }); return { ok: true, status: 201, body: { label }, networkError: false }; },
    stateFile,
    now: NOW,
    log: () => {},
    ...LOCK_DEPS,
    ...extra,
  };
  return { deps, posts, cards, messages, patches, labels, spies, getExecuteCalls: () => executeCalls };
}
async function resetTmp() { await fs.unlink(TMP_STATE).catch(() => {}); await clearTempLock(); }
function memoryStateFs(initial) {
  let data = JSON.stringify(initial);
  return {
    readFile: async () => data,
    writeFile: async (_file, body) => { data = String(body); },
  };
}

// E2/E3 write bookkeeping comments in the house marker shape ([DECISION BRIEF],
// [ESCALATION ACTIONS]). They are not content posts, and the assertions below
// are about content — the plan, the escalation, the result.
const contentPosts = (posts) => posts.filter((p) => !/^\[[A-Z ]+\]/.test(String(p?.body?.body || "")));

async function t(name, fn) {
  try { await fn(); ok(name); } catch (e) { bad(name, e); }
}

await resetTmp();

await t("E1 planIdentityKey is stable and changes when objective, files, steps, verify, or outOfScope changes", () => {
  const base = parsePlan(goodPlan);
  const same = parsePlan(goodPlan);
  assert.equal(base.ok, true);
  assert.equal(same.ok, true);
  const key = planIdentityKey(base);
  assert.equal(planIdentityKey(same), key);
  const cases = [
    { ...base, objective: base.objective + " v2" },
    { ...base, files: [...base.files, "ops-watcher/baz.mjs"] },
    { ...base, steps: [...base.steps, "Catat hasil verifikasi."] },
    { ...base, verify: "node ops-watcher/foo.mjs --check --strict" },
    { ...base, outOfScope: base.outOfScope + " Tidak menyentuh secrets." },
  ];
  for (const changed of cases) assert.notEqual(planIdentityKey(changed), key);
});

await t("E2 recordExecutionFailure counts identical plan failures and executionCapReached trips at two", () => {
  assert.equal(MAX_EXECUTION_ATTEMPTS, 2);
  const state = {};
  const planKey = "plan-a";
  const first = recordExecutionFailure(state, "i1", planKey, { reason: "verify-red", at: "2026-09-02T09:22:00.000Z" });
  assert.equal(first.count, 1);
  assert.equal(executionCapReached(state, "i1", planKey), false);
  const second = recordExecutionFailure(state, "i1", planKey, { reason: "verify-red", at: "2026-09-02T09:38:00.000Z" });
  assert.equal(second.count, 2);
  assert.equal(executionCapReached(state, "i1", planKey), true);
});

await t("E3 recordExecutionFailure resets when the planKey changes", () => {
  const state = {};
  recordExecutionFailure(state, "i1", "plan-a", { reason: "verify-red" });
  recordExecutionFailure(state, "i1", "plan-a", { reason: "verify-red" });
  const reset = recordExecutionFailure(state, "i1", "plan-b", { reason: "full-suite-red" });
  assert.equal(reset.count, 1);
  assert.equal(reset.planKey, "plan-b");
  assert.equal(executionCapReached(state, "i1", "plan-b"), false);
});

await t("E4 clearExecutionFailures removes the stored record and the next failure starts at one", () => {
  const state = {};
  recordExecutionFailure(state, "i1", "plan-a", { reason: "verify-red" });
  recordExecutionFailure(state, "i1", "plan-a", { reason: "verify-red" });
  clearExecutionFailures(state, "i1");
  assert.equal(executionCapReached(state, "i1", "plan-a"), false);
  const next = recordExecutionFailure(state, "i1", "plan-a", { reason: "verify-red" });
  assert.equal(next.count, 1);
});

await t("E5 state loader round-trip preserves executionFailures", async () => {
  const initial = {
    attempts: {},
    lastPlanFailures: {},
    executionFailures: { i1: { planKey: "plan-a", reason: "verify-red", count: 2, at: "2026-09-02T09:38:00.000Z" } },
    attemptCapDecisionResets: {},
    pendingCards: {},
    lastSweepMs: 0,
  };
  let data = JSON.stringify(initial);
  let writes = 0;
  const stateFs = {
    readFile: async () => data,
    writeFile: async (_file, body) => { writes += 1; data = String(body); },
  };
  const { deps } = makeSweepDeps({ issues: [], comments: {}, stateFile: "memory-state-e5", extra: { _fs: stateFs, once: true } });
  await runDirectiveSweepOnce(deps);
  const saved = JSON.parse(data);
  assert.equal(writes >= 1, true, "the loaded state must be written back");
  assert.deepEqual(saved.executionFailures, initial.executionFailures);
});

await t("classifyDirective covers new, awaiting-approval, approved, rejected, done, stalled including KOL-69 shape", () => {
  assert.equal(classifyDirective(issue(), [], { now: NOW }).state, "new");
  assert.equal(classifyDirective(issue(), [c(`${PLAN_MARKER} (iso):\n${goodPlan}`)], { now: NOW }).state, "awaiting-approval");
  assert.equal(classifyDirective(issue(), [c(`${PLAN_MARKER} (iso):\n${goodPlan}`), c(`${APPROVED_MARKER}: lanjut`)], { now: NOW }).state, "approved");
  assert.equal(classifyDirective(issue(), [c(`${PLAN_MARKER} (iso):\n${goodPlan}`), c(`${REJECTED_MARKER}: jangan`)], { now: NOW }).state, "rejected");
  assert.equal(classifyDirective(issue({ status: "done" }), [], { now: NOW }).state, "done");
  assert.equal(classifyDirective(issue(), [c(`${RESULT_MARKER}: selesai`)], { now: NOW }).state, "done");
  const sixHoursAgo = new Date(NOW - DEFAULT_STALLED_AFTER_MS - 1).toISOString();
  const kol69 = issue({ id: "kol-69", identifier: "KOL-69", title: "/pause" });
  const cls = classifyDirective(kol69, [c(`${DISPATCH_MARKER} (ops-watcher/ahmad-dispatch): waking headless AHMAD for KOL-69.`, sixHoursAgo)], { now: NOW });
  assert.equal(cls.state, "stalled");
});

await t("classifyDirective keeps ordinary plan approval approved when no execution-cap report is between them", () => {
  const planAt = "2026-09-01T09:00:00.000Z";
  const approvalAt = "2026-09-01T09:30:00.000Z";
  const cls = classifyDirective(issue(), [
    c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt),
    c(TG_APPROVE, approvalAt),
  ], { now: NOW });
  assert.equal(cls.state, "approved");
  assert.equal(cls.reason, "owner approved via Telegram after plan");
});

await t("classifyDirective stalls a capped directive when owner approves a re-plan after the execution cap", () => {
  const planAt = "2026-09-01T09:00:00.000Z";
  const capAt = "2026-09-01T09:20:00.000Z";
  const approvalAt = "2026-09-01T09:30:00.000Z";
  const cls = classifyDirective(issue(), [
    c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt),
    c(`${EXECUTION_CAP_MARKER} (${capAt}): directive dihentikan setelah 2 eksekusi gagal identik.`, capAt),
    c(TG_APPROVE, approvalAt),
  ], { now: NOW });
  assert.equal(cls.state, "stalled");
  assert.equal(cls.reason, "owner approved a re-plan after the execution cap");
  assert.equal(isPlannable(issue({ status: "todo" }), cls.state), true);
});

// The case that actually shipped broken. KOL-36 was approved at 09:08, capped
// at 11:20, and approved again at 11:29. findPlanDecision returns the OLDEST
// decision after the plan, so the classifier reported the 09:08 approval and a
// "cap between plan and approval" test read false - the owner's second tap did
// nothing. What matters is whether an approval exists AFTER the cap report.
await t("classifyDirective stalls when approved once before the cap and once after", () => {
  const planAt = "2026-09-01T09:00:00.000Z";
  const firstApprovalAt = "2026-09-01T09:08:00.000Z";
  const capAt = "2026-09-01T09:20:00.000Z";
  const secondApprovalAt = "2026-09-01T09:29:00.000Z";
  const cls = classifyDirective(issue(), [
    c(`${PLAN_MARKER} (iso):
${goodPlan}`, planAt),
    c(TG_APPROVE, firstApprovalAt),
    c(`${EXECUTION_CAP_MARKER} (${capAt}): directive dihentikan setelah 2 eksekusi gagal identik.`, capAt),
    c(TG_APPROVE, secondApprovalAt),
  ], { now: NOW });
  assert.equal(cls.state, "stalled");
  assert.equal(isPlannable(issue({ status: "todo" }), cls.state), true);
});

await t("classifyDirective keeps approved when execution-cap report is after the approval", () => {
  const planAt = "2026-09-01T09:00:00.000Z";
  const approvalAt = "2026-09-01T09:30:00.000Z";
  const capAt = "2026-09-01T09:40:00.000Z";
  const cls = classifyDirective(issue(), [
    c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt),
    c(TG_APPROVE, approvalAt),
    c(`${EXECUTION_CAP_MARKER} (${capAt}): directive dihentikan setelah 2 eksekusi gagal identik.`, capAt),
  ], { now: NOW });
  assert.equal(cls.state, "approved");
});

await t("classifyDirective recognises legacy execution-cap report before re-plan approval", () => {
  const planAt = "2026-09-01T09:00:00.000Z";
  const capAt = "2026-09-01T09:20:00.000Z";
  const approvalAt = "2026-09-01T09:30:00.000Z";
  const cls = classifyDirective(issue(), [
    c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt),
    c(`DIRECTIVE OWNER REQUIRED (${capAt}): directive dihentikan setelah 2 eksekusi gagal identik.`, capAt),
    c(TG_APPROVE, approvalAt),
  ], { now: NOW });
  assert.equal(cls.state, "stalled");
  assert.equal(cls.reason, "owner approved a re-plan after the execution cap");
});

await t("classifyDirective does not treat planning-cap approval as execution-cap re-plan", () => {
  const planAt = "2026-09-01T09:00:00.000Z";
  const capAt = "2026-09-01T09:20:00.000Z";
  const approvalAt = "2026-09-01T09:30:00.000Z";
  const cls = classifyDirective(issue(), [
    c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt),
    c(`DIRECTIVE OWNER REQUIRED (${capAt}): directive perlu keputusan owner.`, capAt),
    c(TG_APPROVE, approvalAt),
  ], { now: NOW });
  assert.equal(cls.state, "approved");
});

await t("wake marker only 10 minutes old is not stalled", () => {
  const tenMinutesAgo = new Date(NOW - 10 * 60_000).toISOString();
  const cls = classifyDirective(issue(), [c(`${DISPATCH_MARKER}: waking`, tenMinutesAgo)], { now: NOW });
  assert.equal(cls.state, "new");
});

await t("buildPlanPrompt demands exact plan shape and hard boundaries", () => {
  const p = buildPlanPrompt(issue(), { status: "ok" });
  assert.match(p, /OBJECTIVE: <one sentence>/);
  assert.match(p, /RISK: low \| medium \| high/);
  assert.match(p, /nothing under ventures\/, \.git\/, \.paperclip\//);
  assert.match(p, /no network; no message to anyone but the owner; no package installs/);
});

await t("buildPlanPrompt teaches the two allowed VERIFY command shapes", () => {
  const p = buildPlanPrompt(issue(), { status: "ok" });
  assert.match(p, /node ops-watcher\//);
  assert.match(p, /node ops-watcher\/run-all-tests\.mjs --only <suite-file>/);
  assert.match(p, /node ops-watcher\/verify-file\.mjs --path <file> --matches <regex>/);
});

await t("buildPlanPrompt omits previous failure feedback when no lastFailure is provided", () => {
  const p = buildPlanPrompt(issue(), { status: "ok" });
  assert.doesNotMatch(p, /PREVIOUS ATTEMPT WAS REJECTED/);
  assert.doesNotMatch(p, /verify-out-of-scope/);
  assert.doesNotMatch(p, /VERIFY must not contain command chaining characters/);
});

await t("buildPlanPrompt includes previous plan failure feedback", () => {
  const p = buildPlanPrompt(issue(), { status: "ok" }, {
    reason: "verify-out-of-scope",
    detail: "VERIFY must not contain command chaining characters",
    attempt: 1,
  });
  assert.match(p, /PREVIOUS ATTEMPT WAS REJECTED/);
  assert.match(p, /Reason code: verify-out-of-scope/);
  assert.match(p, /Detail: VERIFY must not contain command chaining characters/);
  assert.match(p, /Attempt: 1/);
  assert.match(p, /Do not resubmit the same VERIFY line\./);
});

await t("buildPlanPrompt previous failure with only reason renders no nullish text", () => {
  const p = buildPlanPrompt(issue(), { status: "ok" }, { reason: "parse-failed" });
  assert.match(p, /Reason code: parse-failed/);
  assert.doesNotMatch(p, /undefined/);
  assert.doesNotMatch(p, /null/);
});

await t("buildPlanPrompt states VERIFY chaining and regex alternation bans", () => {
  const p = buildPlanPrompt(issue(), { status: "ok" });
  assert.match(p, /; & or \|/);
  assert.match(p, /--matches regex too: write a regex without \| alternation/);
});

await t("buildPlanPrompt VERIFY template says single command, not command(s)", () => {
  const p = buildPlanPrompt(issue(), { status: "ok" });
  assert.match(p, /VERIFY: <the single command that proves it worked>/);
  assert.doesNotMatch(p, /command\(s\)/);
});
await t("buildPlanPrompt without specialists is byte-for-byte unchanged", () => {
  assert.equal(buildPlanPrompt(issue(), { status: "ok" }), EXPECTED_PLAN_PROMPT_NO_SPECIALIST);
  assert.equal(buildPlanPrompt(issue(), { status: "ok" }, null, { section: "" }), EXPECTED_PLAN_PROMPT_NO_SPECIALIST);
});

await t("buildPlanPrompt renders specialist task class, hard stops, standards, and voice in order", () => {
  const p = buildPlanPrompt(issue(), { status: "ok" }, null, specialistPacket);
  assert.match(p, /Task class: frontend-design/);
  assert.match(p, /HARD STOPS — do not do these:/);
  assert.match(p, /- Do not touch cockpit\//);
  assert.match(p, /REQUIRED STANDARDS — file paths the plan must obey:/);
  assert.match(p, /- docs\/standards\/prompting-standards\.md/);
  assert.match(p, /SPECIALIST VOICE \(taskClass: frontend-design\)/);
  assert.ok(p.indexOf("HARD STOPS — do not do these:") < p.indexOf("SPECIALIST VOICE (taskClass: frontend-design)"));
});

await t("sweep specialist resolver failure leaves no-specialist prompt and does not abort", async () => {
  await resetTmp();
  const target = issue({ id: "iss-specialist-throw", identifier: "KOL-THROW", title: "Dashboard polish", description: "Design the dashboard" });
  const comments = { [target.id]: [] };
  let capturedPrompt = null;
  const logs = [];
  const { deps, cards } = makeSweepDeps({ issues: [target], comments, extra: {
    dispatchPlan: async (prompt) => { capturedPrompt = prompt; return { ok: true, stdout: goodPlan, stderr: "", timedOut: false }; },
    resolveSpecialistsForPacket: async () => { throw new Error("resolver boom"); },
    log: (msg) => { logs.push(msg); },
  } });
  const summary = await runDirectiveSweepOnce(deps);
  assert.equal(summary.planned, 1);
  assert.equal(cards.length, 1);
  assert.equal(logs.some((msg) => /specialist resolver failed.*resolver boom/.test(msg)), true);

  // The baseline is taken from the sweep itself, with a resolver that simply
  // returns nothing, rather than from a prompt rebuilt by hand. A hand-built
  // expectation couples this test to every unrelated part of the prompt (it was
  // first written that way and broke on the PREVIOUS-ATTEMPT block, which has
  // nothing to do with specialists). What must hold is narrower and stronger:
  // a resolver that throws produces the SAME prompt as a resolver that declines.
  await resetTmp();
  let baselinePrompt = null;
  const { deps: baseDeps } = makeSweepDeps({ issues: [target], comments: { [target.id]: [] }, extra: {
    dispatchPlan: async (prompt) => { baselinePrompt = prompt; return { ok: true, stdout: goodPlan, stderr: "", timedOut: false }; },
    resolveSpecialistsForPacket: async () => null,
  } });
  await runDirectiveSweepOnce(baseDeps);
  assert.equal(capturedPrompt, baselinePrompt, "a throwing resolver changes nothing about the prompt");
  assert.equal(/SPECIALIST VOICE|HARD STOPS|Task class:/.test(capturedPrompt), false, "no specialist content leaked in");
});

await t("unclassified directive keeps the plan prompt unchanged", async () => {
  await resetTmp();
  const target = issue({ id: "iss-unclassified", identifier: "KOL-PLAIN", title: "QZXW minor tune", description: "Plain request with no matching packet keywords" });
  const comments = { [target.id]: [] };
  let capturedPrompt = null;
  const { deps } = makeSweepDeps({ issues: [target], comments, extra: {
    dispatchPlan: async (prompt) => { capturedPrompt = prompt; return { ok: true, stdout: goodPlan, stderr: "", timedOut: false }; },
  } });
  const summary = await runDirectiveSweepOnce(deps);
  assert.equal(summary.planned, 1);

  // Same discipline as the throwing-resolver case: compare against a baseline
  // the sweep itself produced with a declining resolver, so this asserts the
  // one thing it means to assert.
  await resetTmp();
  let baselinePrompt = null;
  const { deps: baseDeps } = makeSweepDeps({ issues: [target], comments: { [target.id]: [] }, extra: {
    dispatchPlan: async (prompt) => { baselinePrompt = prompt; return { ok: true, stdout: goodPlan, stderr: "", timedOut: false }; },
    resolveSpecialistsForPacket: async () => null,
  } });
  await runDirectiveSweepOnce(baseDeps);
  assert.equal(capturedPrompt, baselinePrompt, "an unclassifiable directive gets the plain prompt");
  assert.equal(/SPECIALIST VOICE|HARD STOPS|Task class:/.test(capturedPrompt), false, "no specialist content for an unclassified task");
});

await t("parsePlan parses well-formed plan and rejects missing VERIFY", () => {
  const parsed = parsePlan(goodPlan);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.files, ["ops-watcher/foo.mjs", "docs/bar.md"]);
  assert.equal(parsed.steps.length, 2);
  assert.equal(parsePlan(goodPlan.replace(/^VERIFY: .+\n/m, "")).ok, false);
});

// The registry these tests state for themselves. Never the live one: this file
// must not change meaning when the owner edits config/ventures.json.
const NO_VENTURES = async () => null;
const REGISTRY = [
  { id: "caveman-trading-os", status: "active", repoPath: "ventures/caveman-trading-os" },
  { id: "parked-venture", status: "parked", repoPath: "ventures/parked-venture" },
];
const registryLookup = async (repoRelPath) => {
  const wanted = String(repoRelPath || "").replace(/\\/g, "/");
  return REGISTRY.find((v) => wanted === v.repoPath || wanted.startsWith(`${v.repoPath}/`)) || null;
};

await t("validatePlanScope rejects denied paths and accepts normal repo-relative files", async () => {
  const badPlan = { files: ["ventures/x.mjs", "../outside.txt", "C:\\abs\\path.txt", ".env.local", "ops-watcher/heartbeat.mjs"] };
  const res = await validatePlanScope(badPlan, { ventureForPath: NO_VENTURES });
  assert.equal(res.ok, false);
  assert.equal(res.violations.length >= 5, true);
  assert.equal((await validatePlanScope({ files: ["ops-watcher/foo.mjs", "docs/bar.md"] }, { ventureForPath: NO_VENTURES })).ok, true);
});

// =====================================================================
// THE VENTURES GATE IS NARROW: ACTIVE VENTURES ONLY, AND IT SAYS WHY.
//
// The owner approved paths under a venture whose status is `active`, and
// nothing else. Not a blanket opening of ventures/. The two refusal cases are
// different questions — a path nobody registered, versus a venture deliberately
// not being worked on — and answering both with "denied directory" sends the
// reader looking in the wrong place.
// =====================================================================

await t("ventures gate: an ACTIVE venture path is allowed, and only that venture", async () => {
  const deps = { ventureForPath: registryLookup };
  const allowed = await validatePlanScope({
    files: [
      "ventures/caveman-trading-os/docs/planning/phase-1-workstreams.md",
      "ventures/caveman-trading-os",
      "ops-watcher/foo.mjs",
    ],
  }, deps);
  assert.equal(allowed.ok, true, `an active venture and the repo root itself are allowed: ${allowed.violations.join(" | ")}`);
});

await t("ventures gate: unknown venture and inactive venture are refused, and say WHICH", async () => {
  const deps = { ventureForPath: registryLookup };

  const unknown = await validatePlanScope({ files: ["ventures/never-registered/src/a.mjs"] }, deps);
  assert.equal(unknown.ok, false, "a path under ventures/ that no venture owns stays denied");
  assert.match(unknown.violations[0], /unknown venture/, "the violation names it as unknown, not merely denied");
  assert.equal(/not active/.test(unknown.violations[0]), false, "and does not confuse it with an inactive venture");

  const parked = await validatePlanScope({ files: ["ventures/parked-venture/src/a.mjs"] }, deps);
  assert.equal(parked.ok, false, "a registered but non-active venture stays denied");
  assert.match(parked.violations[0], /parked-venture is not active/, "the violation names the venture and its status");
  assert.match(parked.violations[0], /status: parked/, "and quotes the status that decided it");

  // The bare directory belongs to no venture.
  const bare = await validatePlanScope({ files: ["ventures"] }, deps);
  assert.equal(bare.ok, false, "ventures/ itself is not a venture");
  assert.match(bare.violations[0], /unknown venture/);
});

await t("ventures gate: a venture's own .git and node_modules stay denied", async () => {
  // Opening ventures/ reaches into a second repository that has its own .git.
  // The old check only matched these at the START of a path, so nesting them
  // under an allowed venture would have walked straight through.
  const deps = { ventureForPath: registryLookup };
  for (const file of [
    "ventures/caveman-trading-os/.git/config",
    "ventures/caveman-trading-os/node_modules/x/index.js",
    "ventures/caveman-trading-os/.env.local",
  ]) {
    const res = await validatePlanScope({ files: [file] }, deps);
    assert.equal(res.ok, false, `${file} must stay denied even inside an active venture`);
  }
  const nested = await validatePlanScope({ files: ["docs/node_modules/x.js"] }, { ventureForPath: NO_VENTURES });
  assert.equal(nested.ok, false, "a denied directory is denied at any depth, not only at the head");
});

await t("ventures gate: the prompts name the active venture paths, and stay closed without them", async () => {
  const plan = parsePlan(goodPlan);

  const closedExec = buildExecutionPrompt(issue(), plan);
  assert.ok(closedExec.includes("  - Nothing under ventures/ may be touched."), "no registry means the old closed HARD STOP, unchanged");

  const openExec = buildExecutionPrompt(issue(), plan, null, REGISTRY);
  assert.ok(
    openExec.includes("Under ventures/, ONLY these active venture paths may be touched: ventures/caveman-trading-os."),
    `the HARD STOP names the active venture only, got: ${openExec.split("\n").find((l) => l.includes("ventures/")) || "<none>"}`,
  );
  assert.equal(openExec.includes("parked-venture"), false, "a parked venture is never offered to the lane");
  assert.equal(openExec.includes("Nothing under ventures/ may be touched"), false, "the closed line is replaced, not duplicated");

  const closedPlan = buildPlanPrompt(issue(), { status: "ok" });
  assert.ok(closedPlan.includes("nothing under ventures/, .git/, .paperclip/"), "the planning boundary stays closed without a registry");

  const openPlan = buildPlanPrompt(issue(), { status: "ok" }, null, null, REGISTRY);
  assert.ok(openPlan.includes("ONLY these active venture paths may be touched: ventures/caveman-trading-os"), "the planning boundary names the active venture");
  assert.equal(openPlan.includes("parked-venture"), false, "and not the parked one");
  // Left closed here, the planner would never propose a venture path and the
  // gate below it would be unreachable.
  assert.equal(openPlan.includes("nothing under ventures/, .git/"), false, "the closed planning line is replaced, not kept alongside");
});

await t("ventures gate: VERIFY still must start with node ops-watcher/", async () => {
  // A venture directive verifies through an ops-watcher script, never through
  // the venture's own test runner. Opening the file fence does not open this one.
  assert.equal(validateVerifyCommand("node ventures/caveman-trading-os/scripts/test.mjs").ok, false);
  assert.equal(validateVerifyCommand("npm --prefix ventures/caveman-trading-os test").ok, false);
  assert.equal(validateVerifyCommand("node ops-watcher/verify-file.mjs --path ventures/caveman-trading-os/README.md --matches ^#").ok, true);
});

await t("ventures gate: the registry actually REACHES the lane's prompt and the scope gate", async () => {
  // Testing buildExecutionPrompt directly is not enough: a mutation that drops
  // `ventures` from the CALL SITE left the whole suite green. The only thing
  // that proves the wiring is asking executeApprovedDirective for the prompt it
  // really dispatched.
  const plan = parsePlan(goodPlan);
  const made = makeExecDeps({ mutateOnDispatch: false });
  let dispatched = null;
  made.deps.activeVentures = async () => REGISTRY;
  made.deps.dispatchExecution = async (prompt) => {
    dispatched = prompt;
    made.calls.dispatch++;
    made.setMutated(true);
    return { ok: true, stdout: "done", stderr: "" };
  };

  const res = await executeApprovedDirective(issue(), plan, made.deps);
  assert.equal(res.outcome, "done");
  assert.ok(dispatched, "a prompt was dispatched");
  assert.ok(
    dispatched.includes("Under ventures/, ONLY these active venture paths may be touched: ventures/caveman-trading-os."),
    "the registry resolved inside executeApprovedDirective must reach the prompt the lane receives",
  );
  assert.equal(dispatched.includes("Nothing under ventures/ may be touched"), false, "the closed HARD STOP is gone when a venture is active");
  assert.equal(dispatched.includes("parked-venture"), false, "a parked venture never reaches the lane");
});

await t("ventures gate: an active venture path survives the execution scope gate end to end", async () => {
  // The same wiring on the refusal side: with the registry injected, a plan
  // touching the ACTIVE venture must execute rather than be refused.
  const venturePlan = parsePlan(goodPlan.replace(
    "ops-watcher/foo.mjs, docs/bar.md",
    "ventures/caveman-trading-os/docs/planning/phase-1-workstreams.md",
  ));
  const active = makeExecDeps({ mutateOnDispatch: false });
  active.deps.activeVentures = async () => REGISTRY;
  active.deps.ventureForPath = registryLookup;
  active.deps.dispatchExecution = async () => { active.calls.dispatch++; active.setMutated(true); return { ok: true, stdout: "done", stderr: "" }; };
  const allowed = await executeApprovedDirective(issue(), venturePlan, active.deps);
  assert.notEqual(allowed.outcome, "refused", `an active venture path must pass the scope gate, got ${allowed.outcome}`);

  // And the parked one must not, through the very same path.
  const parkedPlan = parsePlan(goodPlan.replace("ops-watcher/foo.mjs, docs/bar.md", "ventures/parked-venture/src/a.mjs"));
  const parked = makeExecDeps({ mutateOnDispatch: false });
  parked.deps.activeVentures = async () => REGISTRY;
  parked.deps.ventureForPath = registryLookup;
  const refused = await executeApprovedDirective(issue(), parkedPlan, parked.deps);
  assert.equal(refused.outcome, "refused", "a parked venture is refused at execution time");
  assert.equal(parked.calls.dispatch, 0, "and no lane is dispatched");
  assert.match(refused.violations.join(" "), /not active/, "the refusal says the venture is not active");
});

// =====================================================================
// N5. A GRAPH PER VENTURE, STAMPED WITH THE VENTURE'S OWN COMMIT.
//
// The two repositories move independently. A single stamp cannot speak for
// both: an Aidit OS commit would invalidate a venture graph that is still
// correct, and a venture commit would fail to invalidate one that has gone
// wrong — the second is exactly the "fresh stamp, stale content" failure this
// system paid for earlier.
// =====================================================================

await t("N5 routing: venture files go to the venture graph, everything else to the Aidit OS graph", () => {
  const routes = routeFilesToGraphs(
    [
      "ops-watcher/foo.mjs",
      "ventures/caveman-trading-os/src/a.py",
      "ventures/caveman-trading-os/docs/b.md",
      "docs/c.md",
    ],
    REGISTRY,
    { ventureHeadCommit: () => "cafebabe" },
  );

  assert.deepEqual([...routes.keys()].sort(), ["aidit", "venture:caveman-trading-os"]);
  assert.deepEqual(routes.get("aidit").files, ["ops-watcher/foo.mjs", "docs/c.md"]);
  assert.deepEqual(routes.get("venture:caveman-trading-os").files, [
    "ventures/caveman-trading-os/src/a.py",
    "ventures/caveman-trading-os/docs/b.md",
  ]);

  const v = routes.get("venture:caveman-trading-os");
  assert.match(v.graphFile.replace(/\\/g, "/"), /graphify-out\/ventures\/caveman-trading-os\/graph\.json$/);
  assert.match(v.stampFile.replace(/\\/g, "/"), /graphify-out\/ventures\/caveman-trading-os\/graph\.json\.commit\.stamp$/);
  assert.equal(v.repoCommit, "cafebabe", "the venture graph is checked against the VENTURE's HEAD");
  assert.equal(routes.get("aidit").repoCommit, undefined, "the Aidit OS route uses this repository's own HEAD");
});

await t("N5 routing: a plan with no venture files does not consult a venture graph at all", () => {
  const routes = routeFilesToGraphs(["ops-watcher/foo.mjs"], REGISTRY, {
    ventureHeadCommit: () => { throw new Error("git must not be consulted"); },
  });
  assert.deepEqual([...routes.keys()], ["aidit"]);
});

await t("N5: an unreadable venture HEAD yields no anchors rather than anchors from the wrong graph", async () => {
  const graph = {
    nodes: [{ id: "a", label: "runFooCheck", type: "function", source_file: "ventures/caveman-trading-os/src/a.py", source_location: "L10" }],
    edges: [],
  };
  await withActiveGraph(graph, () => {
    const plan = { ...parsePlan(goodPlan), files: ["ventures/caveman-trading-os/src/a.py"] };
    // ventureHeadCommit returning null is "I cannot establish freshness", and a
    // graph whose freshness cannot be established is not a fresh graph.
    const p = buildExecutionPrompt(issue(), plan, null, REGISTRY);
    const line = p.split("\n").find((l) => l.includes("ventures/caveman-trading-os/src/a.py")) || "";
    assert.equal(line.includes("KG anchors"), false, `no anchors when the venture HEAD is unknown, got: ${line}`);
  });
});

await t("N5: the Aidit OS graph never answers for a venture path", async () => {
  // The failure this prevents: the Aidit OS graph is fresh and stamped, the
  // venture graph does not exist, and a venture file quietly gets anchors from
  // a graph that has never seen it.
  const graph = {
    nodes: [
      { id: "a", label: "aiditSymbol", type: "function", source_file: "ops-watcher/foo.mjs", source_location: "L10" },
      { id: "b", label: "ventureSymbol", type: "function", source_file: "ventures/caveman-trading-os/src/a.py", source_location: "L20" },
    ],
    edges: [],
  };
  await withActiveGraph(graph, () => {
    const plan = { ...parsePlan(goodPlan), files: ["ops-watcher/foo.mjs", "ventures/caveman-trading-os/src/a.py"] };
    const p = buildExecutionPrompt(issue(), plan, null, REGISTRY);
    const aiditLine = p.split("\n").find((l) => l.includes("- ops-watcher/foo.mjs")) || "";
    const ventureLine = p.split("\n").find((l) => l.includes("- ventures/caveman-trading-os/src/a.py")) || "";
    assert.ok(aiditLine.includes("aiditSymbol"), `the Aidit OS file still gets its anchors: ${aiditLine}`);
    assert.equal(ventureLine.includes("ventureSymbol"), false, "the venture file must NOT be answered by the Aidit OS graph");
    assert.equal(ventureLine.includes("KG anchors"), false, "and gets no anchors at all when its own graph is absent");
  });
});

await t("activeVenturePathsFor filters by status and is deterministic", () => {
  assert.deepEqual(activeVenturePathsFor(REGISTRY), ["ventures/caveman-trading-os"]);
  assert.deepEqual(activeVenturePathsFor([]), []);
  assert.deepEqual(activeVenturePathsFor(null), []);
  assert.deepEqual(
    activeVenturePathsFor([
      { id: "b", status: "active", repoPath: "ventures/b" },
      { id: "a", status: "active", repoPath: "ventures\\a" },
    ]),
    ["ventures/a", "ventures/b"],
    "sorted, and a Windows separator normalises to the repo-relative form",
  );
});

await t("validateVerifyCommand accepts node ops-watcher verifier shapes", () => {
  assert.equal(validateVerifyCommand("node ops-watcher/run-all-tests.mjs --only x.test.mjs").ok, true);
  assert.equal(validateVerifyCommand("node ops-watcher/verify-file.mjs --path a/b.txt --matches ^OK$").ok, true);
});

await t("validateVerifyCommand keeps chaining rejection and plain node verifier acceptance", () => {
  const chained = validateVerifyCommand("node ops-watcher/x.mjs && echo hi");
  assert.equal(chained.ok, false);
  assert.equal(chained.reason, "VERIFY must not contain command chaining characters");
  assert.equal(validateVerifyCommand("node ops-watcher/run-all-tests.mjs --only y").ok, true);
});

await t("validateVerifyCommand rejects non-contract and chained VERIFY commands", () => {
  assert.equal(validateVerifyCommand("$c = Get-Content ops-watcher/canary-step.mjs; if ($c -match 'canaryAdd') { exit 0 } else { exit 1 }").ok, false);
  assert.equal(validateVerifyCommand("bash -c ls").ok, false);
  assert.equal(validateVerifyCommand("node ops-watcher/run-all-tests.mjs --only x.test.mjs && node ops-watcher/verify-file.mjs --path a --contains b").ok, false);
  assert.equal(validateVerifyCommand("node ops-watcher/run-all-tests.mjs --only x.test.mjs; node ops-watcher/verify-file.mjs --path a --contains b").ok, false);
  assert.equal(validateVerifyCommand("node ops-watcher/run-all-tests.mjs --only x.test.mjs\nnode ops-watcher/verify-file.mjs --path a --contains b").ok, false);
});

await t("sweep with one new directive posts exactly one plan comment and no execution/Telegram spy", async () => {
  await resetTmp();
  const issues = [issue({ id: "i1", identifier: "KOL-101" })];
  const comments = { i1: [] };
  const { deps, posts, spies } = makeSweepDeps({ issues, comments });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.scanned, 1);
  assert.equal(res.planned, 1);
  assert.equal(contentPosts(posts).length, 1);
  assert.match(posts[0].body.body, /^DIRECTIVE PLAN \(/);
  assert.equal(spies.execute + spies.telegram + spies.git + spies.pm2, 0);
});

await t("sweep passes recorded lastPlanFailure into the planner prompt", async () => {
  const state = {
    attempts: { i1: 1 },
    lastPlanFailures: {
      i1: {
        reason: "verify-out-of-scope",
        detail: "VERIFY must not contain command chaining characters",
        attempt: 1,
      },
    },
    lastSweepMs: 0,
  };
  const issues = [issue({ id: "i1", identifier: "KOL-68" })];
  const comments = { i1: [] };
  let capturedPrompt = "";
  const { deps } = makeSweepDeps({
    issues,
    comments,
    stateFile: "memory-state-prompt-feedback",
    extra: {
      maxPlanAttempts: 2,
      _fs: memoryStateFs(state),
      dispatchPlan: async (prompt) => {
        capturedPrompt = prompt;
        return { ok: true, stdout: goodPlan, stderr: "", timedOut: false };
      },
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 1);
  assert.match(capturedPrompt, /PREVIOUS ATTEMPT WAS REJECTED/);
  assert.match(capturedPrompt, /Reason code: verify-out-of-scope/);
  assert.match(capturedPrompt, /Do not resubmit the same VERIFY line\./);
});

await t("scope-violating plan posts refusal comment and no plan comment", async () => {
  await resetTmp();
  const badScope = goodPlan.replace("ops-watcher/foo.mjs, docs/bar.md", "ventures/x.mjs");
  const comments = { i1: [] };
  const { deps, posts, cards, labels } = makeSweepDeps({ issues: [issue({ id: "i1" })], comments, plan: badScope });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.refused, 1);
  assert.equal(contentPosts(posts).length, 1);
  assert.match(posts[0].body.body, /^PLAN_REFUSED/);
  assert.match(posts[0].body.body, /file-scope-out-of-scope/);
  assert.match(posts[0].body.body, /Percobaan 1\/2/);
  assert.doesNotMatch(posts[0].body.body, /^DIRECTIVE PLAN \(/);
  assert.equal(cards.length, 0);
  assert.equal(labels.length, 0);
  const st = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
  assert.equal(st.attempts.i1, 1);
  assert.equal(st.lastPlanFailures.i1.reason, "file-scope-out-of-scope");
});

await t("bad VERIFY plan posts refusal comment and sends no decision card", async () => {
  await resetTmp();
  const badVerify = goodPlan.replace("VERIFY: node ops-watcher/foo.mjs --check", "VERIFY: $c = Get-Content ops-watcher/canary-step.mjs; if ($c -match 'canaryAdd') { exit 0 } else { exit 1 }");
  const comments = { i1: [] };
  const { deps, posts, cards, labels } = makeSweepDeps({ issues: [issue({ id: "i1", identifier: "KOL-73" })], comments, plan: badVerify });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.refused, 1);
  assert.equal(contentPosts(posts).length, 1);
  assert.match(posts[0].body.body, /^PLAN_REFUSED/);
  assert.match(posts[0].body.body, /VERIFY:/);
  assert.match(posts[0].body.body, /verify-out-of-scope/);
  assert.match(posts[0].body.body, /Percobaan 1\/2/);
  assert.equal(cards.length, 0);
  assert.equal(labels.length, 0);
  const st = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
  assert.equal(st.attempts.i1, 1);
  assert.equal(st.lastPlanFailures.i1.reason, "verify-out-of-scope");
});

await t("good VERIFY plan posts the plan and sends exactly one decision card", async () => {
  await resetTmp();
  const comments = { i1: [] };
  const { deps, posts, cards } = makeSweepDeps({ issues: [issue({ id: "i1", identifier: "KOL-74" })], comments });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 1);
  assert.equal(posts.filter((p) => /^DIRECTIVE PLAN \(/.test(p.body.body)).length, 1);
  assert.equal(cards.length, 1);
});
const noFilesVerifyFilePlan = goodPlan
  .replace("FILES: ops-watcher/foo.mjs, docs/bar.md", "FILES: NONE")
  .replace("VERIFY: node ops-watcher/foo.mjs --check", "VERIFY: node ops-watcher/verify-file.mjs --path handoffs/hermes-kimi/AHMAD-DELTA-PHASE1.md --matches \"AHMAD HEADLESS E2E PASS\"");

await t("FILES NONE with red verify-file VERIFY refuses before decision card", async () => {
  await resetTmp();
  const comments = { i1: [] };
  let verifyCalls = 0;
  const { deps, posts, cards } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-36" })],
    comments,
    plan: noFilesVerifyFilePlan,
    extra: {
      runVerifyFilePreApproval: async (verify) => {
        verifyCalls++;
        assert.match(verify, /ops-watcher\/verify-file\.mjs/);
        return { ok: false, reason: "regex did not match handoffs/hermes-kimi/AHMAD-DELTA-PHASE1.md" };
      },
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.refused, 1);
  assert.equal(verifyCalls, 1);
  assert.equal(cards.length, 0);
  assert.equal(contentPosts(posts).length, 1);
  assert.match(posts[0].body.body, /^PLAN_REFUSED/);
  assert.match(posts[0].body.body, /verify-file-red-without-files/);
  assert.match(posts[0].body.body, /regex did not match/);
  const st = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
  assert.equal(st.attempts.i1, 1);
  assert.equal(st.lastPlanFailures.i1.reason, "verify-file-red-without-files");
});

await t("FILES NONE with green verify-file VERIFY still sends decision card", async () => {
  await resetTmp();
  const comments = { i1: [] };
  let verifyCalls = 0;
  const { deps, posts, cards } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-36" })],
    comments,
    plan: noFilesVerifyFilePlan,
    extra: { runVerifyFilePreApproval: async () => { verifyCalls++; return { ok: true }; } },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 1);
  assert.equal(verifyCalls, 1);
  assert.equal(posts.filter((p) => /^DIRECTIVE PLAN \(/.test(p.body.body)).length, 1);
  assert.equal(cards.length, 1);
});

await t("plan with files and red verify-file VERIFY still sends decision card", async () => {
  await resetTmp();
  const comments = { i1: [] };
  let verifyCalls = 0;
  const planWithFiles = goodPlan.replace("VERIFY: node ops-watcher/foo.mjs --check", "VERIFY: node ops-watcher/verify-file.mjs --path docs/bar.md --matches MISSING");
  const { deps, posts, cards } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-37" })],
    comments,
    plan: planWithFiles,
    extra: { runVerifyFilePreApproval: async () => { verifyCalls++; return { ok: false, reason: "red" }; } },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 1);
  assert.equal(verifyCalls, 0);
  assert.equal(posts.filter((p) => /^DIRECTIVE PLAN \(/.test(p.body.body)).length, 1);
  assert.equal(cards.length, 1);
});

await t("FILES NONE with non verify-file VERIFY sends card without pre-approval runner", async () => {
  await resetTmp();
  const comments = { i1: [] };
  let verifyCalls = 0;
  const noFilesOtherVerifyPlan = goodPlan.replace("FILES: ops-watcher/foo.mjs, docs/bar.md", "FILES: NONE");
  const { deps, posts, cards } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-38" })],
    comments,
    plan: noFilesOtherVerifyPlan,
    extra: { runVerifyFilePreApproval: async () => { verifyCalls++; return { ok: false, reason: "should not run" }; } },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 1);
  assert.equal(verifyCalls, 0);
  assert.equal(posts.filter((p) => /^DIRECTIVE PLAN \(/.test(p.body.body)).length, 1);
  assert.equal(cards.length, 1);
});

await t("unparseable plan increments attempt counter and stops after MAX_PLAN_ATTEMPTS", async () => {
  await resetTmp();
  const comments = { i1: [] };
  const mk = () => makeSweepDeps({ issues: [issue({ id: "i1" })], comments, plan: "not a plan", extra: { maxPlanAttempts: 2 } });
  let a = mk(); await runDirectiveSweepOnce(a.deps);
  let b = mk(); await runDirectiveSweepOnce(b.deps);
  let cRun = mk(); await runDirectiveSweepOnce(cRun.deps);
  const st = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
  assert.equal(st.attempts.i1, 2);
  assert.equal(st.lastPlanFailures.i1.reason, "parse-failed");
  assert.equal(comments.i1.filter((x) => /DIRECTIVE DRAFT FAILED/.test(x.body)).length, 2);
});

await t("plan attempt cap adds OWNER_REQUIRED and one plain Indonesian escalation comment", async () => {
  await resetTmp();
  await fs.writeFile(TMP_STATE, JSON.stringify({
    attempts: { i1: 2 },
    lastPlanFailures: { i1: { reason: "verify-out-of-scope", attempt: 2 } },
    lastSweepMs: 0,
  }), "utf8");
  const comments = { i1: [] };
  const { deps, posts, labels, cards } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-70" })],
    comments,
    extra: { maxPlanAttempts: 2 },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.scanned, 1);
  assert.equal(res.planned, 0);
  assert.deepEqual(labels.map((x) => x.label), ["OWNER_REQUIRED"]);
  // E3: the gated brief goes first, then the plain-Indonesian escalation
  // comment. Two comments, in that order, because no card of his may go out
  // with nothing behind it.
  assert.equal(contentPosts(posts).length, 1, "one escalation comment for the owner");
  const briefPost = posts.find((p) => String(p.body.body).startsWith("[DECISION BRIEF]"));
  assert.ok(briefPost, "the gated brief is posted");
  const brief = JSON.parse(briefPost.body.body.slice("[DECISION BRIEF]".length)).decision_brief;
  assert.match(brief.pertanyaan, /KOL-70/);
  assert.equal(brief.pilihan.length >= 2, true, "he is given real options, not one button");
  assert.match(brief.kalau_didiamkan, /berhenti di tempat/);
  const capPost = contentPosts(posts)[0];
  assert.match(capPost.body.body, /^DIRECTIVE OWNER REQUIRED/);
  assert.match(capPost.body.body, /setelah 2 percobaan/);
  assert.match(capPost.body.body, /perintah verifikasi di rencana berada di luar bentuk aman/i);
  assert.match(capPost.body.body, /memberi arahan yang lebih spesifik/i);
  assert.match(capPost.body.body, /menutup issue/i);
  assert.doesNotMatch(capPost.body.body, /verify-out-of-scope/);
  assert.equal(cards.length, 0);
});

await t("plan attempt cap escalation is idempotent on the next sweep", async () => {
  await resetTmp();
  await fs.writeFile(TMP_STATE, JSON.stringify({
    attempts: { i1: 2 },
    lastPlanFailures: { i1: { reason: "file-scope-out-of-scope", attempt: 2 } },
    lastSweepMs: 0,
  }), "utf8");
  const comments = { i1: [] };
  const issues = [issue({ id: "i1", identifier: "KOL-70" })];
  const first = makeSweepDeps({ issues, comments, extra: { maxPlanAttempts: 2 } });
  await runDirectiveSweepOnce(first.deps);
  const second = makeSweepDeps({ issues, comments, extra: { maxPlanAttempts: 2 } });
  await runDirectiveSweepOnce(second.deps);
  assert.equal(first.labels.length, 1);
  assert.equal(contentPosts(first.posts).length, 1, "one escalation comment; the brief and the declaration are markers");
  assert.equal(second.labels.length, 0);
  assert.equal(second.posts.length, 0, "and neither is posted twice");
  assert.equal(comments.i1.filter((x) => /^DIRECTIVE OWNER REQUIRED/.test(x.body)).length, 1);
});

await t("re-escalates after an approved retry fails again", async () => {
  const priorEscalationAt = "2026-09-01T09:00:00.000Z";
  const decisionAt = "2026-09-01T09:30:00.000Z";
  const firstEscalation = c(ownerRequiredBody(priorEscalationAt), priorEscalationAt);
  const approval = c(TG_APPROVE, decisionAt);
  const state = {
    attempts: { i1: 2 },
    lastPlanFailures: { i1: { reason: "parse-failed", attempt: 2 } },
    attemptCapDecisionResets: {
      i1: { decision: "approved", at: decisionAt, commentId: approval.id, raw: TG_APPROVE, escalationAt: priorEscalationAt },
    },
    lastSweepMs: 0,
  };
  const comments = { i1: [firstEscalation, approval] };
  const { deps, posts, labels, cards } = makeSweepDeps({
    issues: [issue({
      id: "i1",
      identifier: "KOL-68",
      labels: [{ name: "DIRECTIVE" }, { name: "OWNER_REQUIRED", id: "owner-required-id" }],
      labelIds: ["owner-required-id"],
    })],
    comments,
    stateFile: "memory-state-e1",
    extra: { maxPlanAttempts: 2, _fs: memoryStateFs(state) },
  });
  const res = await runDirectiveSweepOnce(deps);
  const escalationPosts = posts.filter((p) => /\/api\/issues\/i1\/comments$/.test(p.url) && /^DIRECTIVE OWNER REQUIRED/.test(p.body.body));
  assert.equal(res.planned, 0);
  assert.equal(escalationPosts.length, 1);
  assert.equal(labels.length, 1);
  assert.equal(cards.length, 0);
});

await t("does not double-escalate within one owner decision round", async () => {
  const priorEscalationAt = "2026-09-01T09:00:00.000Z";
  const decisionAt = "2026-09-01T09:30:00.000Z";
  const secondEscalationAt = "2026-09-01T09:45:00.000Z";
  const firstEscalation = c(ownerRequiredBody(priorEscalationAt), priorEscalationAt);
  const approval = c(TG_APPROVE, decisionAt);
  const secondEscalation = c(ownerRequiredBody(secondEscalationAt), secondEscalationAt);
  const state = {
    attempts: { i1: 2 },
    lastPlanFailures: { i1: { reason: "parse-failed", attempt: 2 } },
    attemptCapDecisionResets: {
      i1: { decision: "approved", at: decisionAt, commentId: approval.id, raw: TG_APPROVE, escalationAt: priorEscalationAt },
    },
    lastSweepMs: 0,
  };
  const comments = { i1: [firstEscalation, approval, secondEscalation] };
  const { deps, posts, labels, cards } = makeSweepDeps({
    issues: [issue({
      id: "i1",
      identifier: "KOL-68",
      labels: [{ name: "DIRECTIVE" }, { name: "OWNER_REQUIRED", id: "owner-required-id" }],
      labelIds: ["owner-required-id"],
    })],
    comments,
    stateFile: "memory-state-e2",
    extra: { maxPlanAttempts: 2, _fs: memoryStateFs(state) },
  });
  const res = await runDirectiveSweepOnce(deps);
  const escalationPosts = posts.filter((p) => /\/api\/issues\/i1\/comments$/.test(p.url) && /^DIRECTIVE OWNER REQUIRED/.test(p.body.body));
  assert.equal(res.planned, 0);
  assert.equal(escalationPosts.length, 0);
  assert.equal(labels.length, 0);
  assert.equal(cards.length, 0);
});

await t("first attempt-cap escalation path is unchanged", async () => {
  const state = {
    attempts: { i1: 2 },
    lastPlanFailures: { i1: { reason: "verify-out-of-scope", attempt: 2 } },
    attemptCapDecisionResets: {},
    lastSweepMs: 0,
  };
  const comments = { i1: [] };
  const { deps, posts, labels, cards } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-70" })],
    comments,
    stateFile: "memory-state-e3",
    extra: { maxPlanAttempts: 2, _fs: memoryStateFs(state) },
  });
  const res = await runDirectiveSweepOnce(deps);
  const escalationPosts = posts.filter((p) => /\/api\/issues\/i1\/comments$/.test(p.url) && /^DIRECTIVE OWNER REQUIRED/.test(p.body.body));
  assert.equal(res.planned, 0);
  assert.equal(escalationPosts.length, 1);
  assert.equal(labels.length, 1);
  assert.equal(cards.length, 0);
});

await t("label failure still blocks re-escalation comment", async () => {
  const priorEscalationAt = "2026-09-01T09:00:00.000Z";
  const decisionAt = "2026-09-01T09:30:00.000Z";
  const firstEscalation = c(ownerRequiredBody(priorEscalationAt), priorEscalationAt);
  const approval = c(TG_APPROVE, decisionAt);
  const state = {
    attempts: { i1: 2 },
    lastPlanFailures: { i1: { reason: "parse-failed", attempt: 2 } },
    attemptCapDecisionResets: {
      i1: { decision: "approved", at: decisionAt, commentId: approval.id, raw: TG_APPROVE, escalationAt: priorEscalationAt },
    },
    lastSweepMs: 0,
  };
  const comments = { i1: [firstEscalation, approval] };
  const labelCalls = [];
  const { deps, posts, cards } = makeSweepDeps({
    issues: [issue({
      id: "i1",
      identifier: "KOL-68",
      labels: [{ name: "DIRECTIVE" }, { name: "OWNER_REQUIRED", id: "owner-required-id" }],
      labelIds: ["owner-required-id"],
    })],
    comments,
    stateFile: "memory-state-e4",
    extra: {
      maxPlanAttempts: 2,
      _fs: memoryStateFs(state),
      addIssueLabel: async (iss, label) => { labelCalls.push({ issue: iss, label }); return { ok: false, reason: "404" }; },
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  const escalationPosts = posts.filter((p) => /\/api\/issues\/i1\/comments$/.test(p.url) && /^DIRECTIVE OWNER REQUIRED/.test(p.body.body));
  assert.equal(res.planned, 0);
  assert.equal(labelCalls.length, 1);
  assert.equal(escalationPosts.length, 0);
  // E3 posts the brief before attempting the label, so a failed label leaves
  // the brief and nothing else: no escalation comment, no card, no claim that
  // the owner was reached.
  assert.equal(contentPosts(posts).length, 0, "no escalation comment when the label failed");
  assert.ok(posts.some((p) => String(p.body.body).startsWith("[DECISION BRIEF]")), "the brief was posted before the label attempt");
  assert.equal(cards.length, 0);
  assert.ok(res.errors.some((e) => String(e).includes("owner-required label FAILED") && String(e).includes("404")));
});

await t("owner approval after attempt-cap escalation resets attempts and plans using the real default cap", async () => {
  await resetTmp();
  await fs.writeFile(TMP_STATE, JSON.stringify({
    attempts: { i1: DEFAULT_MAX_PLAN_ATTEMPTS },
    lastPlanFailures: { i1: { reason: "verify-out-of-scope", attempt: DEFAULT_MAX_PLAN_ATTEMPTS } },
    lastSweepMs: 0,
  }), "utf8");
  const comments = {
    i1: [
      c(ownerRequiredBody("2026-09-01T09:00:00.000Z"), "2026-09-01T09:00:00.000Z"),
      c(TG_APPROVE, "2026-09-01T09:30:00.000Z"),
    ],
  };
  const { deps, posts, cards, labels } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-68" })],
    comments,
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.scanned, 1);
  assert.equal(res.planned, 1);
  assert.equal(contentPosts(posts).length, 1);
  assert.match(posts[0].body.body, /^DIRECTIVE PLAN \(/);
  assert.equal(cards.length, 1);
  assert.equal(labels.length, 0);
  const st = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
  assert.equal(st.attempts.i1, 0);
  assert.equal(st.attemptCapDecisionResets.i1.decision, "approved");
  assert.equal(st.attemptCapDecisionResets.i1.at, "2026-09-01T09:30:00.000Z");
});

await t("owner rejection after attempt-cap escalation resets attempts", async () => {
  await resetTmp();
  await fs.writeFile(TMP_STATE, JSON.stringify({
    attempts: { i1: 2 },
    lastPlanFailures: { i1: { reason: "parse-failed", attempt: 2 } },
    lastSweepMs: 0,
  }), "utf8");
  const comments = {
    i1: [
      c(ownerRequiredBody("2026-09-01T09:00:00.000Z"), "2026-09-01T09:00:00.000Z"),
      c(TG_REJECT, "2026-09-01T09:30:00.000Z"),
    ],
  };
  const { deps, posts, cards, labels } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-68" })],
    comments,
    extra: { maxPlanAttempts: 2, maxPlansPerSweep: 0 },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.scanned, 1);
  assert.equal(res.planned, 0);
  assert.equal(posts.length, 0);
  assert.equal(cards.length, 0);
  assert.equal(labels.length, 0);
  const st = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
  assert.equal(st.attempts.i1, 0);
  assert.equal(st.attemptCapDecisionResets.i1.decision, "rejected");
});

await t("owner decision older than attempt-cap escalation does not reset attempts", async () => {
  await resetTmp();
  await fs.writeFile(TMP_STATE, JSON.stringify({
    attempts: { i1: 2 },
    lastPlanFailures: { i1: { reason: "parse-failed", attempt: 2 } },
    lastSweepMs: 0,
  }), "utf8");
  const comments = {
    i1: [
      c(TG_APPROVE, "2026-09-01T08:55:00.000Z"),
      c(ownerRequiredBody("2026-09-01T09:00:00.000Z"), "2026-09-01T09:00:00.000Z"),
    ],
  };
  const { deps, posts, cards, labels } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-68" })],
    comments,
    extra: { maxPlanAttempts: 2 },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 0);
  assert.equal(posts.length, 0);
  assert.equal(cards.length, 0);
  assert.equal(labels.length, 0);
  const st = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
  assert.equal(st.attempts.i1, 2);
  assert.equal(st.attemptCapDecisionResets, undefined);
});

await t("the same post-escalation decision is consumed once and does not reset again", async () => {
  await resetTmp();
  await fs.writeFile(TMP_STATE, JSON.stringify({
    attempts: { i1: 1 },
    lastPlanFailures: { i1: { reason: "parse-failed", attempt: 1 } },
    lastSweepMs: 0,
  }), "utf8");
  const comments = {
    i1: [
      c(ownerRequiredBody("2026-09-01T09:00:00.000Z"), "2026-09-01T09:00:00.000Z"),
      c(TG_APPROVE, "2026-09-01T09:30:00.000Z"),
    ],
  };
  let planCalls = 0;
  const extra = {
    maxPlanAttempts: 1,
    dispatchPlan: async () => { planCalls++; return { ok: true, stdout: "not a plan", stderr: "", timedOut: false }; },
  };
  const first = makeSweepDeps({ issues: [issue({ id: "i1", identifier: "KOL-68" })], comments, extra });
  await runDirectiveSweepOnce(first.deps);
  let st = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
  assert.equal(planCalls, 1);
  assert.equal(st.attempts.i1, 1);
  assert.equal(st.attemptCapDecisionResets.i1.decision, "approved");

  const second = makeSweepDeps({ issues: [issue({ id: "i1", identifier: "KOL-68" })], comments, extra });
  await runDirectiveSweepOnce(second.deps);
  st = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
  assert.equal(planCalls, 1);
  assert.equal(st.attempts.i1, 1);
  assert.equal(second.posts.filter((p) => /^DIRECTIVE OWNER REQUIRED/.test(p.body.body)).length, 1);
  assert.equal(second.labels.length, 1);
  assert.equal(comments.i1.filter((x) => /DIRECTIVE DRAFT FAILED/.test(x.body)).length, 1);
  assert.equal(comments.i1.filter((x) => /^DIRECTIVE OWNER REQUIRED/.test(x.body)).length, 2);
});

await t("issue at attempt cap with no owner decision stays skipped without duplicate escalation", async () => {
  await resetTmp();
  await fs.writeFile(TMP_STATE, JSON.stringify({
    attempts: { i1: 2 },
    lastPlanFailures: { i1: { reason: "verify-out-of-scope", attempt: 2 } },
    lastSweepMs: 0,
  }), "utf8");
  const comments = { i1: [c(ownerRequiredBody("2026-09-01T09:00:00.000Z"), "2026-09-01T09:00:00.000Z")] };
  const { deps, posts, cards, labels } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-68" })],
    comments,
    extra: { maxPlanAttempts: 2 },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 0);
  assert.equal(posts.length, 0);
  assert.equal(cards.length, 0);
  assert.equal(labels.length, 0);
  const st = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
  assert.equal(st.attempts.i1, 2);
  assert.equal(st.attemptCapDecisionResets, undefined);
});

await t("attempt cap escalation still fires after the plan budget is spent", async () => {
  await resetTmp();
  await fs.writeFile(TMP_STATE, JSON.stringify({
    attempts: { i2: 2 },
    lastPlanFailures: { i2: { reason: "verify-out-of-scope", attempt: 2 } },
    lastSweepMs: 0,
  }), "utf8");
  const issues = [
    issue({ id: "i1", identifier: "KOL-71" }),
    issue({ id: "i2", identifier: "KOL-72" }),
  ];
  const comments = { i1: [], i2: [] };
  let planCalls = 0;
  const { deps, posts, labels, cards } = makeSweepDeps({
    issues,
    comments,
    extra: {
      maxPlansPerSweep: 1,
      maxPlanAttempts: 2,
      dispatchPlan: async () => { planCalls++; return { ok: true, stdout: goodPlan, stderr: "", timedOut: false }; },
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 1);
  assert.equal(planCalls, 1);
  assert.equal(posts.filter((p) => /^DIRECTIVE PLAN \(/.test(p.body.body)).length, 1);
  assert.deepEqual(labels.map((x) => `${x.issue.identifier}:${x.label}`), ["KOL-72:OWNER_REQUIRED"]);
  assert.equal(comments.i2.filter((x) => /^DIRECTIVE OWNER REQUIRED/.test(x.body)).length, 1);
  assert.equal(cards.length, 1);
});

await t("below-cap directive after spent plan budget is still not planned", async () => {
  await resetTmp();
  await fs.writeFile(TMP_STATE, JSON.stringify({
    attempts: { i2: 1 },
    lastPlanFailures: { i2: { reason: "parse-failed", attempt: 1 } },
    lastSweepMs: 0,
  }), "utf8");
  const issues = [
    issue({ id: "i1", identifier: "KOL-73" }),
    issue({ id: "i2", identifier: "KOL-74" }),
  ];
  const comments = { i1: [], i2: [] };
  let planCalls = 0;
  const { deps, posts, labels, cards } = makeSweepDeps({
    issues,
    comments,
    extra: {
      maxPlansPerSweep: 1,
      maxPlanAttempts: 2,
      dispatchPlan: async () => { planCalls++; return { ok: true, stdout: goodPlan, stderr: "", timedOut: false }; },
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 1);
  assert.equal(planCalls, 1);
  assert.equal(posts.filter((p) => /^DIRECTIVE PLAN \(/.test(p.body.body)).length, 1);
  assert.equal(comments.i2.length, 0);
  assert.equal(labels.length, 0);
  assert.equal(cards.length, 1);
});

await t("two directives at the attempt cap both escalate in one sweep", async () => {
  await resetTmp();
  await fs.writeFile(TMP_STATE, JSON.stringify({
    attempts: { i1: 2, i2: 2 },
    lastPlanFailures: {
      i1: { reason: "parse-failed", attempt: 2 },
      i2: { reason: "file-scope-out-of-scope", attempt: 2 },
    },
    lastSweepMs: 0,
  }), "utf8");
  const issues = [
    issue({ id: "i1", identifier: "KOL-75" }),
    issue({ id: "i2", identifier: "KOL-76" }),
  ];
  const comments = { i1: [], i2: [] };
  let planCalls = 0;
  const { deps, posts, labels, cards } = makeSweepDeps({
    issues,
    comments,
    extra: {
      maxPlansPerSweep: 1,
      maxPlanAttempts: 2,
      dispatchPlan: async () => { planCalls++; return { ok: true, stdout: goodPlan, stderr: "", timedOut: false }; },
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 0);
  assert.equal(planCalls, 0);
  assert.deepEqual(labels.map((x) => `${x.issue.identifier}:${x.label}`), ["KOL-75:OWNER_REQUIRED", "KOL-76:OWNER_REQUIRED"]);
  assert.equal(posts.filter((p) => /^DIRECTIVE OWNER REQUIRED/.test(p.body.body)).length, 2);
  assert.equal(cards.length, 0);
});

await t("plan attempt cap translates parse, file-scope, and verify reasons", async () => {
  const cases = [
    ["parse-failed", /format directive yang valid/i, /parse-failed/],
    ["file-scope-out-of-scope", /daftar file rencana keluar dari batas aman repo/i, /file-scope-out-of-scope/],
    ["verify-out-of-scope", /perintah verifikasi di rencana berada di luar bentuk aman/i, /verify-out-of-scope/],
  ];
  for (const [reason, plain, raw] of cases) {
    await resetTmp();
    await fs.writeFile(TMP_STATE, JSON.stringify({
      attempts: { i1: 2 },
      lastPlanFailures: { i1: { reason, attempt: 2 } },
      lastSweepMs: 0,
    }), "utf8");
    const comments = { i1: [] };
    const { deps, posts } = makeSweepDeps({ issues: [issue({ id: "i1" })], comments, extra: { maxPlanAttempts: 2 } });
    await runDirectiveSweepOnce(deps);
    const escalation = contentPosts(posts)[0];
    assert.match(escalation.body.body, plain);
    assert.doesNotMatch(escalation.body.body, raw);
  }
});

await t("MAX_PLANS_PER_SWEEP is honoured with three eligible directives", async () => {
  await resetTmp();
  const issues = [issue({ id: "i1" }), issue({ id: "i2", identifier: "KOL-2" }), issue({ id: "i3", identifier: "KOL-3" })];
  const comments = { i1: [], i2: [], i3: [] };
  const { deps, posts } = makeSweepDeps({ issues, comments, extra: { maxPlansPerSweep: 2 } });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 2);
  assert.equal(posts.filter((p) => /^DIRECTIVE PLAN \(/.test(p.body.body)).length, 2);
});

await t("directive already awaiting approval is skipped without duplicate plan", async () => {
  await resetTmp();
  const comments = { i1: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`)] };
  const { deps, posts } = makeSweepDeps({ issues: [issue({ id: "i1" })], comments });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 0);
  assert.equal(posts.length, 0);
});

await t("every branch keeps injected git/pm2/telegram/execute spies untouched", async () => {
  await resetTmp();
  let called = 0;
  const spies = {
    execute: () => { called++; },
    telegram: () => { called++; },
    git: () => { called++; },
    pm2: () => { called++; },
  };
  const comments = {
    n: [],
    bad: [],
    old: [c(`${DISPATCH_MARKER}: waking`, new Date(NOW - DEFAULT_STALLED_AFTER_MS - 1000).toISOString())],
    wait: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`)],
  };
  const issues = [
    issue({ id: "n", identifier: "KOL-N" }),
    issue({ id: "bad", identifier: "KOL-B" }),
    issue({ id: "old", identifier: "KOL-OLD" }),
    issue({ id: "wait", identifier: "KOL-WAIT" }),
  ];
  const { deps, getExecuteCalls } = makeSweepDeps({ issues, comments, plan: "not a plan", extra: { maxPlansPerSweep: 2, spies } });
  const res = await runDirectiveSweepOnce(deps);
  // Stage 2: a todo+stalled directive ("old") is now plannable, not report-only;
  // with the cap it is skipped, so the report-only stalled bucket is empty.
  assert.equal(res.stalled.length, 0);
  assert.equal(called, 0);
  assert.equal(getExecuteCalls(), 0);
});

// ---- Stage 2 additions ----------------------------------------------------

await t("isPlannable: KOL-69 (todo+stalled) -> true, KOL-33 (in_progress+stalled) -> false, awaiting-approval -> false", () => {
  const kol69 = { status: "todo" };
  const kol33 = { status: "in_progress" };
  assert.equal(isPlannable(kol69, "stalled"), true);
  assert.equal(isPlannable(kol33, "stalled"), false);
  assert.equal(isPlannable(kol69, "awaiting-approval"), false);
  // backlog is also eligible for a stalled re-plan
  assert.equal(isPlannable({ status: "backlog" }, "stalled"), true);
  // new + todo is plannable (stage 1 behaviour preserved)
  assert.equal(isPlannable(kol69, "new"), true);
});

await t("a stalled+todo directive gets exactly one plan comment mentioning the previous failed attempt", async () => {
  await resetTmp();
  const sixHoursAgo = new Date(NOW - DEFAULT_STALLED_AFTER_MS - 1000).toISOString();
  const issues = [issue({ id: "kol69", identifier: "KOL-69", title: "/pause" })];
  const comments = { kol69: [c(`${DISPATCH_MARKER} (ops-watcher/ahmad-dispatch): waking headless AHMAD for KOL-69.`, sixHoursAgo)] };
  const { deps, posts, cards } = makeSweepDeps({ issues, comments });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 1);
  assert.equal(res.stalled.length, 0); // plannable stalled is NOT report-only
  const planPosts = posts.filter((p) => /^DIRECTIVE PLAN \(/.test(p.body.body));
  assert.equal(planPosts.length, 1);
  // The comment must mention the previous failed dispatch attempt.
  assert.match(planPosts[0].body.body, /sebelumnya/i);
  assert.match(planPosts[0].body.body, /dispatch/i);
  // One decision card is sent for the re-planned directive.
  assert.equal(cards.length, 1);
});

await t("a stalled+in_progress directive gets NO plan comment and appears only in stalled", async () => {
  await resetTmp();
  const sixHoursAgo = new Date(NOW - DEFAULT_STALLED_AFTER_MS - 1000).toISOString();
  const issues = [issue({ id: "kol33", identifier: "KOL-33", status: "in_progress", title: "in-flight directive" })];
  const comments = { kol33: [c(`${DISPATCH_MARKER}: waking`, sixHoursAgo)] };
  const { deps, posts, cards, getExecuteCalls } = makeSweepDeps({ issues, comments });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 0);
  assert.equal(posts.length, 0);
  assert.equal(cards.length, 0);
  assert.equal(res.stalled.length, 1);
  assert.equal(res.stalled[0].identifier, "KOL-33");
  assert.equal(getExecuteCalls(), 0);
});

await t("after a plan is posted, exactly one decision card is sent carrying the issue identifier and RISK level", async () => {
  await resetTmp();
  const issues = [issue({ id: "i1", identifier: "KOL-77", title: "Tune thing" })];
  const comments = { i1: [] };
  const highRiskPlan = goodPlan.replace("RISK: low", "RISK: high");
  const { deps, cards } = makeSweepDeps({ issues, comments, plan: highRiskPlan });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 1);
  assert.equal(cards.length, 1);
  const cardText = cards[0].plan ? buildDecisionCardText(cards[0].issue, cards[0].plan) : "";
  // The stub receives { issue, plan, telegramBase }. The card text the real
  // sender would build must carry the identifier and the RISK level.
  assert.match(cardText, /KOL-77/);
  assert.match(cardText, /Risiko: high/);
});

await t("sendDecisionCard rejecting -> plan comment still posted, result records card-failed, no throw", async () => {
  await resetTmp();
  const issues = [issue({ id: "i1", identifier: "KOL-88" })];
  const comments = { i1: [] };
  const { deps, posts } = makeSweepDeps({
    issues, comments,
    extra: { sendDecisionCard: async () => ({ sent: false, reason: "stub rejection" }) },
  });
  const res = await runDirectiveSweepOnce(deps);
  // Plan comment still stands.
  assert.equal(res.planned, 1);
  assert.equal(posts.filter((p) => /^DIRECTIVE PLAN \(/.test(p.body.body)).length, 1);
  // card-failed is recorded for that directive.
  assert.ok(res.errors.some((e) => typeof e === "string" && e.includes("KOL-88") && e.includes("card-failed")));
});

await t("findPlanDecision returns approved for listener approval wording, rejected for rejection wording, null for unrelated, and ignores a decision that predates the plan", () => {
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const before = "2026-08-31T08:00:00.000Z";
  // approval wording after the plan -> approved
  const ap = findPlanDecision([c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)], planAt);
  assert.equal(ap.decision, "approved");
  assert.equal(ap.at, after);
  // rejection wording after the plan -> rejected
  const rj = findPlanDecision([c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_REJECT, after)], planAt);
  assert.equal(rj.decision, "rejected");
  assert.equal(rj.at, after);
  // only unrelated comments -> null
  const none = findPlanDecision([c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c("terima kasih atas laporannya", after)], planAt);
  assert.equal(none.decision, null);
  assert.equal(none.at, null);
  assert.equal(none.raw, null);
  // a decision comment that PREDATES the plan is ignored -> null
  const predates = findPlanDecision([c(TG_APPROVE, before), c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c("terima kasih", after)], planAt);
  assert.equal(predates.decision, null);
});

// ---- Stage 3b sweep execution ---------------------------------------------

await t("sweep execution: done posts one DIRECTIVE RESULT, patches done, labels DONE_VERIFIED, and sends no Telegram", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const issues = [issue({ id: "kol70", identifier: "KOL-70", title: "approved directive" })];
  const comments = { kol70: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)] };
  let executeCalls = 0;
  const { deps, posts, cards, messages, patches, labels } = makeSweepDeps({
    issues,
    comments,
    extra: {
      executeDirective: async () => {
        executeCalls++;
        return { outcome: "done", filesChanged: ["ops-watcher/foo.mjs", "docs/bar.md"], verifyTail: "ok\nall good" };
      },
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.approved.length, 1);
  assert.equal(res.executed, 1);
  assert.equal(executeCalls, 1);
  assert.equal(posts.filter((p) => /^DIRECTIVE RESULT/.test(p.body.body)).length, 1);
  assert.match(posts[0].body.body, /ops-watcher\/foo\.mjs/);
  assert.match(posts[0].body.body, /docs\/bar\.md/);
  assert.match(posts[0].body.body, /Perintah verifikasi: node ops-watcher\/foo\.mjs --check/);
  assert.match(posts[0].body.body, /all good/);
  assert.match(posts[0].body.body, /Yang sengaja tidak dikerjakan:/);
  assert.deepEqual(patches.map((p) => p.patch), [{ status: "done" }]);
  assert.deepEqual(labels.map((l) => l.label), ["DONE_VERIFIED"]);
  assert.equal(messages.length, 0);
  assert.equal(cards.length, 0);
});

// =====================================================================
// G1-G4 WIRED IN. venture-gate.regression.test.mjs proves the decisions; these
// prove the sweep and the executor ACT on them. Testing the gate alone would
// stay green if the call site stopped consulting it — the exact miss that left
// a mutation green earlier tonight.
// =====================================================================

async function sweepWithApprovedDirective(extra, stateSeed = null) {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const issues = [issue({ id: "kolg", identifier: "KOL-G1", title: "approved directive" })];
  const comments = { kolg: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)] };
  let executeCalls = 0;
  const made = makeSweepDeps({
    issues,
    comments,
    extra: {
      executeDirective: async () => {
        executeCalls++;
        return { outcome: "done", filesChanged: ["ops-watcher/foo.mjs"], verifyTail: "ok" };
      },
      ...extra,
    },
  });
  const res = await runDirectiveSweepOnce(made.deps);
  return { ...made, res, executeCalls: () => executeCalls };
}

await t("G1 wired: at the nightly ceiling the sweep DECLINES and executes nothing", async () => {
  const run = await sweepWithApprovedDirective({
    nightlyCeilingCheck: () => ({ allowed: false, day: "2026-09-05", executed: 6, ceiling: 6, reason: "nightly ceiling reached: 6/6 executions on 2026-09-05 — remaining approved directives WAIT for the next day, nothing is dropped" }),
  });
  assert.equal(run.executeCalls(), 0, "no lane is dispatched at the ceiling");
  assert.equal(run.res.executed, 0);
  assert.ok(run.res.executionDeclined, "the sweep records that it declined");
  assert.equal(run.res.executionDeclined.kind, "nightly-ceiling");
  assert.equal(run.res.executionDeclined.waiting, 1, "the approved directive is WAITING, not dropped");
  // Still approved: nothing was refused, commented on, or closed.
  assert.equal(run.res.approved.length, 1);
  assert.equal(run.posts.filter((p) => /^DIRECTIVE RESULT/.test(p.body.body)).length, 0);
});

await t("G1 wired: below the ceiling the sweep executes and COUNTS the execution", async () => {
  let recorded = 0;
  const run = await sweepWithApprovedDirective({
    nightlyCeilingCheck: () => ({ allowed: true, day: "d", executed: 0, ceiling: 6, reason: "0/6" }),
    recordNightlyExecution: () => { recorded += 1; },
  });
  assert.equal(run.executeCalls(), 1);
  assert.equal(run.res.executed, 1);
  assert.equal(recorded, 1, "an execution that ran must be counted, or the ceiling never binds");
  assert.equal(run.res.executionDeclined, undefined);
});

await t("G2 wired: a halt in effect declines execution before the ceiling is even consulted", async () => {
  let ceilingConsulted = 0;
  const run = await sweepWithApprovedDirective({
    ventureHaltCheck: () => ({ halted: true, day: "2026-09-05", consecutiveFailures: 2, reason: "venture execution HALTED for 2026-09-05 after 2 consecutive failures (last: KOL-2 aborted) — waiting for the owner" }),
    nightlyCeilingCheck: () => { ceilingConsulted += 1; return { allowed: true, day: "d", executed: 0, ceiling: 6, reason: "0/6" }; },
  });
  assert.equal(run.executeCalls(), 0, "a halted night dispatches nothing");
  assert.equal(run.res.executionDeclined.kind, "halt");
  assert.match(run.res.executionDeclined.reason, /HALTED/);
  assert.equal(run.res.executionDeclined.waiting, 1);
  assert.equal(ceilingConsulted, 1, "the ceiling is still evaluated, but the halt is what decides");
});

await t("G2 wired: the halt is TOLD to the owner, not left as a log line", async () => {
  // A system that stopped and a system that went quiet look identical from the
  // outside. This is the difference.
  const run = await sweepWithApprovedDirective({
    executeDirective: async () => ({ outcome: "reverted", reason: "verify-red" }),
    recordVentureOutcome: () => ({ halted: true, justHalted: true, consecutiveFailures: 2, reason: "two in a row" }),
  });
  assert.ok(run.res.ventureHalt, "the sweep reports the halt in its summary");
  assert.equal(run.res.ventureHalt.consecutiveFailures, 2);
  assert.equal(run.res.ventureHalt.identifier, "KOL-G1");
  const halted = run.messages.filter((m) => /DIHENTIKAN sampai pagi/.test(String(m.text || m)));
  assert.equal(halted.length, 1, `exactly one halt message reaches the owner, got ${run.messages.length} messages`);
  assert.match(String(halted[0].text || halted[0]), /2 kegagalan berturut-turut/);
});

await t("G2 wired: a successful execution records the outcome so the streak can reset", async () => {
  const seen = [];
  const run = await sweepWithApprovedDirective({
    recordVentureOutcome: (state, outcome) => { seen.push(outcome); return { halted: false, justHalted: false }; },
  });
  assert.equal(run.executeCalls(), 1);
  assert.deepEqual(seen, ["done"], "the outcome reaches the streak recorder");
});

await t("G3 wired: an uncommitted venture file is refused by the sweep's scope gate", async () => {
  await resetTmp();
  const venturePlan = goodPlan.replace("ops-watcher/foo.mjs, docs/bar.md", "ventures/caveman-trading-os/src/a.py");
  const { deps, posts } = makeSweepDeps({
    issues: [issue({ id: "kolg3", identifier: "KOL-G3" })],
    comments: { kolg3: [] },
    plan: venturePlan,
    extra: {
      activeVentures: async () => [{ id: "caveman-trading-os", status: "active", repoPath: "ventures/caveman-trading-os" }],
      ventureForPath: async (p) => (String(p).startsWith("ventures/caveman-trading-os") ? { id: "caveman-trading-os", status: "active", repoPath: "ventures/caveman-trading-os" } : null),
      // The venture's uncommitted set, as git would report it.
      ventureUncommittedPaths: () => ["ventures/caveman-trading-os/src/a.py"],
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.refused, 1, "an active venture path that is uncommitted is still refused");
  const refusal = posts.map((p) => p.body.body).join("\n");
  assert.match(refusal, /uncommitted in caveman-trading-os/);
  assert.match(refusal, /KOL-66/, "the refusal says whose decision it is");
});

await t("G4 wired: a commit to the venture during execution ABORTS and reverts", async () => {
  // The plan said nothing about git. This is the fence that does not depend on
  // the plan admitting what it intends to do.
  const plan = parsePlan(goodPlan.replace("ops-watcher/foo.mjs, docs/bar.md", "ventures/caveman-trading-os/src/a.py"));
  const made = makeExecDeps({ mutateOnDispatch: true });
  made.deps.activeVentures = async () => [{ id: "caveman-trading-os", status: "active", repoPath: "ventures/caveman-trading-os" }];
  made.deps.ventureForPath = async () => ({ id: "caveman-trading-os", status: "active", repoPath: "ventures/caveman-trading-os" });
  made.deps.ventureUncommittedPaths = () => [];
  let call = 0;
  made.deps.ventureGitPosition = () => {
    call += 1;
    // First read is the "before"; the second, after dispatch, shows a commit.
    return { id: "caveman-trading-os", head: call === 1 ? "aaaaaaa" : "bbbbbbb", branch: "main", remoteRefs: "r 1", status: "" };
  };

  const res = await executeApprovedDirective(issue(), plan, made.deps);
  assert.equal(res.outcome, "aborted", `a venture commit must abort, got ${res.outcome}`);
  assert.equal(res.reason, "venture-git-write");
  assert.match(res.violations.join(" "), /HEAD moved aaaaaaa -> bbbbbbb/);
  assert.equal(made.calls.restore, 1, "and the snapshot is restored");
  assert.ok(call >= 2, "the position is read before AND after execution");
});

await t("G4 wired: a plan that ASKS for a git write is refused by the scope gate", async () => {
  // The pre-flight half. Cheap, and it stops the obvious case before a lane is
  // ever dispatched — but it is not the fence that holds, because it depends on
  // the plan saying what it intends to do. That is why the position comparison
  // above exists as well.
  const plan = parsePlan(goodPlan.replace(
    "- Terapkan perubahan lalu verifikasi secara lokal.",
    "- Jalankan git push origin main setelah selesai.",
  ));
  assert.match(plan.steps.join(" "), /git push/, "the fixture really does contain the step");
  const made = makeExecDeps({ mutateOnDispatch: true });
  const res = await executeApprovedDirective(issue(), plan, made.deps);
  assert.equal(res.outcome, "refused", `a plan asking for a git write must be refused, got ${res.outcome}`);
  assert.match(res.violations.join(" "), /plan asks for a git write/);
  assert.equal(made.calls.dispatch, 0, "and no lane sees it");

  // Reading git is not writing to it.
  const readOnly = parsePlan(goodPlan.replace("- Terapkan perubahan lalu verifikasi secara lokal.", "- Baca git status untuk konteks."));
  const clean = makeExecDeps({ mutateOnDispatch: true });
  const okRes = await executeApprovedDirective(issue(), readOnly, clean.deps);
  assert.notEqual(okRes.outcome, "refused", `git status is not a write, got ${okRes.outcome} ${JSON.stringify(okRes.violations || "")}`);
});

await t("G4 wired: an unchanged venture executes normally", async () => {
  const plan = parsePlan(goodPlan.replace("ops-watcher/foo.mjs, docs/bar.md", "ventures/caveman-trading-os/src/a.py"));
  const made = makeExecDeps({ mutateOnDispatch: true });
  made.deps.activeVentures = async () => [{ id: "caveman-trading-os", status: "active", repoPath: "ventures/caveman-trading-os" }];
  made.deps.ventureForPath = async () => ({ id: "caveman-trading-os", status: "active", repoPath: "ventures/caveman-trading-os" });
  made.deps.ventureUncommittedPaths = () => [];
  const frozen = { id: "caveman-trading-os", head: "aaaaaaa", branch: "main", remoteRefs: "r 1", status: "" };
  made.deps.ventureGitPosition = () => ({ ...frozen });

  const res = await executeApprovedDirective(issue(), plan, made.deps);
  assert.equal(res.outcome, "done", `an untouched venture repository must not block execution, got ${res.outcome} ${res.reason || ""}`);
});

await t("G4 wired: an unreadable venture git position refuses BEFORE dispatch", async () => {
  const plan = parsePlan(goodPlan.replace("ops-watcher/foo.mjs, docs/bar.md", "ventures/caveman-trading-os/src/a.py"));
  const made = makeExecDeps({ mutateOnDispatch: true });
  made.deps.activeVentures = async () => [{ id: "caveman-trading-os", status: "active", repoPath: "ventures/caveman-trading-os" }];
  made.deps.ventureForPath = async () => ({ id: "caveman-trading-os", status: "active", repoPath: "ventures/caveman-trading-os" });
  made.deps.ventureUncommittedPaths = () => [];
  made.deps.ventureGitPosition = () => null;

  const res = await executeApprovedDirective(issue(), plan, made.deps);
  assert.equal(res.outcome, "refused");
  assert.match(res.violations.join(" "), /cannot read the venture's git position/);
  assert.equal(made.calls.dispatch, 0, "nothing is dispatched when the fence cannot be proven");
});

await t("sweep execution: reverted posts failure comment, leaves status alone, and sends exactly one Telegram", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const issues = [issue({ id: "kol71", identifier: "KOL-71" })];
  const comments = { kol71: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)] };
  const { deps, posts, messages, patches, labels } = makeSweepDeps({
    issues,
    comments,
    extra: { executeDirective: async () => ({ outcome: "reverted", reason: "verify-red" }) },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.reverted, 1);
  assert.equal(contentPosts(posts).length, 1);
  assert.match(posts[0].body.body, /^DIRECTIVE GAGAL/);
  assert.match(posts[0].body.body, /verify-red/);
  assert.equal(patches.length, 0);
  assert.equal(labels.length, 0);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /tidak dapat diselesaikan/);
  assert.match(messages[0], /verify-red/);
});

await t("sweep execution: no-op says nothing changed, leaves status alone, and sends no Telegram", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const issues = [issue({ id: "kol72", identifier: "KOL-72" })];
  const comments = { kol72: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)] };
  const { deps, posts, messages, patches } = makeSweepDeps({
    issues,
    comments,
    extra: { executeDirective: async () => ({ outcome: "no-op", reason: "file target sudah sama" }) },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.noop, 1);
  assert.equal(contentPosts(posts).length, 1);
  assert.match(posts[0].body.body, /^DIRECTIVE NO-OP/);
  assert.match(posts[0].body.body, /tidak ada perubahan/i);
  assert.equal(patches.length, 0);
  assert.equal(messages.length, 0);
});

await t("sweep execution: skipped creates no comment, Telegram, or status patch", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const issues = [issue({ id: "kol73", identifier: "KOL-73" })];
  const comments = { kol73: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)] };
  let executeCalls = 0;
  const { deps, posts, messages, patches, labels } = makeSweepDeps({
    issues,
    comments,
    extra: { executeDirective: async () => { executeCalls++; return { outcome: "skipped", reason: "lane cooldown" }; } },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.executed, 0);
  assert.equal(res.reverted, 0);
  assert.equal(res.noop, 0);
  assert.equal(res.refused, 0);
  assert.equal(executeCalls, 1);
  assert.equal(posts.length, 0);
  assert.equal(messages.length, 0);
  assert.equal(patches.length, 0);
  assert.equal(labels.length, 0);
});

await t("sweep execution: two approved directives execute only MAX_EXECUTIONS_PER_SWEEP", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const issues = [issue({ id: "kol74", identifier: "KOL-74" }), issue({ id: "kol75", identifier: "KOL-75" })];
  const approvedComments = [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)];
  const comments = { kol74: approvedComments, kol75: approvedComments };
  let executeCalls = 0;
  const { deps } = makeSweepDeps({
    issues,
    comments,
    extra: { executeDirective: async () => { executeCalls++; return { outcome: "skipped", reason: "cap test" }; } },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.approved.length, 2);
  assert.equal(executeCalls, MAX_EXECUTIONS_PER_SWEEP);
});
await t("sweep execution cap: two failures cap the third sweep and request OWNER_REQUIRED once", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const state = { attempts: {}, lastPlanFailures: {}, pendingCards: {}, lastSweepMs: 0 };
  const stateFs = memoryStateFs(state);
  const issues = [issue({ id: "kol76", identifier: "KOL-76" })];
  const comments = { kol76: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)] };
  const outcomes = [
    { outcome: "reverted", reason: "verify-red-one" },
    { outcome: "reverted", reason: "verify-red-two" },
    { outcome: "reverted", reason: "should-not-run" },
  ];
  let executeCalls = 0;
  const { deps, posts, labels } = makeSweepDeps({
    issues,
    comments,
    stateFile: "memory-state-execution-cap-1",
    extra: {
      _fs: stateFs,
      executeDirective: async () => {
        executeCalls += 1;
        return outcomes.shift();
      },
    },
  });

  await runDirectiveSweepOnce(deps);
  await runDirectiveSweepOnce(deps);
  await runDirectiveSweepOnce(deps);

  const ownerRequiredPosts = posts.filter((p) => p.body.body.startsWith(EXECUTION_CAP_MARKER));
  assert.equal(executeCalls, 2);
  assert.equal(ownerRequiredPosts.length, 1);
  assert.match(ownerRequiredPosts[0].body.body, new RegExp(`^${EXECUTION_CAP_MARKER}`));
  assert.match(ownerRequiredPosts[0].body.body, /verify-red-two/);
  assert.deepEqual(labels.map((x) => `${x.issue.identifier}:${x.label}`), ["KOL-76:OWNER_REQUIRED"]);
});

await t("sweep execution cap: fourth capped sweep posts no duplicate owner request or label", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const state = { attempts: {}, lastPlanFailures: {}, pendingCards: {}, lastSweepMs: 0 };
  const stateFs = memoryStateFs(state);
  const issues = [issue({ id: "kol77", identifier: "KOL-77" })];
  const comments = { kol77: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)] };
  let executeCalls = 0;
  const { deps, posts, labels } = makeSweepDeps({
    issues,
    comments,
    stateFile: "memory-state-execution-cap-2",
    extra: {
      _fs: stateFs,
      executeDirective: async () => {
        executeCalls += 1;
        return { outcome: "reverted", reason: `verify-red-${executeCalls}` };
      },
    },
  });

  await runDirectiveSweepOnce(deps);
  await runDirectiveSweepOnce(deps);
  await runDirectiveSweepOnce(deps);
  const commentsAfterThird = posts.filter((p) => p.body.body.startsWith(EXECUTION_CAP_MARKER)).length;
  const labelsAfterThird = labels.length;
  await runDirectiveSweepOnce(deps);

  assert.equal(executeCalls, 2);
  assert.equal(posts.filter((p) => p.body.body.startsWith(EXECUTION_CAP_MARKER)).length, commentsAfterThird);
  assert.equal(commentsAfterThird, 1);
  assert.equal(labels.length, labelsAfterThird);
  assert.deepEqual(labels.map((x) => `${x.issue.identifier}:${x.label}`), ["KOL-77:OWNER_REQUIRED"]);
});

await t("sweep execution cap: replacing plan content after cap allows execution again", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const state = { attempts: {}, lastPlanFailures: {}, pendingCards: {}, lastSweepMs: 0 };
  const stateFs = memoryStateFs(state);
  const issues = [issue({ id: "kol78", identifier: "KOL-78" })];
  const comments = { kol78: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)] };
  let executeCalls = 0;
  const { deps, posts } = makeSweepDeps({
    issues,
    comments,
    stateFile: "memory-state-execution-cap-3",
    extra: {
      _fs: stateFs,
      executeDirective: async () => {
        executeCalls += 1;
        return { outcome: "reverted", reason: `verify-red-${executeCalls}` };
      },
    },
  });

  await runDirectiveSweepOnce(deps);
  await runDirectiveSweepOnce(deps);
  await runDirectiveSweepOnce(deps);
  assert.equal(executeCalls, 2);
  assert.equal(posts.filter((p) => p.body.body.startsWith(EXECUTION_CAP_MARKER)).length, 1);

  const replacementPlan = goodPlan.replace(
    "Menyiapkan perubahan kecil yang diminta owner.",
    "Menjalankan rencana pengganti setelah cap eksekusi.",
  );
  comments.kol78.find((x) => x.body.startsWith(`${PLAN_MARKER} `)).body = `${PLAN_MARKER} (iso):\n${replacementPlan}`;
  await runDirectiveSweepOnce(deps);

  assert.equal(executeCalls, 3);
  assert.equal(posts.filter((p) => p.body.body.startsWith(EXECUTION_CAP_MARKER)).length, 1);
});

await t("sweep execution cap: done then one failure still executes on the following sweep", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const state = { attempts: {}, lastPlanFailures: {}, pendingCards: {}, lastSweepMs: 0 };
  const stateFs = memoryStateFs(state);
  const issues = [issue({ id: "kol79", identifier: "KOL-79" })];
  const comments = { kol79: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)] };
  const outcomes = [
    { outcome: "done", filesChanged: ["ops-watcher/foo.mjs"], verifyTail: "ok" },
    { outcome: "reverted", reason: "verify-red-after-green" },
    { outcome: "reverted", reason: "verify-red-still-under-cap" },
  ];
  let executeCalls = 0;
  const { deps, posts, labels } = makeSweepDeps({
    issues,
    comments,
    stateFile: "memory-state-execution-cap-4",
    extra: {
      _fs: stateFs,
      executeDirective: async () => {
        executeCalls += 1;
        return outcomes.shift();
      },
    },
  });

  await runDirectiveSweepOnce(deps);
  comments.kol79 = comments.kol79.filter((x) => !/^DIRECTIVE RESULT/.test(x.body));
  await runDirectiveSweepOnce(deps);
  await runDirectiveSweepOnce(deps);

  assert.equal(executeCalls, 3);
  assert.equal(posts.filter((p) => /^DIRECTIVE OWNER REQUIRED/.test(p.body.body)).length, 0);
  assert.equal(labels.filter((x) => x.label === "OWNER_REQUIRED").length, 0);
});
// ===========================================================================
// Stage 3a — buildExecutionPrompt + executeApprovedDirective
// ===========================================================================

// Builds a fully-injected deps bundle for executeApprovedDirective. Every
// outbound seam is a spy. `mutated` flips on dispatch so the before/after stat
// comparison can tell a real change from a no-op. Overrides select branches.
function makeExecDeps(overrides = {}) {
  const calls = {
    snapshot: 0, restore: 0, dispatch: 0, runVerify: 0, runFullSuite: 0,
    stat: 0, appendEvidence: 0, guardLane: 0, recordOutcome: 0, logLaneOutcome: 0, git: 0, pm2: 0,
  };
  const laneOutcomes = [];
  const dispatchOptions = [];
  let mutated = false;
  const statFile = async (file) => {
    calls.stat++;
    return { size: 100, mtimeMs: mutated ? 2000 : 1000 };
  };
  const deps = {
    lane: "corleone",
    now: NOW,
    // The ventures fence is CLOSED by default in these fixtures, so every
    // execution test states its own boundary instead of inheriting whatever
    // config/ventures.json happens to say today. A test that reads the live
    // registry changes its own meaning the next time the owner edits it.
    activeVentures: async () => [],
    // And no test shells out to a real git. Without these two, a fixture naming
    // a venture that has no directory made the gate run `git -C <missing dir>`
    // and print "fatal: cannot change to ..." mid-suite. A test that touches
    // the real filesystem to answer a question about a fake registry is a test
    // whose result depends on the machine it runs on.
    ventureUncommittedPaths: () => [],
    ventureGitPosition: (v) => ({ id: v?.id || "v", head: "aaaaaaa", branch: "main", remoteRefs: "refs/remotes/origin/main aaaaaaa", status: "" }),
    statFile,
    snapshotFiles: async (files /*, opts */) => {
      calls.snapshot++;
      return {
        ok: true,
        dir: "/tmp/snap",
        entries: (files || []).map((f) => ({ file: f, backup: "/tmp/snap/" + String(f).split("/").pop(), bytes: 100 })),
      };
    },
    restoreFiles: async (snap /*, opts */) => {
      calls.restore++;
      return { ok: true, restored: (snap && snap.entries ? snap.entries.length : 0) };
    },
    dispatchExecution: async (_prompt, opts = {}) => {
      calls.dispatch++;
      dispatchOptions.push(opts);
      if (overrides.mutateOnDispatch !== false) mutated = true;
      return { ok: true, stdout: "implementation done", stderr: "" };
    },
    runVerify: async (/* cmd */) => {
      calls.runVerify++;
      return overrides.verifyResult !== undefined ? overrides.verifyResult : { ok: true, stdout: "ok\nall good", stderr: "" };
    },
    runFullSuite: async () => {
      calls.runFullSuite++;
      return overrides.fullResult !== undefined ? overrides.fullResult : { ok: true, stdout: "all green", stderr: "" };
    },
    guardLane: async (laneName /*, d */) => {
      calls.guardLane++;
      return overrides.guardResult !== undefined ? overrides.guardResult : { skip: false, reason: null, laneKey: laneName };
    },
    recordOutcome: async (/* laneName, result, d */) => {
      calls.recordOutcome++;
      return { recorded: true };
    },
    appendEvidence: async (/* entry, d */) => {
      calls.appendEvidence++;
      return undefined;
    },
    logLaneOutcome: async (entry) => {
      calls.logLaneOutcome++;
      laneOutcomes.push(entry);
      if (overrides.logLaneOutcomeThrows) throw new Error("outcome logger boom");
      return undefined;
    },
  };
  return { deps, calls, laneOutcomes, dispatchOptions, isMutated: () => mutated, setMutated: (v) => { mutated = v; } };
}

await t("buildExecutionPrompt contains identifier, every file, VERIFY, and the no-weaken-assertions hard stop; deterministic across two calls", () => {
  const plan = parsePlan(goodPlan);
  const p = buildExecutionPrompt(issue({ identifier: "KOL-1", title: "Directive" }), plan);
  assert.match(p, /KOL-1/);
  assert.match(p, /Directive/);
  assert.match(p, /ops-watcher\/foo\.mjs/);
  assert.match(p, /docs\/bar\.md/);
  assert.match(p, /node ops-watcher\/foo\.mjs --check/);
  assert.match(p, /Menyiapkan perubahan kecil yang diminta owner/);
  assert.match(p, /Do NOT weaken.*assertions/i);
  // Deterministic: same inputs -> same string.
  assert.equal(p, buildExecutionPrompt(issue({ identifier: "KOL-1", title: "Directive" }), plan));
});

await t("buildExecutionPrompt annotates files with anchors read from graphify-out/active/graph.json, not issue text", async () => {
  const graph = {
    nodes: [
      { id: "ops-watcher/foo.mjs", label: "ops-watcher/foo.mjs", type: "file" },
      { id: "fn:runFooCheck", label: "runFooCheck", type: "function", source_file: "ops-watcher/foo.mjs", source_location: "ops-watcher/foo.mjs:17" },
      { id: "doc:bar-scope", label: "Bar Scope", type: "section", source_file: "docs/bar.md", source_location: "docs/bar.md:4" },
      { id: "bait", label: "Issue Text Bait Anchor", type: "concept", source_file: "ops-watcher/other.mjs" },
    ],
    edges: [
      { source: "ops-watcher/foo.mjs", target: "fn:runFooCheck", type: "CONTAINS" },
    ],
  };
  await withActiveGraph(graph, async () => {
    const plan = parsePlan(goodPlan);
    const p = buildExecutionPrompt(issue({ description: "Issue Text Bait Anchor" }), plan);
    assert.match(
      p,
      /- ops-watcher\/foo\.mjs \(KG anchors from graphify-out\/active\/graph\.json: runFooCheck \[function\] @ L17\)/,
    );
    assert.match(
      p,
      /- docs\/bar\.md \(KG anchors from graphify-out\/active\/graph\.json: Bar Scope \[section\] @ L4\)/,
    );
    assert.equal(p.includes("Issue Text Bait Anchor"), false);
  });
});

// =====================================================================
// E2 edit — a plan posted AFTER an approval puts the issue back to awaiting.
// This is what makes "edit never executes the original" true in the executor
// rather than only in the card's wording.
// =====================================================================

await t("E2: a revised plan posted after an approval leaves the issue awaiting, and executes nothing", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const approvedAt = "2026-09-01T09:30:00.000Z";
  const revisedAt = "2026-09-01T09:45:00.000Z";
  const comments = {
    kol95: [
      c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt),
      c(TG_APPROVE, approvedAt),
      c(`${PLAN_MARKER} (iso) — rencana revisi OWNER via Telegram. Rencana sebelumnya TIDAK dijalankan.\n${goodPlan}`, revisedAt),
    ],
  };
  const { deps, spies } = makeSweepDeps({
    issues: [issue({ id: "kol95", identifier: "KOL-95" })],
    comments,
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(spies.execute, 0, "the original plan must not run once a revision exists");
  assert.equal(res.executed, 0);
  assert.equal(res.approved.length, 0, "the approval no longer applies to the newest plan");
  assert.equal(res.awaitingApproval.some((a) => a.identifier === "KOL-95"), true, "it is his decision again");
});

// =====================================================================
// A VENTURE FILE MUST ACTUALLY RECEIVE ITS VENTURE'S ANCHORS.
//
// Found the day the first venture graph existed (caveman-trading-os, 4,263
// nodes, stamped at its own HEAD, content check 10/10): the plan names a file
// as ventures/<id>/src/x.py while the venture graph describes it as src/x.py,
// so nothing matched and the file line came back bare. The content check made
// it worse by reading the venture's files under the Aidit OS root, where they
// do not exist.
// =====================================================================

await t("a venture file gets anchors from its OWN graph, and the citation says so", async () => {
  const ventures = [{ id: "demo-venture", status: "active", repoPath: "ventures/demo-venture" }];
  // The venture graph speaks in VENTURE-relative paths.
  const graph = {
    nodes: [
      { id: "fn:resolveBar", label: "resolveBar", type: "function", source_file: "src/engine.py", source_location: "src/engine.py:42" },
    ],
    edges: [],
  };
  const seenSourceRoots = [];
  const anchors = activeGraphAnchorsForFiles(["ventures/demo-venture/src/engine.py"], {
    ventures,
    planText: "resolveBar",
    readText: (p) => (String(p).endsWith(".stamp") ? "venturehead" : JSON.stringify(graph)),
    repoCommit: "aiditoshead",
    ventureHeadCommit: () => "venturehead",
    verifyContent: (_g, deps) => {
      seenSourceRoots.push(String(deps.sourceRoot || "").replace(/\\/g, "/"));
      return { verified: true, checked: 1, skipped: 0, mismatches: [], reason: "stubbed" };
    },
    contentCache: new Map(),
  });

  const key = "ventures/demo-venture/src/engine.py";
  assert.ok(anchors.get(key) && anchors.get(key).length, `the venture file must carry anchors, got ${JSON.stringify([...anchors])}`);
  assert.match(anchors.get(key)[0], /resolveBar/);
  assert.ok(
    seenSourceRoots.some((r) => r.endsWith("ventures/demo-venture")),
    `the content check must read the VENTURE tree, saw ${JSON.stringify(seenSourceRoots)}`,
  );
  assert.match(
    String(anchors.sourceByFile && anchors.sourceByFile.get(key)),
    /ventures\/demo-venture\/graph\.json$/,
    "the citation names the venture's own graph, not the Aidit OS one",
  );
});

// =====================================================================
// W8. THE READER MUST NOT TRUST THE STAMP ALONE.
//
// verifyGraphContent protected the WRITER. The reader compared stamp against
// HEAD and nothing else, so a stamp written at the wrong moment over stale
// content passed as fresh: reproduced on the ASUS at dbbec88, where
// buildExecutionPrompt emitted six anchors at line numbers that had all moved.
// =====================================================================

await t("W8: a fresh stamp over STALE CONTENT is not fresh, and emits no anchors", async () => {
  clearGraphContentCache();
  const graph = {
    nodes: [
      { id: "fn:runFooCheck", label: "runFooCheck", type: "function", source_file: "ops-watcher/foo.mjs", source_location: "ops-watcher/foo.mjs:17" },
    ],
    edges: [],
  };
  // The content check answers as it would against a tree where the symbol has
  // moved: the stamp matches, the contents do not.
  const restore = setGraphContentVerifier(() => ({
    verified: false, checked: 1, skipped: 0,
    mismatches: ["ops-watcher/foo.mjs:17 runFooCheck"],
    reason: "1/1 sampled symbols are not where the graph says",
  }));
  try {
    await withActiveGraph(graph, async () => {
      const freshness = graphFreshnessWithContent({
        graph,
        repoCommit: TEST_HEAD_COMMIT,
        readText: () => TEST_HEAD_COMMIT,
      });
      assert.equal(freshness.fresh, false, "stamp alone must not certify the graph");
      assert.equal(freshness.contentVerified, false);
      assert.match(freshness.reason, /stamp matches but/);
      const p = buildExecutionPrompt(issue({}), parsePlan(goodPlan));
      assert.equal(p.includes("KG anchors"), false, "no anchors when the contents do not match the stamp");
    }, { stubContent: false });
  } finally {
    restore();
    clearGraphContentCache();
  }
});

await t("W8: a fresh stamp over MATCHING content still emits anchors, and the check runs once per stamp", () => {
  clearGraphContentCache();
  let calls = 0;
  const graph = { nodes: [{ id: "fn:x", label: "x", source_file: "a.mjs", source_location: "a.mjs:1" }], edges: [] };
  const verify = () => { calls += 1; return { verified: true, checked: 3, skipped: 0, mismatches: [], reason: "3 sampled symbols confirmed in the tree" }; };
  const deps = { graph, repoCommit: TEST_HEAD_COMMIT, readText: () => TEST_HEAD_COMMIT, verifyContent: verify, contentCache: new Map() };
  const first = graphFreshnessWithContent(deps);
  const second = graphFreshnessWithContent(deps);
  assert.equal(first.fresh, true);
  assert.equal(first.contentVerified, true);
  assert.match(first.reason, /confirmed in the tree/);
  assert.equal(second.fresh, true);
  assert.equal(calls, 1, "cached per stamp: the heartbeat sweeps every five minutes and the answer cannot change while the stamp does not");
});

await t("W8: a graph that cannot be parsed is not fresh, whatever the stamp says", () => {
  const r = graphFreshnessWithContent({
    repoCommit: TEST_HEAD_COMMIT,
    readText: (p) => (String(p).endsWith(".stamp") ? TEST_HEAD_COMMIT : "{not json"),
    contentCache: new Map(),
  });
  assert.equal(r.fresh, false);
  assert.match(r.reason, /graph unreadable/);
});

await t("W8: a content check that THROWS refuses rather than certifying", () => {
  const r = graphFreshnessWithContent({
    graph: { nodes: [], edges: [] },
    repoCommit: TEST_HEAD_COMMIT,
    readText: () => TEST_HEAD_COMMIT,
    verifyContent: () => { throw new Error("disk gone"); },
    contentCache: new Map(),
  });
  assert.equal(r.fresh, false);
  assert.match(r.reason, /content check threw/);
});

// =====================================================================
// V1. THE SAME FILTER, AT EMISSION.
//
// graphify emits nodes whose label IS the docstring text. The content check
// already refuses those; anchor emission did not, so a lane was pointed at
// "Return DASHBOARD_SECRET. Raises at start @ L23" as if it were a symbol.
// Measured on the venture graph: 3,372 Python nodes located beyond L1 across
// 174 files, only 966 identifier-shaped — 2,406 docstrings.
// =====================================================================

await t("V1: a docstring-shaped label is never emitted as an anchor for a source file", async () => {
  const graph = {
    nodes: [
      { id: "ops-watcher/foo.mjs", label: "ops-watcher/foo.mjs", type: "file" },
      { id: "fn:runFooCheck", label: "runFooCheck", type: "function", source_file: "ops-watcher/foo.mjs", source_location: "ops-watcher/foo.mjs:17" },
      {
        id: "doc:secret",
        label: "Return DASHBOARD_SECRET. Raises at start",
        type: "docstring",
        source_file: "ops-watcher/foo.mjs",
        source_location: "ops-watcher/foo.mjs:23",
      },
    ],
    edges: [],
  };
  await withActiveGraph(graph, async () => {
    const plan = parsePlan(goodPlan);
    const p = buildExecutionPrompt(issue({}), plan);
    const line = p.split("\n").find((l) => l.includes("ops-watcher/foo.mjs (KG anchors"));
    assert.ok(line, "the file still gets its real anchors");
    assert.ok(line.includes("runFooCheck"), "the identifier-shaped symbol survives");
    assert.equal(line.includes("Return DASHBOARD_SECRET"), false, "the docstring must not be emitted as an anchor");
  });
});

await t("V1: a docstring reached through an EDGE is filtered too", async () => {
  const graph = {
    nodes: [
      { id: "ops-watcher/foo.mjs", label: "ops-watcher/foo.mjs", type: "file" },
      { id: "fn:runFooCheck", label: "runFooCheck", type: "function", source_file: "ops-watcher/foo.mjs", source_location: "ops-watcher/foo.mjs:17" },
      { id: "doc:prose", label: "Loads the config and raises on a missing key", type: "docstring", source_file: "ops-watcher/other.mjs", source_location: "ops-watcher/other.mjs:9" },
      { id: "fn:neighbourSymbol", label: "neighbourSymbol", type: "function", source_file: "ops-watcher/other.mjs", source_location: "ops-watcher/other.mjs:31" },
    ],
    edges: [
      { source: "fn:runFooCheck", target: "doc:prose", type: "CALLS" },
      { source: "fn:runFooCheck", target: "fn:neighbourSymbol", type: "CALLS" },
    ],
  };
  await withActiveGraph(graph, async () => {
    const plan = parsePlan(goodPlan);
    const p = buildExecutionPrompt(issue({}), plan);
    const line = p.split("\n").find((l) => l.includes("ops-watcher/foo.mjs (KG anchors"));
    assert.ok(line, "the file line carries anchors");
    assert.equal(line.includes("Loads the config"), false, "a neighbour docstring is still prose");
  });
});

await t("V1: a prose heading in a .md file is NOT filtered — it is that section's real name", async () => {
  const graph = {
    nodes: [
      { id: "doc:bar-scope", label: "Bar Scope", type: "section", source_file: "docs/bar.md", source_location: "docs/bar.md:4" },
    ],
    edges: [],
  };
  await withActiveGraph(graph, async () => {
    const plan = { ...parsePlan(goodPlan), files: ["docs/bar.md"] };
    const p = buildExecutionPrompt(issue({}), plan);
    assert.ok(p.includes("Bar Scope"), "a markdown heading anchors to a real place and stays");
  });
});

await t("V1: emission and the content check ask the SAME question", () => {
  // One predicate, imported by both. Drift between the two is what put a
  // docstring in front of a lane while the sampler was refusing it.
  for (const good of ["runFooCheck", "_privateThing", "$dollar", "buildExecutionPrompt()"]) {
    assert.equal(isIdentifierShapedLabel(good), true, good);
  }
  for (const prose of [
    "Return DASHBOARD_SECRET. Raises at start",
    "Bar Scope",
    "ops-watcher/foo.mjs",
    "obj.member",
    "",
  ]) {
    assert.equal(isIdentifierShapedLabel(prose), false, prose);
  }
});

// =====================================================================
// THE STALE-GRAPH REFUSAL.
//
// A stale graph points a lane at line numbers that have MOVED. Anchors that are
// confidently wrong are worse than no anchors at all: the lane trusts them,
// edits the wrong location, and nothing anywhere reports that it did. So
// anything other than a proven-fresh graph produces NO anchors and falls back
// to the plain file list — which is exactly today's behaviour and is never
// wrong, only less helpful.
//
// This is the mandated mutation target: point buildExecutionPrompt at a stale
// graph and these must go red.
// =====================================================================

await t("graph anchors are REFUSED when the stamp does not match the repo commit", () => {
  const r = graphFreshnessForAnchors({
    repoCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    readText: () => "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  assert.equal(r.fresh, false, "a mismatched stamp is not fresh");
  // Both commits must be named, or nobody can tell which side is behind.
  assert.match(r.reason, /aaaaaaaa/);
  assert.match(r.reason, /bbbbbbbb/);
});

await t("graph anchors are REFUSED when the stamp is missing or unreadable", () => {
  const missing = graphFreshnessForAnchors({
    repoCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    readText: () => { const e = new Error("ENOENT"); throw e; },
  });
  assert.equal(missing.fresh, false, "an unstamped graph is an UNKNOWN graph");
  assert.match(missing.reason, /stamp missing or unreadable/);

  const empty = graphFreshnessForAnchors({
    repoCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    readText: () => "   ",
  });
  assert.equal(empty.fresh, false, "an empty stamp is not a commit");
});

await t("graph anchors are ACCEPTED only when the stamp matches exactly", () => {
  const same = "cccccccccccccccccccccccccccccccccccccccc";
  const r = graphFreshnessForAnchors({ repoCommit: same, readText: () => `${same}\n` });
  assert.equal(r.fresh, true, "trailing whitespace in the stamp is tolerated");
  assert.equal(r.graphCommit, same);
  assert.equal(r.repoCommit, same);
});

await t("a stale graph leaves the prompt on the plain file list, byte-identical to no graph at all", async () => {
  const graph = {
    nodes: [
      { id: "fn:runFooCheck", label: "runFooCheck", type: "function", source_file: "ops-watcher/foo.mjs", source_location: "ops-watcher/foo.mjs:17" },
    ],
    edges: [],
  };
  // A graph IS present and full of usable anchors — the only thing wrong is the
  // stamp. The output must be identical to the case where no graph exists,
  // because a wrong anchor is worse than a missing one.
  const plan = parsePlan(goodPlan);
  const withoutGraph = buildExecutionPrompt(issue(), plan);
  await withStaleActiveGraph(graph, () => {
    const withStale = buildExecutionPrompt(issue(), plan);
    assert.equal(withStale, withoutGraph, "a stale graph contributes nothing at all");
    assert.equal(withStale.includes("KG anchors"), false, "and no anchor block is emitted");
  });
});


// =====================================================================
// ANCHOR SELECTION MUST BE RELEVANT, CAPPED, AND HONEST.
//
// Three defects, all measured on the real graph before the fix:
//   1. Selection was alphabetical. A plan naming buildExecutionPrompt in its
//      title, objective AND steps got __dirname @ L63, ACTIVE_GRAPH_FILE @ L66,
//      addIssueLabelReal() @ L78, APPROVED_MARKER @ L108, asMs() @ L158 —
//      five of six clustered at the head of a 2,700-line file, purely for
//      beginning with an underscore or the letter A.
//   2. GRAPH_ANCHOR_LIMIT_TOTAL was declared and referenced NOWHERE. 20 files
//      produced 120 anchors, five times the stated cap.
//   3. An anchor had a start and no end, and its fallback chain ended in
//      source_file — so a node with no location emitted a FILE PATH where a
//      location belongs.
// =====================================================================

await t("anchor relevance: an exact mention of the label outranks alphabetical order", () => {
  // The scoring itself, before it is wired into anything.
  const plan = "Ubah buildExecutionPrompt supaya anchor relevan.";
  assert.equal(scoreAnchorRelevance("buildExecutionPrompt", plan), 100, "an exact mention wins outright");
  assert.ok(
    scoreAnchorRelevance("buildExecutionPrompt", plan) > scoreAnchorRelevance("__dirname", plan),
    "and beats a node the plan never mentions",
  );
  assert.equal(scoreAnchorRelevance("__dirname", plan), 0, "an unmentioned label scores nothing");
});

await t("anchor relevance: case-insensitive, survives a () suffix, and matches split words", () => {
  assert.equal(scoreAnchorRelevance("buildExecutionPrompt", "call BUILDEXECUTIONPROMPT now"), 100, "case-insensitive");
  assert.equal(scoreAnchorRelevance("buildExecutionPrompt", "call buildExecutionPrompt() now"), 100, "a () suffix does not break the match");
  // 'build execution prompt' must still find buildExecutionPrompt.
  assert.ok(scoreAnchorRelevance("buildExecutionPrompt", "rework the build execution prompt") >= 40, "camelCase is split for matching");
  assert.equal(scoreAnchorRelevance("", "anything"), 0);
  assert.equal(scoreAnchorRelevance("label", ""), 0);
});

await t("anchor relevance: a named symbol comes FIRST in the emitted prompt", async () => {
  const graph = {
    nodes: [
      { id: "a", label: "__dirname", type: "const", source_file: "ops-watcher/foo.mjs", source_location: "L3" },
      { id: "b", label: "ACTIVE_GRAPH_FILE", type: "const", source_file: "ops-watcher/foo.mjs", source_location: "L6" },
      { id: "c", label: "runFooCheck", type: "function", source_file: "ops-watcher/foo.mjs", source_location: "L200" },
    ],
    edges: [],
  };
  await withActiveGraph(graph, () => {
    const plan = parsePlan(goodPlan);
    // Alphabetically runFooCheck is LAST. Named in the title it must come first.
    const p = buildExecutionPrompt(issue({ title: "Perbaiki runFooCheck" }), plan);
    const line = p.split("\n").find((l) => l.includes("ops-watcher/foo.mjs (KG anchors"));
    assert.ok(line, "the file line carries anchors");
    const anchors = line.split(": ").slice(1).join(": ");
    assert.ok(anchors.startsWith("runFooCheck"), `runFooCheck must lead, got: ${anchors}`);
  });
});

await t("anchor relevance: OBJECTIVE and a STEP each rank a symbol on their own", async () => {
  const graph = {
    nodes: [
      { id: "a", label: "__dirname", type: "const", source_file: "ops-watcher/foo.mjs", source_location: "L3" },
      { id: "c", label: "runFooCheck", type: "function", source_file: "ops-watcher/foo.mjs", source_location: "L200" },
    ],
    edges: [],
  };
  const leads = async (planObj) => {
    let out = "";
    await withActiveGraph(graph, () => {
      const p = buildExecutionPrompt(issue(), planObj);
      const line = p.split("\n").find((l) => l.includes("ops-watcher/foo.mjs (KG anchors")) || "";
      out = line.split(": ").slice(1).join(": ");
    });
    return out;
  };
  const base = parsePlan(goodPlan);
  const byObjective = await leads({ ...base, objective: "Perbaiki runFooCheck di modul ini" });
  assert.ok(byObjective.startsWith("runFooCheck"), `objective alone must rank it, got: ${byObjective}`);
  const byStep = await leads({ ...base, steps: ["Panggil runFooCheck lalu verifikasi"] });
  assert.ok(byStep.startsWith("runFooCheck"), `a step alone must rank it, got: ${byStep}`);
});

await t("anchor relevance never REMOVES anchors, only reorders them", async () => {
  const graph = {
    nodes: [
      { id: "a", label: "alpha", type: "function", source_file: "ops-watcher/foo.mjs", source_location: "L10" },
      { id: "b", label: "beta", type: "function", source_file: "ops-watcher/foo.mjs", source_location: "L20" },
    ],
    edges: [],
  };
  await withActiveGraph(graph, () => {
    // A plan naming nothing in the graph still gets its anchors.
    const p = buildExecutionPrompt(issue({ title: "sesuatu yang lain" }), parsePlan(goodPlan));
    const line = p.split("\n").find((l) => l.includes("ops-watcher/foo.mjs (KG anchors")) || "";
    assert.ok(line.includes("alpha"), "alpha survives");
    assert.ok(line.includes("beta"), "beta survives");
  });
});

await t("GRAPH_ANCHOR_LIMIT_TOTAL is ENFORCED across all files, not just per file", async () => {
  // 20 files x 6 per-file anchors = 120 without an overall cap. The measured
  // before-number was exactly that: five times the stated cap of 24.
  const nodes = [];
  const files = [];
  for (let f = 0; f < 20; f += 1) {
    const file = `ops-watcher/gen${f}.mjs`;
    files.push(file);
    for (let n = 0; n < 8; n += 1) {
      nodes.push({ id: `n${f}_${n}`, label: `sym${f}_${n}`, type: "function", source_file: file, source_location: `L${(n + 1) * 10}` });
    }
  }
  await withActiveGraph({ nodes, edges: [] }, () => {
    const plan = { ...parsePlan(goodPlan), files };
    const p = buildExecutionPrompt(issue(), plan);
    const emitted = (p.match(/@ L\d+/g) || []).length;
    assert.ok(emitted > 0, "anchors are still emitted");
    assert.ok(emitted <= 24, `overall cap must hold; emitted ${emitted}`);
  });
});

await t("an anchor carries an END line derived from the next symbol in the same file", () => {
  const starts = [10, 20, 55];
  assert.equal(graphAnchorRange("L10", starts), "L10-L19", "ends where the next symbol begins");
  assert.equal(graphAnchorRange("L20", starts), "L20-L54");
  // The LAST symbol has no successor. Inventing an end for it would be the same
  // dishonesty as the file-path fallback.
  assert.equal(graphAnchorRange("L55", starts), "L55", "the last symbol keeps a bare start");
  assert.equal(graphAnchorRange("ops-watcher/foo.mjs:17", [17, 30]), "L17-L29", "the path:line shape parses too");
  assert.equal(graphAnchorStartLine("L46"), 46);
  assert.equal(graphAnchorStartLine("path/to/x.mjs:17"), 17);
  assert.equal(graphAnchorStartLine("nonsense"), null, "unparseable is null, never a guess");
});

await t("a node with no location emits NO location, never a file path", () => {
  // The old fallback chain ended in source_file, so this node used to emit
  // `orphan @ ops-watcher/foo.mjs` — a path wearing a location's clothes, which
  // a lane reads as 'here is where to look'.
  assert.equal(graphNodeLocation({ label: "orphan", source_file: "ops-watcher/foo.mjs" }), "");
  assert.equal(graphNodeLocation({ label: "orphan", file: "ops-watcher/foo.mjs" }), "");
  assert.equal(graphNodeLocation({ source_location: "L42" }), "L42", "a real location still comes through");
});

await t("buildExecutionPrompt without specialists is byte-for-byte unchanged", () => {
  const plan = parsePlan(goodPlan);
  assert.equal(buildExecutionPrompt(issue(), plan), EXPECTED_EXECUTION_PROMPT_NO_SPECIALIST);
  assert.equal(buildExecutionPrompt(issue(), plan, { section: "" }), EXPECTED_EXECUTION_PROMPT_NO_SPECIALIST);
});

await t("buildExecutionPrompt renders specialist task class, hard stops, standards, and voice in order", () => {
  const plan = parsePlan(goodPlan);
  const p = buildExecutionPrompt(issue(), plan, specialistPacket);
  assert.match(p, /Task class: frontend-design/);
  assert.match(p, /HARD STOPS — do not do these:/);
  assert.match(p, /- Do not invent a new design system/);
  assert.match(p, /REQUIRED STANDARDS — file paths the plan must obey:/);
  assert.match(p, /- docs\/standards\/frontend-standards\.md/);
  assert.match(p, /SPECIALIST VOICE \(taskClass: frontend-design\)/);
  assert.ok(p.indexOf("HARD STOPS — do not do these:") < p.indexOf("SPECIALIST VOICE (taskClass: frontend-design)"));
});

await t("executeApprovedDirective specialist resolver failure leaves no-specialist execution prompt", async () => {
  const plan = parsePlan(goodPlan);
  const made = makeExecDeps({ mutateOnDispatch: false });
  let capturedPrompt = null;
  const logs = [];
  made.deps.resolveSpecialistsForPacket = async () => { throw new Error("resolver boom"); };
  made.deps.log = (msg) => { logs.push(msg); };
  made.deps.dispatchExecution = async (prompt) => {
    capturedPrompt = prompt;
    made.calls.dispatch++;
    made.setMutated(true);
    return { ok: true, stdout: "implementation done", stderr: "" };
  };
  const res = await executeApprovedDirective(issue(), plan, made.deps);
  assert.equal(res.outcome, "done");
  assert.equal(capturedPrompt, buildExecutionPrompt(issue(), plan));
  assert.equal(logs.some((msg) => /specialist resolver failed.*resolver boom/.test(msg)), true);
});

await t("executeApprovedDirective: scope violation -> refused, no snapshot spy call, no dispatch spy call", async () => {
  const { deps, calls } = makeExecDeps();
  const plan = parsePlan(goodPlan.replace("ops-watcher/foo.mjs, docs/bar.md", "ventures/x.mjs"));
  const res = await executeApprovedDirective(issue(), plan, deps);
  assert.equal(res.outcome, "refused");
  assert.ok(Array.isArray(res.violations) && res.violations.length > 0);
  assert.equal(calls.snapshot, 0);
  assert.equal(calls.dispatch, 0);
  assert.equal(calls.appendEvidence, 1);
});

await t("executeApprovedDirective: non-node-ops-watcher VERIFY (rm -rf /) -> refused verify-out-of-scope", async () => {
  const { deps, calls } = makeExecDeps();
  const plan = parsePlan(goodPlan.replace("VERIFY: node ops-watcher/foo.mjs --check", "VERIFY: rm -rf /"));
  const res = await executeApprovedDirective(issue(), plan, deps);
  assert.equal(res.outcome, "refused");
  assert.equal(res.reason, "verify-out-of-scope");
  assert.equal(calls.snapshot, 0);
  assert.equal(calls.dispatch, 0);
});

await t("executeApprovedDirective: both lanes in cooldown -> skipped, no snapshot", async () => {
  const { deps, calls } = makeExecDeps({ guardResult: { skip: true, reason: "cooldown" } });
  const plan = parsePlan(goodPlan);
  const res = await executeApprovedDirective(issue(), plan, deps);
  assert.equal(res.outcome, "skipped");
  assert.match(res.reason, /^lane-/);
  assert.equal(calls.snapshot, 0);
  assert.equal(calls.dispatch, 0);
  // guardLane is called twice: corleone then hatta fallback.
  assert.equal(calls.guardLane, 2);
});

await t("executeApprovedDirective: snapshot failure -> aborted, no dispatch", async () => {
  const { deps, calls } = makeExecDeps();
  deps.snapshotFiles = async () => { calls.snapshot++; return { ok: false, error: "boom" }; };
  const plan = parsePlan(goodPlan);
  const res = await executeApprovedDirective(issue(), plan, deps);
  assert.equal(res.outcome, "aborted");
  assert.equal(res.reason, "snapshot-failed");
  assert.equal(calls.dispatch, 0);
});

await t("executeApprovedDirective: happy path -> done, restore NOT called, one evidence line, filesChanged non-empty", async () => {
  const { deps, calls, laneOutcomes, dispatchOptions } = makeExecDeps();
  const plan = parsePlan(goodPlan);
  const res = await executeApprovedDirective(issue(), plan, deps);
  assert.equal(res.outcome, "done");
  assert.ok(Array.isArray(res.filesChanged) && res.filesChanged.length > 0);
  assert.equal(calls.restore, 0);
  assert.equal(calls.appendEvidence, 1);
  assert.equal(calls.logLaneOutcome, 1);
  assert.ok(dispatchOptions[0].env.LANE_RUN_ID, "lane receives a run id through env");
  assert.equal(laneOutcomes[0].runId, dispatchOptions[0].env.LANE_RUN_ID);
  assert.deepEqual(laneOutcomes[0].outcome, {
    verifyPassed: true,
    filesChanged: 2,
    filesPlanned: 2,
    deliveredWhatWasAsked: true,
  });
  assert.ok(typeof res.verifyTail === "string");
});

await t("executeApprovedDirective: verify red -> reverted verify-red, restoreFiles called with the snapshot", async () => {
  const { deps, calls, laneOutcomes } = makeExecDeps({ verifyResult: { ok: false, stdout: "", stderr: "AssertionError" } });
  const plan = parsePlan(goodPlan);
  const res = await executeApprovedDirective(issue(), plan, deps);
  assert.equal(res.outcome, "reverted");
  assert.equal(res.reason, "verify-red");
  assert.equal(calls.restore, 1);
  assert.equal(calls.appendEvidence, 1);
  assert.deepEqual(laneOutcomes[0].outcome, {
    verifyPassed: false,
    filesChanged: 2,
    filesPlanned: 2,
    deliveredWhatWasAsked: false,
  });
});

await t("executeApprovedDirective: verify green but full suite red -> reverted full-suite-red, restoreFiles called", async () => {
  const { deps, calls } = makeExecDeps({ fullResult: { ok: false, stdout: "", stderr: "some suite red" } });
  const plan = parsePlan(goodPlan);
  const res = await executeApprovedDirective(issue(), plan, deps);
  assert.equal(res.outcome, "reverted");
  assert.equal(res.reason, "full-suite-red");
  assert.equal(calls.restore, 1);
  assert.equal(calls.runFullSuite, 1);
});

await t("executeApprovedDirective: both green but files untouched -> no-op", async () => {
  const { deps, calls, laneOutcomes } = makeExecDeps({ mutateOnDispatch: false });
  const plan = parsePlan(goodPlan);
  const res = await executeApprovedDirective(issue(), plan, deps);
  assert.equal(res.outcome, "no-op");
  assert.equal(calls.restore, 0);
  assert.equal(calls.appendEvidence, 1);
  assert.deepEqual(laneOutcomes[0].outcome, {
    verifyPassed: true,
    filesChanged: 0,
    filesPlanned: 2,
    deliveredWhatWasAsked: false,
  });
});

await t("executeApprovedDirective: outcome logger throwing does not change directive outcome", async () => {
  const { deps, calls } = makeExecDeps({ logLaneOutcomeThrows: true });
  const plan = parsePlan(goodPlan);
  const res = await executeApprovedDirective(issue(), plan, deps);
  assert.equal(res.outcome, "done");
  assert.equal(calls.logLaneOutcome, 1);
  assert.equal(calls.appendEvidence, 1);
});

await t("executeApprovedDirective: injected git/pm2 spies are never called across all branches", async () => {
  const gitSpy = { calls: 0, fn: () => { gitSpy.calls++; } };
  const pm2Spy = { calls: 0, fn: () => { pm2Spy.calls++; } };
  const plan = parsePlan(goodPlan);
  const branches = [
    makeExecDeps(),                                                                    // done
    makeExecDeps({ guardResult: { skip: true, reason: "cooldown" } }),                 // skipped
    makeExecDeps({ verifyResult: { ok: false } }),                                     // reverted verify-red
    makeExecDeps({ fullResult: { ok: false } }),                                       // reverted full-suite-red
    makeExecDeps({ mutateOnDispatch: false }),                                         // no-op
  ];
  for (const b of branches) {
    b.deps.git = gitSpy.fn;
    b.deps.pm2 = pm2Spy.fn;
    await executeApprovedDirective(issue(), plan, b.deps);
  }
  assert.equal(gitSpy.calls, 0);
  assert.equal(pm2Spy.calls, 0);
});

// ===========================================================================
// Sweep throttle — the --once path is bounded by SWEEP_MIN_INTERVAL_MS.
// ===========================================================================

await t("sweep throttle: inside SWEEP_MIN_INTERVAL_MS -> { skipped: true } and plan/execute spies are never called", async () => {
  await resetTmp();
  // One minute ago — well within the 15-minute window.
  await fs.writeFile(TMP_STATE, JSON.stringify({ attempts: {}, lastSweepMs: NOW - 60_000 }), "utf8");
  const issues = [issue({ id: "i1", identifier: "KOL-101" })];
  const comments = { i1: [] };
  let planCalls = 0, execCalls = 0;
  const { deps } = makeSweepDeps({
    issues, comments,
    extra: {
      once: true,
      dispatchPlan: async () => { planCalls++; return { ok: true, stdout: goodPlan, stderr: "", timedOut: false }; },
      executeDirective: async () => { execCalls++; return { outcome: "skipped", reason: "should-not-run" }; },
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.skipped, true);
  assert.equal(planCalls, 0);
  assert.equal(execCalls, 0);
  // The throttle must not have rewritten the persisted lastSweepMs.
  const st = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
  assert.equal(st.lastSweepMs, NOW - 60_000);
});

await t("sweep throttle: past SWEEP_MIN_INTERVAL_MS -> a normal sweep runs and lastSweepMs is written", async () => {
  await resetTmp();
  // Just past the window.
  await fs.writeFile(TMP_STATE, JSON.stringify({ attempts: {}, lastSweepMs: NOW - SWEEP_MIN_INTERVAL_MS - 60_000 }), "utf8");
  const issues = [issue({ id: "i1", identifier: "KOL-101" })];
  const comments = { i1: [] };
  const { deps, posts } = makeSweepDeps({ issues, comments, extra: { once: true } });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.skipped, undefined);
  assert.equal(res.planned, 1);
  assert.equal(contentPosts(posts).length, 1);
  assert.match(posts[0].body.body, /^DIRECTIVE PLAN \(/);
  const st = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
  assert.equal(st.lastSweepMs, NOW);
});

await t("verifyFile with injected fs reports match, no match, missing file, and denied ventures path", async () => {
  const reads = [];
  const readFile = async (file) => {
    reads.push(file);
    if (String(file).includes("missing.txt")) {
      const err = new Error("not found");
      err.code = "ENOENT";
      throw err;
    }
    return "OK\ncanaryAdd\n";
  };
  const match = await verifyFile({ path: "ops-watcher/canary-step.mjs", matches: "canaryAdd" }, { repoRoot: __dirname, readFile });
  assert.equal(match.ok, true);
  assert.equal(match.bytes > 0, true);
  const noMatch = await verifyFile({ path: "ops-watcher/canary-step.mjs", contains: "not-here" }, { repoRoot: __dirname, readFile });
  assert.equal(noMatch.ok, false);
  assert.match(noMatch.reason, /substring not found/);
  const missing = await verifyFile({ path: "missing.txt", contains: "x" }, { repoRoot: __dirname, readFile });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /missing or unreadable file/);
  const beforeDenied = reads.length;
  const denied = await verifyFile({ path: "ventures/x.txt", contains: "x" }, { repoRoot: __dirname, readFile });
  assert.equal(denied.ok, false);
  // This used to assert /denied directory/ — the generic message from the
  // unconditional fourth fence, i.e. the assertion pinned the bug in place.
  // "ventures/x.txt" belongs to no venture in the registry, so it is still
  // refused, now by the specific reason. Full coverage of that gate lives in
  // ops-watcher/verify-file.regression.test.mjs; this stays as the integration
  // check that no file is read when the path is refused.
  assert.match(denied.reason, /unknown venture/);
  assert.equal(reads.length, beforeDenied, "a refused path is never read from disk");
});


// -- KOL-73: an approved directive whose plan cannot be captured -------------
// The owner approved KOL-73 on 2026-09-01T11:21 and nothing ran: no evidence
// line, no comment, no error. Its stored plan carries a multi-line PowerShell
// VERIFY, and parsePlan reads OUT OF SCOPE at verifyIdx+1, which lands on the
// continuation line instead. The capture branch then dropped the whole
// directive through `continue`. These cases pin all three silent paths.
await resetTmp();

const kol73Plan = [
  "OBJECTIVE: Menyiapkan perubahan kecil yang diminta owner.",
  "FILES: ops-watcher/foo.mjs",
  "STEPS:",
  "- Terapkan perubahan lalu verifikasi secara lokal.",
  "VERIFY: powershell -NoProfile -Command @" + String.fromCharCode(39),
  "Get-Content ops-watcher/foo.mjs | Select-String -Pattern canaryAdd",
  String.fromCharCode(39) + "@",
  "OUT OF SCOPE: Tidak menjalankan network, Telegram, pm2, git, atau package install.",
  "RISK: low",
].join("\n");

function planComment73(body, at = "2026-09-01T09:00:00.000Z") {
  return c(`${PLAN_MARKER} (${at}):\n${body}`, at);
}
function approved73(commentList) {
  return { issues: [issue({ id: "iss-73", identifier: "KOL-73", status: "todo" })], comments: { "iss-73": commentList } };
}
function evidenceSpy() {
  const records = [];
  return { records, appendEvidence: async (record) => { records.push(record); } };
}
function unexecutablePosts(posts) {
  return posts.filter((p) => String((p.body && p.body.body) || "").startsWith(UNEXECUTABLE_MARKER));
}

await t("K1 approved directive with an unparseable plan is reported, not dropped (KOL-73)", async () => {
  const ev = evidenceSpy();
  const { issues, comments } = approved73([planComment73(kol73Plan), c(TG_APPROVE, "2026-09-01T09:30:00.000Z")]);
  const { deps, posts, getExecuteCalls } = makeSweepDeps({ issues, comments, extra: { appendEvidence: ev.appendEvidence } });
  const summary = await runDirectiveSweepOnce(deps);

  assert.equal(summary.approved.length, 1, "still classified as approved");
  assert.equal(summary.unexecutable.length, 1, "reported as unexecutable");
  assert.equal(summary.unexecutable[0].identifier, "KOL-73");
  assert.equal(summary.unexecutable[0].reason, "plan-parse-failed");
  assert.equal(summary.unexecutable[0].detail, "missing OUT OF SCOPE");
  assert.equal(getExecuteCalls(), 0, "nothing is executed from an unreadable plan");

  const reports = unexecutablePosts(posts);
  assert.equal(reports.length, 1, "exactly one comment tells the owner");
  assert.match(reports[0].body.body, /plan-parse-failed/);
  assert.match(reports[0].body.body, /missing OUT OF SCOPE/);

  const captured = ev.records.filter((r) => r.type === "directive-capture-failed");
  assert.equal(captured.length, 1, "exactly one evidence line");
  assert.equal(captured[0].identifier, "KOL-73");
  assert.equal(captured[0].reason, "plan-parse-failed");
  assert.equal(captured[0].approvedAt, "2026-09-01T09:30:00.000Z");
});

await resetTmp();
await t("K2 an approval with no plan comment is re-planned, not classified approved", async () => {
  // classifyDirective only reports "approved" when a decision follows a plan
  // comment, so the sweep cannot reach capturePlanForExecution's
  // plan-comment-missing branch: with no plan there is no approval to act on.
  // That branch stays as a guard for a plan comment deleted after approval, and
  // K8 covers it directly. What matters here is that this shape is not silently
  // dropped either -- it goes back through planning.
  const ev = evidenceSpy();
  const { issues, comments } = approved73([c(TG_APPROVE, "2026-09-01T09:30:00.000Z")]);
  const { deps, posts } = makeSweepDeps({ issues, comments, extra: { appendEvidence: ev.appendEvidence } });
  const summary = await runDirectiveSweepOnce(deps);
  assert.equal(summary.approved.length, 0, "no plan means no approval to execute");
  assert.equal(summary.unexecutable.length, 0);
  assert.equal(unexecutablePosts(posts).length, 0);
  assert.equal(summary.planned, 1, "it is re-planned instead of disappearing");
});

await resetTmp();
await t("K3 plan comment without an OBJECTIVE line is reported as plan-objective-missing", async () => {
  const ev = evidenceSpy();
  const broken = "FILES: ops-watcher/foo.mjs\nSTEPS:\n- lakukan sesuatu\nVERIFY: node x.mjs\nOUT OF SCOPE: tidak ada\nRISK: low";
  const { issues, comments } = approved73([planComment73(broken), c(TG_APPROVE, "2026-09-01T09:30:00.000Z")]);
  const { deps, posts } = makeSweepDeps({ issues, comments, extra: { appendEvidence: ev.appendEvidence } });
  const summary = await runDirectiveSweepOnce(deps);
  assert.equal(summary.unexecutable.length, 1);
  assert.equal(summary.unexecutable[0].reason, "plan-objective-missing");
  assert.equal(unexecutablePosts(posts).length, 1);
});

await resetTmp();
await t("K4 the reported directive is returned to planning and stops being re-reported", async () => {
  // Reporting alone would leave the owner's approval stuck forever, so the
  // directive goes back through the ordinary planning path. The first sweep
  // reports and re-plans; the second sweep sees the NEW plan comment with no
  // decision after it and classifies the issue as awaiting-approval, so nothing
  // is reported twice and nothing executes on the unreadable plan.
  const ev = evidenceSpy();
  const { issues, comments } = approved73([planComment73(kol73Plan), c(TG_APPROVE, "2026-09-01T09:30:00.000Z")]);
  const { deps, posts, cards, getExecuteCalls } = makeSweepDeps({ issues, comments, extra: { appendEvidence: ev.appendEvidence } });

  const first = await runDirectiveSweepOnce(deps);
  assert.equal(first.unexecutable.length, 1, "the first sweep reports it");
  assert.equal(first.planned, 1, "and re-plans it in the same sweep");
  assert.equal(getExecuteCalls(), 0, "nothing runs from the unreadable plan");
  assert.equal(cards.length, 1, "the replacement plan goes back to the owner as a decision card");

  const second = await runDirectiveSweepOnce(deps);
  assert.equal(second.unexecutable.length, 0, "the second sweep has nothing left to report");
  assert.equal(second.awaitingApproval.length, 1, "it now waits on the owner's decision for the new plan");
  assert.equal(second.planned, 0, "and does not re-plan again while waiting");

  const third = await runDirectiveSweepOnce(deps);
  assert.equal(third.awaitingApproval.length, 1, "still waiting, still quiet");

  assert.equal(unexecutablePosts(posts).length, 1, "the owner is told once, not once per sweep");
  assert.equal(ev.records.filter((r) => r.type === "directive-capture-failed").length, 1);
});

await resetTmp();
await t("K16 re-planning an unreadable approved plan counts against the attempt cap", async () => {
  // The re-plan runs through the normal planning path, so it is bounded by
  // maxPlanAttempts and escalates at the cap instead of burning a paid lane
  // call every five minutes forever.
  const ev = evidenceSpy();
  const { issues, comments } = approved73([planComment73(kol73Plan), c(TG_APPROVE, "2026-09-01T09:30:00.000Z")]);
  const { deps } = makeSweepDeps({
    issues,
    comments,
    plan: kol73Plan, // the replacement plan is unreadable too
    extra: { appendEvidence: ev.appendEvidence, maxPlanAttempts: 2 },
  });

  const first = await runDirectiveSweepOnce(deps);
  assert.equal(first.unexecutable.length, 1);
  // The capture failure is recorded as an attempt, and the replacement plan
  // fails to parse as well, so the cap is reached without a third sweep.
  const second = await runDirectiveSweepOnce(deps);
  assert.equal(second.planned, 0, "at the cap the runner stops planning");
  assert.equal(second.errors.filter((e) => /network error/.test(e)).length, 0);
});

await resetTmp();
await t("K5 a report is posted again once a new plan is approved", async () => {
  // findPlanDecision takes the first decision after the newest plan comment, so
  // a second APPROVE tap on the same plan is the same decision and must not
  // earn a second report. A new plan comment starts a new decision, and that
  // one does.
  const ev = evidenceSpy();
  const earlierReport = c(`${UNEXECUTABLE_MARKER} (2026-09-01T09:45:00.000Z): laporan lama.`, "2026-09-01T09:45:00.000Z");
  const { issues, comments } = approved73([
    planComment73(kol73Plan, "2026-09-01T09:00:00.000Z"),
    c(TG_APPROVE, "2026-09-01T09:30:00.000Z"),
    earlierReport,
    planComment73(kol73Plan, "2026-09-01T09:50:00.000Z"),
    c(TG_APPROVE, "2026-09-01T09:59:00.000Z"),
  ]);
  const { deps, posts } = makeSweepDeps({ issues, comments, extra: { appendEvidence: ev.appendEvidence } });
  const summary = await runDirectiveSweepOnce(deps);
  assert.equal(summary.unexecutable.length, 1);
  assert.equal(summary.unexecutable[0].approvedAt, "2026-09-01T09:59:00.000Z", "the newest plan's decision governs");
  assert.equal(unexecutablePosts(posts).length, 1, "the newer approval earns its own report");
});

await resetTmp();
await t("K6 dryRun reports the problem in the summary but posts nothing and writes no evidence", async () => {
  const ev = evidenceSpy();
  const { issues, comments } = approved73([planComment73(kol73Plan), c(TG_APPROVE, "2026-09-01T09:30:00.000Z")]);
  const { deps, posts } = makeSweepDeps({ issues, comments, extra: { appendEvidence: ev.appendEvidence, dryRun: true } });
  const summary = await runDirectiveSweepOnce(deps);
  assert.equal(summary.unexecutable.length, 1, "a dry sweep still surfaces it");
  assert.equal(summary.unexecutable[0].reason, "plan-parse-failed");
  assert.equal(unexecutablePosts(posts).length, 0, "dryRun writes no comment");
  assert.equal(ev.records.length, 0, "dryRun writes no evidence");
});

await resetTmp();
await t("K7 a parseable approved plan is still captured and executed, with no report", async () => {
  const ev = evidenceSpy();
  const { issues, comments } = approved73([planComment73(goodPlan), c(TG_APPROVE, "2026-09-01T09:30:00.000Z")]);
  const { deps, posts, getExecuteCalls } = makeSweepDeps({ issues, comments, extra: { appendEvidence: ev.appendEvidence } });
  const summary = await runDirectiveSweepOnce(deps);
  assert.equal(summary.unexecutable.length, 0);
  assert.equal(getExecuteCalls(), 1, "the happy path still reaches execution");
  assert.equal(unexecutablePosts(posts).length, 0);
});

await resetTmp();
await t("K9 a Telegram send that is refused rather than thrown is recorded, not lost", async () => {
  // sendMessage returns { sent: false, ok: false, reason } when the token is
  // missing or the API refuses; it does not throw. The catch this replaced saw
  // only thrown errors, so a refused send left summary.errors empty and the
  // owner's single push notification for a failed directive just never arrived.
  const { issues, comments } = approved73([planComment73(goodPlan), c(TG_APPROVE, "2026-09-01T09:30:00.000Z")]);
  const { deps, messages } = makeSweepDeps({
    issues,
    comments,
    extra: {
      executeDirective: async () => ({ outcome: "reverted", reason: "verify-red" }),
      sendOwnerMessage: async (text) => { messages.push(text); return { sent: false, ok: false, reason: "TELEGRAM_BOT_TOKEN_AHMAD not set" }; },
    },
  });
  const summary = await runDirectiveSweepOnce(deps);
  assert.equal(summary.reverted, 1, "the directive still counts as reverted");
  assert.equal(messages.length, 1, "the send was attempted exactly once, no retry loop");
  const recorded = summary.errors.filter((e) => /telegram send failed/.test(e));
  assert.equal(recorded.length, 1, "the refused send is recorded");
  assert.match(recorded[0], /TELEGRAM_BOT_TOKEN_AHMAD not set/, "the reason is carried through");
});

await resetTmp();
await t("K10 a delivered Telegram send records no error", async () => {
  const { issues, comments } = approved73([planComment73(goodPlan), c(TG_APPROVE, "2026-09-01T09:30:00.000Z")]);
  const { deps, messages } = makeSweepDeps({
    issues,
    comments,
    extra: { executeDirective: async () => ({ outcome: "reverted", reason: "verify-red" }) },
  });
  const summary = await runDirectiveSweepOnce(deps);
  assert.equal(messages.length, 1);
  assert.equal(summary.errors.filter((e) => /telegram/.test(e)).length, 0);
});

// -- state persistence is not silent ----------------------------------------
// A swallowed state write is expensive rather than untidy: attempts[] never
// advances, so a directive that has already hit maxPlanAttempts is re-planned
// on every sweep at one paid lane call each; lastSweepMs never persists, so the
// --once throttle stops throttling; attemptCapDecisionResets never persists, so
// the escalation idempotency scoping stops working. The listener already
// surfaces this class as persistError, and the sweep now does too.
function plannableIssue() {
  return { issues: [issue({ id: "iss-s1", identifier: "KOL-S1", status: "todo" })], comments: { "iss-s1": [] } };
}

await resetTmp();
await t("K11 a state write failure is reported once, with its reason", async () => {
  const { issues, comments } = plannableIssue();
  let writes = 0;
  const { deps } = makeSweepDeps({
    issues,
    comments,
    extra: {
      _fs: {
        readFile: async () => "{}",
        writeFile: async () => { writes++; const e = new Error("no space left on device"); e.code = "ENOSPC"; throw e; },
      },
    },
  });
  const summary = await runDirectiveSweepOnce(deps);
  assert.equal(summary.planned, 1, "the sweep still does its work");
  assert.ok(writes >= 1, "a write was attempted");
  assert.equal(summary.persistError, "ENOSPC");
  const reported = summary.errors.filter((e) => /state write failed/.test(e));
  assert.equal(reported.length, 1, "reported once, not once per write");
  assert.match(reported[0], /attempt caps/);
});

await resetTmp();
await t("K12 a successful state write reports nothing", async () => {
  const { issues, comments } = plannableIssue();
  const { deps } = makeSweepDeps({
    issues,
    comments,
    extra: { _fs: { readFile: async () => "{}", writeFile: async () => {} } },
  });
  const summary = await runDirectiveSweepOnce(deps);
  assert.equal(summary.planned, 1);
  assert.equal(summary.persistError, null);
  assert.equal(summary.errors.filter((e) => /state write failed/.test(e)).length, 0);
});

await resetTmp();
await t("K13 a corrupt state file is surfaced; a missing one stays silent", async () => {
  const { issues, comments } = plannableIssue();
  const corrupt = makeSweepDeps({
    issues,
    comments,
    extra: { _fs: { readFile: async () => "{ this is not json", writeFile: async () => {} } },
  });
  const s1 = await runDirectiveSweepOnce(corrupt.deps);
  assert.ok(s1.stateReadError, "a corrupt read is named");
  assert.equal(s1.errors.filter((e) => /state read failed/.test(e)).length, 1);

  // ENOENT is the normal first run and must not look like a fault.
  const fresh = makeSweepDeps({
    issues: plannableIssue().issues,
    comments: plannableIssue().comments,
    extra: {
      _fs: {
        readFile: async () => { const e = new Error("missing"); e.code = "ENOENT"; throw e; },
        writeFile: async () => {},
      },
    },
  });
  const s2 = await runDirectiveSweepOnce(fresh.deps);
  assert.equal(s2.stateReadError, null, "a first run is not an error");
  assert.equal(s2.errors.filter((e) => /state read failed/.test(e)).length, 0);
});

await t("K14 readStateOutcome separates a missing file from a corrupt one", () => {
  const enoent = new Error("missing"); enoent.code = "ENOENT";
  assert.equal(readStateOutcome(enoent), null);
  assert.equal(readStateOutcome(null), null);
  const corrupt = new SyntaxError("Unexpected token t in JSON at position 2");
  assert.match(String(readStateOutcome(corrupt)), /Unexpected token/);
  const denied = new Error("denied"); denied.code = "EACCES";
  assert.equal(readStateOutcome(denied), "EACCES");
});

await t("K15 the plan prompt states the line contract that KOL-73 violated", () => {
  // parsePlan reads OUT OF SCOPE at verifyIdx + 1 and RISK at verifyIdx + 2, so
  // a VERIFY spread over several lines fails as "missing OUT OF SCOPE" - which
  // is exactly how KOL-73's PowerShell here-string plan died. The prompt banned
  // "; & |" and named the allowed commands, but never said the line itself must
  // be one line, so the model had no way to know.
  const prompt = buildPlanPrompt(issue(), { status: "ok", evidence: [] }, null);
  assert.match(prompt, /VERIFY occupies exactly ONE line/);
  assert.match(prompt, /OUT OF SCOPE is the very next line/);
  assert.match(prompt, /here-string/);
  assert.match(prompt, /Nothing may follow the RISK line/);
  // The contract it already stated must still be there.
  assert.match(prompt, /single command starting with node ops-watcher\//);
});

await t("K8 capturePlanForExecution names each failure without running a sweep", () => {
  assert.equal(capturePlanForExecution([]).reason, "plan-comment-missing");
  assert.equal(capturePlanForExecution([c("catatan biasa")]).reason, "plan-comment-missing");
  assert.equal(capturePlanForExecution([planComment73("FILES: a.mjs\nSTEPS:\n- x\nVERIFY: y\nOUT OF SCOPE: z\nRISK: low")]).reason, "plan-objective-missing");
  const parseFail = capturePlanForExecution([planComment73(kol73Plan)]);
  assert.equal(parseFail.ok, false);
  assert.equal(parseFail.reason, "plan-parse-failed");
  assert.equal(parseFail.detail, "missing OUT OF SCOPE");
  const good = capturePlanForExecution([planComment73(goodPlan)]);
  assert.equal(good.ok, true);
  assert.equal(good.plan.risk, "low");
});

// ---- W-series: a Paperclip write that was rejected is not a write ----------
// Every one of these used to count as a successful post, because the caller
// tested only `r.networkError`. W1 is the exact shape that made KOL-73's plan
// comment vanish on 2026-09-02T04:58Z while the sweep sent a decision card.

await t("W1 a rejected plan comment posts no card, resets no attempt, and says so", async () => {
  const state = { attempts: { i1: 1 }, lastPlanFailures: {}, lastSweepMs: 0 };
  const comments = { i1: [] };
  const { deps, cards } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-401" })],
    comments,
    stateFile: "memory-state-w1",
    extra: {
      _fs: memoryStateFs(state),
      // Paperclip refused the write. networkError is false: this is the shape
      // that used to read as success.
      httpPost: async () => ({ status: 401, body: null, authRequired: true, networkError: false }),
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 0);
  assert.equal(cards.length, 0, "no decision card may be sent for a comment that was never stored");
  assert.equal(res.errors.some((e) => /plan comment NOT posted/.test(e)), true);
  assert.equal(res.errors.some((e) => /auth required/.test(e)), true);
});

await t("W2 a 500 on the plan comment is a failure, not a plan", async () => {
  const state = { attempts: {}, lastPlanFailures: {}, lastSweepMs: 0 };
  const { deps, cards } = makeSweepDeps({
    issues: [issue({ id: "i1" })],
    comments: { i1: [] },
    stateFile: "memory-state-w2",
    extra: {
      _fs: memoryStateFs(state),
      httpPost: async () => ({ status: 500, body: "boom", networkError: false }),
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 0);
  assert.equal(cards.length, 0);
  assert.equal(res.errors.some((e) => /plan comment NOT posted \(rejected \(status 500\)\)/.test(e)), true);
});

await t("W3 judgeWrite separates a stored write from a rejected one", async () => {
  const { judgeWrite } = await import("./write-delivery.mjs");
  assert.equal(judgeWrite({ status: 201, body: {} }).ok, true);
  assert.equal(judgeWrite({ status: 401, authRequired: true, body: null }).ok, false);
  assert.equal(judgeWrite({ status: 503, body: null }).ok, false);
  assert.equal(judgeWrite({ networkError: true, networkErrorMessage: "ECONNREFUSED" }).ok, false);
  assert.equal(judgeWrite({ comment: null }).ok, false);
  assert.equal(judgeWrite({ comment: { id: "c1" } }).ok, true);
  assert.equal(judgeWrite(undefined).ok, false);
});

// ---- C-series: decision-card delivery and Telegram Markdown safety ------

await t("C0 decision card escapes Telegram Markdown entity starts from plan and issue values", () => {
  const text = buildDecisionCardText(issue({ identifier: "KOL_36", title: "Fix owner_card [KOL_36]" }), {
    objective: "Handle owner_card safely",
    files: ["src/a_b.mjs"],
    steps: ["Run `node` and inspect [payload]"],
    outOfScope: "Do not touch .env* files",
    verify: "node ops-watcher/run_all_tests.mjs --grep `card`",
    risk: "low_risk",
  });
  assert.equal(text.includes("KOL\\_36 — Fix owner"), true, "identifier is escaped");
  assert.equal(text.includes("Fix owner\\_card \\[KOL\\_36]"), true, "title is escaped");
  assert.equal(text.includes("Handle owner\\_card safely"), true, "objective is escaped");
  assert.equal(text.includes("src/a\\_b.mjs"), true, "file underscore is escaped");
  assert.equal(text.includes("Run \\`node\\` and inspect \\[payload]"), true, "step backticks and opening bracket are escaped");
  assert.equal(text.includes("Do not touch .env\\* files"), true, "the exact .env* production breaker is escaped");
  assert.equal(text.includes("node ops-watcher/run\\_all\\_tests.mjs --grep \\`card\\`"), true, "verify command is escaped");
  assert.equal(text.includes("low\\_risk"), true, "risk is escaped");
});

await t("C0 normal decision card text does not gain Markdown escape backslashes", () => {
  const text = buildDecisionCardText(issue({ title: "Directive card" }), parsePlan(goodPlan));
  assert.equal(text.includes("\\"), false);
});

// A plan comment that stands while its card failed leaves the directive
// classified as awaiting-approval on a question nobody was asked. The card is
// retried from the stored plan; planning is never repeated, because that costs
// a lane call and the plan already exists.

await t("C1 a failed decision card is recorded as pending, not silently dropped", async () => {
  const state = { attempts: {}, lastPlanFailures: {}, pendingCards: {}, lastSweepMs: 0 };
  const stateFs = memoryStateFs(state);
  const { deps, posts } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-77" })],
    comments: { i1: [] },
    stateFile: "memory-state-c1",
    extra: {
      _fs: stateFs,
      sendDecisionCard: async () => ({ sent: false, reason: '{"ok":false,"error_code":401}' }),
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.planned, 1);
  assert.equal(contentPosts(posts).length, 1, "the plan comment still stands");
  assert.equal(res.errors.some((e) => /card-failed/.test(e)), true);
  const saved = JSON.parse(await stateFs.readFile());
  assert.equal(!!saved.pendingCards.i1, true, "the undelivered card must be remembered");
  assert.equal(saved.pendingCards.i1.attempts, 1);
});

await t("C2 a card that threw is judged the same as one that was refused", async () => {
  const state = { attempts: {}, lastPlanFailures: {}, pendingCards: {}, lastSweepMs: 0 };
  const stateFs = memoryStateFs(state);
  const { deps } = makeSweepDeps({
    issues: [issue({ id: "i1" })],
    comments: { i1: [] },
    stateFile: "memory-state-c2",
    extra: {
      _fs: stateFs,
      sendDecisionCard: async () => { throw new Error("socket hang up"); },
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.errors.some((e) => /card-failed \(socket hang up\)/.test(e)), true);
  const saved = JSON.parse(await stateFs.readFile());
  assert.equal(!!saved.pendingCards.i1, true);
});

await t("C3 the next sweep re-sends the pending card from the stored plan, without re-planning", async () => {
  const state = {
    attempts: {},
    lastPlanFailures: {},
    pendingCards: { i1: { reason: "401", since: "2026-09-01T09:40:00.000Z", lastAttemptAt: "2026-09-01T09:40:00.000Z", attempts: 1 } },
    lastSweepMs: 0,
  };
  const stateFs = memoryStateFs(state);
  let planned = 0;
  const { deps, cards, posts } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-77" })],
    comments: { i1: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`)] },
    stateFile: "memory-state-c3",
    extra: {
      _fs: stateFs,
      dispatchPlan: async () => { planned += 1; return { ok: true, stdout: goodPlan, stderr: "", timedOut: false }; },
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(planned, 0, "a retry must not cost a lane call");
  assert.equal(posts.length, 0, "a retry must not post a second plan comment");
  assert.equal(cards.length, 1, "the owner finally gets the card");
  assert.equal(res.cardsRetried, 1);
  const saved = JSON.parse(await stateFs.readFile());
  assert.equal(saved.pendingCards.i1, undefined, "a delivered card clears the pending marker");
});

await t("C4 a retry that fails again stays queued and says why", async () => {
  const state = {
    attempts: {},
    lastPlanFailures: {},
    pendingCards: { i1: { reason: "401", since: "2026-09-01T09:40:00.000Z", lastAttemptAt: "2026-09-01T09:40:00.000Z", attempts: 1 } },
    lastSweepMs: 0,
  };
  const stateFs = memoryStateFs(state);
  const { deps } = makeSweepDeps({
    issues: [issue({ id: "i1" })],
    comments: { i1: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`)] },
    stateFile: "memory-state-c4",
    extra: {
      _fs: stateFs,
      sendDecisionCard: async () => ({ sent: false, reason: "still unauthorized" }),
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.cardsRetried, 0);
  assert.equal(res.errors.some((e) => /card-retry-failed \(still unauthorized\)/.test(e)), true);
  const saved = JSON.parse(await stateFs.readFile());
  assert.equal(!!saved.pendingCards.i1, true, "an undelivered card stays queued");
  assert.equal(saved.pendingCards.i1.attempts, 2, "the retry counts");
});

await t("C5 an ordinary awaiting-approval directive sends no card at all", async () => {
  const state = { attempts: {}, lastPlanFailures: {}, pendingCards: {}, lastSweepMs: 0 };
  const { deps, cards, posts } = makeSweepDeps({
    issues: [issue({ id: "i1" })],
    comments: { i1: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`)] },
    stateFile: "memory-state-c5",
    extra: { _fs: memoryStateFs(state) },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(cards.length, 0, "no pending marker means the owner already has the card");
  assert.equal(posts.length, 0);
  assert.equal(res.cardsRetried, 0);
});

await t("C6 a pending card whose stored plan is unreadable is reported, not retried blindly", async () => {
  const state = {
    attempts: {},
    lastPlanFailures: {},
    pendingCards: { i1: { reason: "401", since: "2026-09-01T09:40:00.000Z", lastAttemptAt: "2026-09-01T09:40:00.000Z", attempts: 1 } },
    lastSweepMs: 0,
  };
  const brokenPlan = goodPlan.replace(/^OUT OF SCOPE: .+$/m, "");
  const logs = [];
  const { deps, cards } = makeSweepDeps({
    issues: [issue({ id: "i1" })],
    comments: { i1: [c(`${PLAN_MARKER} (iso):\n${brokenPlan}`)] },
    stateFile: "memory-state-c6",
    extra: { _fs: memoryStateFs(state), log: (m) => logs.push(m) },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(cards.length, 0);
  assert.equal(res.cardsRetried, 0);
  assert.equal(logs.some((l) => /card retry skipped/.test(l)), true);
});


await t("O1 capturePlanForExecution reads the newest parseable plan from newest-first comments", async () => {
  const newerPlan = goodPlan.replace("Menyiapkan perubahan kecil yang diminta owner.", "Menyiapkan normalisasi komentar terbaru untuk Paperclip.");
  const olderPlan = goodPlan
    .replace("Menyiapkan perubahan kecil yang diminta owner.", "Membaca rencana lama yang tidak boleh dipakai.")
    .replace(/^OUT OF SCOPE: .+$/m, "")
    .replace("RISK: low", "RISK: high");
  const comments = [
    c(`${PLAN_MARKER} (2026-09-02T10:00:00.000Z):\n${newerPlan}`, "2026-09-02T10:00:00.000Z"),
    c(`${PLAN_MARKER} (2026-09-01T09:00:00.000Z):\n${olderPlan}`, "2026-09-01T09:00:00.000Z"),
  ];
  const captured = capturePlanForExecution(comments);
  assert.equal(captured.ok, true);
  assert.match(captured.plan.objective, /komentar terbaru/);
  assert.equal(captured.plan.risk, "low");
});

await t("O2 capturePlanForExecution gives the same verdict for oldest-first comments", async () => {
  const newerPlan = goodPlan.replace("Menyiapkan perubahan kecil yang diminta owner.", "Menyiapkan normalisasi komentar terbaru untuk Paperclip.");
  const olderPlan = goodPlan
    .replace("Menyiapkan perubahan kecil yang diminta owner.", "Membaca rencana lama yang tidak boleh dipakai.")
    .replace(/^OUT OF SCOPE: .+$/m, "")
    .replace("RISK: low", "RISK: high");
  const newestFirst = [
    c(`${PLAN_MARKER} (2026-09-02T10:00:00.000Z):\n${newerPlan}`, "2026-09-02T10:00:00.000Z"),
    c(`${PLAN_MARKER} (2026-09-01T09:00:00.000Z):\n${olderPlan}`, "2026-09-01T09:00:00.000Z"),
  ];
  const oldestFirst = newestFirst.slice().reverse();
  const fromNewestFirst = capturePlanForExecution(newestFirst);
  const fromOldestFirst = capturePlanForExecution(oldestFirst);
  assert.deepEqual(fromOldestFirst, fromNewestFirst);
  assert.match(fromOldestFirst.plan.objective, /komentar terbaru/);
});

await t("O3 classifyDirective does not let an old approval authorize a newer plan", async () => {
  const comments = [
    c(`${PLAN_MARKER} (2026-09-02T10:00:00.000Z):\n${goodPlan}`, "2026-09-02T10:00:00.000Z"),
    c(`${APPROVED_MARKER}: lanjutkan rencana lama`, "2026-09-01T09:30:00.000Z"),
    c(`${PLAN_MARKER} (2026-09-01T09:00:00.000Z):\n${goodPlan}`, "2026-09-01T09:00:00.000Z"),
  ];
  const classified = classifyDirective(issue(), comments, { now: NOW });
  assert.equal(classified.state, "awaiting-approval");
  assert.equal(classified.reason, "plan posted, awaiting owner decision");
});

await t("O4 commentsOldestFirst sorts stably and leaves unsafe input unchanged", async () => {
  const a = c("a", "2026-09-01T09:10:00.000Z");
  const b = c("b", "2026-09-01T09:00:00.000Z");
  const cSame = c("c", "2026-09-01T09:00:00.000Z");
  const d = c("d", "2026-09-01T09:20:00.000Z");
  const sorted = commentsOldestFirst([a, b, cSame, d]);
  assert.deepEqual(sorted.map((x) => x.body), ["b", "c", "a", "d"]);

  const missingCreatedAt = [a, { id: "missing", body: "missing createdAt" }, b];
  assert.strictEqual(commentsOldestFirst(missingCreatedAt), missingCreatedAt);
  assert.deepEqual(missingCreatedAt.map((x) => x.body), ["a", "missing createdAt", "b"]);

  const invalidCreatedAt = [a, { id: "invalid", body: "invalid createdAt", createdAt: "not-a-date" }, b];
  assert.strictEqual(commentsOldestFirst(invalidCreatedAt), invalidCreatedAt);
  assert.deepEqual(invalidCreatedAt.map((x) => x.body), ["a", "invalid createdAt", "b"]);
});

await resetTmp();
await t("O5 runDirectiveSweepOnce accepts newest-first approved comments without re-reading the old broken plan", async () => {
  const state = { attempts: {}, lastPlanFailures: {}, pendingCards: {}, lastSweepMs: 0 };
  const newerPlan = goodPlan.replace("Menyiapkan perubahan kecil yang diminta owner.", "Menjalankan rencana terbaru yang sudah disetujui.");
  const olderPlan = goodPlan
    .replace("Menyiapkan perubahan kecil yang diminta owner.", "Membaca rencana lama yang rusak.")
    .replace(/^OUT OF SCOPE: .+$/m, "");
  const comments = {
    i1: [
      c(`${APPROVED_MARKER}: lanjutkan rencana terbaru`, "2026-09-02T10:10:00.000Z"),
      c(`${PLAN_MARKER} (2026-09-02T10:00:00.000Z):\n${newerPlan}`, "2026-09-02T10:00:00.000Z"),
      c(`${APPROVED_MARKER}: lanjutkan rencana lama`, "2026-09-01T09:30:00.000Z"),
      c(`${PLAN_MARKER} (2026-09-01T09:00:00.000Z):\n${olderPlan}`, "2026-09-01T09:00:00.000Z"),
    ],
  };
  const { deps, getExecuteCalls } = makeSweepDeps({
    issues: [issue({ id: "i1", identifier: "KOL-O5" })],
    comments,
    extra: { _fs: memoryStateFs(state) },
  });
  const summary = await runDirectiveSweepOnce(deps);
  assert.equal(summary.approved.length, 1);
  assert.equal(summary.approved[0].identifier, "KOL-O5");
  assert.equal(summary.unexecutable.length, 0);
  assert.equal(summary.errors.some((e) => /plan-parse-failed/.test(e)), false);
  assert.equal(getExecuteCalls(), 1);
});

// ---- Q-series: a VERIFY argument that contains spaces -----------------------
// nodeCommandToArgv used to be split(/\s+/), so any quoted argument was
// shattered and its quotes were left attached to the fragments. KOL-73's plan
// hit this on 2026-09-02: its VERIFY regex arrived as seven arguments, never
// matched, and the executor reverted work that was actually correct.

await t("Q1 a quoted argument containing spaces stays one argument", () => {
  const argv = nodeCommandToArgv('node ops-watcher/verify-file.mjs --path a.txt --matches "^AHMAD E2E SOAK TEST PASS - [0-9]{4}"');
  assert.deepEqual(argv, [
    "ops-watcher/verify-file.mjs",
    "--path",
    "a.txt",
    "--matches",
    "^AHMAD E2E SOAK TEST PASS - [0-9]{4}",
  ]);
});

await t("Q2 single quotes group the same way and are stripped", () => {
  const argv = nodeCommandToArgv("node x.mjs --contains 'two words'");
  assert.deepEqual(argv, ["x.mjs", "--contains", "two words"]);
});

await t("Q3 a backslash is literal, so Windows paths survive intact", () => {
  const argv = nodeCommandToArgv('node ops-watcher\\verify-file.mjs --path "C:\\tmp\\a b.txt"');
  assert.deepEqual(argv, ["ops-watcher\\verify-file.mjs", "--path", "C:\\tmp\\a b.txt"]);
});

await t("Q4 an explicitly empty quoted argument is kept, not dropped", () => {
  assert.deepEqual(nodeCommandToArgv('node x.mjs --matches ""'), ["x.mjs", "--matches", ""]);
});

await t("Q5 unquoted commands tokenise exactly as before", () => {
  assert.deepEqual(
    nodeCommandToArgv("node ops-watcher/run-all-tests.mjs --only x.test.mjs"),
    ["ops-watcher/run-all-tests.mjs", "--only", "x.test.mjs"],
  );
  assert.deepEqual(nodeCommandToArgv("  node   a.mjs   b  "), ["a.mjs", "b"]);
  assert.deepEqual(nodeCommandToArgv(""), []);
  assert.deepEqual(nodeCommandToArgv(null), []);
});

await t("Q6 an unterminated quote keeps the rest of the line instead of losing it", () => {
  assert.deepEqual(nodeCommandToArgv('node x.mjs --matches "abc def'), ["x.mjs", "--matches", "abc def"]);
});

await t("Q7 the executor's VERIFY runs the command the plan actually wrote", async () => {
  // The seam the executor uses: runVerify receives the VERIFY string and the
  // default binding tokenises it. Assert on the argv the tokeniser produces for
  // the exact VERIFY line KOL-73 was reverted on.
  const verify = 'node ops-watcher/verify-file.mjs --path ops-watcher/e2e-soak/soak-test-2026-08-31.txt --matches "^AHMAD E2E SOAK TEST PASS - [0-9]{4}-[0-9]{2}-[0-9]{2}T"';
  const argv = nodeCommandToArgv(verify);
  assert.equal(argv.length, 5, "five arguments, not eleven");
  assert.equal(argv[4], "^AHMAD E2E SOAK TEST PASS - [0-9]{4}-[0-9]{2}-[0-9]{2}T");
  assert.equal(argv[4].includes('"'), false, "the quotes must not survive into the argument");
});

// ---- S-series: the status patch on a finished directive ---------------------
// KOL-73 finished at 2026-09-02T06:08Z with its DIRECTIVE RESULT comment posted
// and DONE_VERIFIED applied, and its status still 'todo'. The default binding
// POSTed to /api/issues/:id — not the update endpoint — and nobody read the
// reply. S1 exercises the DEFAULT, uninjected binding, which is where the bug
// lived; every existing test injects patchIssue and so could never see it.

await t("S1 the default status patch uses PATCH /api/issues/:id, never POST", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const comments = { kol70: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)] };
  const patchCalls = [];
  const postUrls = [];
  const { deps } = makeSweepDeps({
    issues: [issue({ id: "kol70", identifier: "KOL-70" })],
    comments,
    extra: {
      // No patchIssue: force the real default binding.
      patchIssue: undefined,
      addIssueLabel: async () => ({ ok: true }),
      executeDirective: async () => ({ outcome: "done", filesChanged: ["ops-watcher/foo.mjs"], verifyTail: "ok" }),
      httpPatch: async (url, patch) => { patchCalls.push({ url, patch }); return { status: 200, body: { id: "kol70", ...patch }, networkError: false }; },
      httpPost: async (url, body2) => {
        postUrls.push(url);
        const id = url.match(/\/api\/issues\/([^/]+)\/comments$/)?.[1];
        if (!id) return { status: 404, body: null, networkError: false };
        comments[id] = comments[id] || [];
        comments[id].push({ id: `p${postUrls.length}`, body: body2.body, createdAt: new Date(NOW).toISOString() });
        return { status: 201, body: comments[id].at(-1), networkError: false };
      },
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.executed, 1);
  assert.equal(patchCalls.length, 1, "the status update must go through httpPatch");
  assert.match(patchCalls[0].url, /\/api\/issues\/kol70$/);
  assert.deepEqual(patchCalls[0].patch, { status: "done" });
  assert.equal(
    postUrls.some((u) => /\/api\/issues\/kol70$/.test(u)),
    false,
    "nothing may POST to the issue URL - that is not the update endpoint",
  );
  assert.equal(res.errors.length, 0);
});

await t("S2 a rejected status patch is reported, not swallowed", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const comments = { kol70: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)] };
  const { deps, posts } = makeSweepDeps({
    issues: [issue({ id: "kol70", identifier: "KOL-70" })],
    comments,
    extra: {
      executeDirective: async () => ({ outcome: "done", filesChanged: ["ops-watcher/foo.mjs"], verifyTail: "ok" }),
      patchIssue: async () => ({ status: 401, body: null, authRequired: true, networkError: false }),
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.executed, 1, "the work itself did finish");
  assert.equal(posts.filter((p) => /^DIRECTIVE RESULT/.test(p.body.body)).length, 1, "the result comment still stands");
  assert.equal(res.errors.some((e) => /status NOT set to done/.test(e)), true);
  assert.equal(res.errors.some((e) => /auth required/.test(e)), true);
});

await t("S3 a DONE_VERIFIED label that did not land is reported", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const comments = { kol70: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)] };
  const { deps } = makeSweepDeps({
    issues: [issue({ id: "kol70", identifier: "KOL-70" })],
    comments,
    extra: {
      executeDirective: async () => ({ outcome: "done", filesChanged: ["ops-watcher/foo.mjs"], verifyTail: "ok" }),
      // addIssueLabelReal reports failure this way instead of throwing.
      addIssueLabel: async () => ({ ok: false, reason: "status 404" }),
    },
  });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.errors.some((e) => /DONE_VERIFIED label NOT added \(status 404\)/.test(e)), true);
});

// === L. SINGLE-INSTANCE SWEEP LOCK (P1) ===
// directive-runner is the ONLY component that changes files and was the only
// one of the four sweeps without a cross-process lock, while the heartbeat
// fires it every five minutes unattended.

await t("L1 a sweep held by a LIVE holder is refused, and reads nothing", async () => {
  await resetTmp();
  // A lock file naming a pid that is certainly alive: this process.
  await fs.writeFile(TMP_LOCK, JSON.stringify({ pid: process.pid, startedAt: new Date(NOW).toISOString() }));
  let reads = 0, lists = 0;
  const { deps } = makeSweepDeps({ issues: [issue({ id: "kol90", identifier: "KOL-90" })], comments: {} });
  const res = await runDirectiveSweepOnce({
    ...deps,
    listIssues: async () => { lists++; return { issues: [], networkError: false }; },
    httpGet: async () => { reads++; return { body: [], networkError: false }; },
  });
  assert.equal(res.lockRefused, true, "a live holder must refuse the sweep");
  assert.equal(res.pid, process.pid);
  assert.equal(lists, 0, "a refused sweep must not list issues");
  assert.equal(reads, 0, "a refused sweep must not read comments");
  // The refusal must NOT delete the live holder's lock.
  assert.equal((await fs.readFile(TMP_LOCK, "utf8")).includes(String(process.pid)), true);
  await clearTempLock();
});

await t("L2 a completed sweep releases the lock, so the next sweep runs", async () => {
  await resetTmp();
  const mk = () => makeSweepDeps({ issues: [issue({ id: "kol91", identifier: "KOL-91" })], comments: { kol91: [] } });
  const first = await runDirectiveSweepOnce(mk().deps);
  assert.equal(first.lockRefused, undefined, "the first sweep must not be refused");
  assert.equal(await fs.access(TMP_LOCK).then(() => true, () => false), false, "the lock must be released after the sweep");
  const second = await runDirectiveSweepOnce(mk().deps);
  assert.equal(second.lockRefused, undefined, "the second sweep must acquire the released lock");
});

await t("L3 a sweep that THROWS still releases the lock", async () => {
  await resetTmp();
  const { deps } = makeSweepDeps({ issues: [], comments: {} });
  const res = await runDirectiveSweepOnce({
    ...deps,
    // activeVentures is resolved before the sweep's own try/catch.
    activeVentures: async () => { throw new Error("boom"); },
  }).catch((e) => ({ threw: String(e && e.message) }));
  assert.ok(res, "the sweep returned or threw");
  assert.equal(await fs.access(TMP_LOCK).then(() => true, () => false), false, "a thrown sweep must not leave the lock behind");
});

await t("L4 an unknown lock state refuses rather than running unguarded", async () => {
  await resetTmp();
  let lists = 0;
  const { deps } = makeSweepDeps({ issues: [], comments: {} });
  const res = await runDirectiveSweepOnce({
    ...deps,
    listIssues: async () => { lists++; return { issues: [], networkError: false }; },
    acquireLock: async () => { throw new Error("disk gone"); },
  });
  assert.equal(res.lockRefused, true, "a lock-layer failure must refuse, not proceed");
  assert.equal(res.error, "lock-failed");
  assert.equal(lists, 0, "a lock-failed sweep must not touch Paperclip");
});

await t("L5 the sweep lock is a REAL file on its own path, not the other runners'", async () => {
  await resetTmp();
  let sawLockDuringSweep = null;
  const { deps } = makeSweepDeps({ issues: [], comments: {} });
  await runDirectiveSweepOnce({
    ...deps,
    // Observed from inside the sweep: the lock exists while the sweep runs.
    listIssues: async () => {
      sawLockDuringSweep = await fs.readFile(TMP_LOCK, "utf8").catch(() => null);
      return { issues: [], networkError: false };
    },
  });
  assert.ok(sawLockDuringSweep, "the lock file must exist while the sweep runs");
  assert.equal(JSON.parse(sawLockDuringSweep).pid, process.pid);
  assert.notEqual(path.basename(TMP_LOCK), "review-runner.lock");
  assert.notEqual(path.basename(TMP_LOCK), "test-runner.lock");
});

// E2 of the 2026-09-05 health diagnosis. Measured on this machine: 32,600
// characters spawn, 32,700 fail with ENAMETOOLONG and produce NO output at all.
// The silence is the danger — it reads as "the lane said nothing" when the
// truth is that the packet never left this process.
await t("E2 an over-long packet is refused with a stated reason, not delivered into silence", async () => {
  assert.equal(commandLineTooLong(["ops-watcher/corleone-dispatch.mjs", "a short prompt"], { execPath: "node" }), null,
    "an ordinary packet is not touched");

  const msg = commandLineTooLong(["ops-watcher/corleone-dispatch.mjs", "x".repeat(40000)], { execPath: "node" });
  assert.ok(msg, "an over-long packet is caught before spawn");
  assert.match(msg, /NOT delivered/, "the message says the packet never arrived");
  assert.match(msg, /not a lane failure/, "and that the lane is not the thing that failed");

  // The cap covers the whole line: the interpreter path and the wrapper path
  // are on it too, not just the prompt.
  assert.equal(commandLineTooLong(["w.mjs", "x".repeat(100)], { execPath: "node", limit: 120 }), null);
  assert.ok(commandLineTooLong(["w.mjs", "x".repeat(120)], { execPath: "node", limit: 120 }),
    "the interpreter and wrapper paths count against the same cap");
});

await resetTmp();

console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
