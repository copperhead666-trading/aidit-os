// Offline regression tests for ops-watcher/directive-runner.mjs.
// No node:test, no dependencies, no real Paperclip writes, no lane execution,
// no real Telegram send. Every outbound call is injected and stubbed.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyDirective,
  isPlannable,
  findPlanDecision,
  buildDecisionCardText,
  buildPlanPrompt,
  parsePlan,
  validatePlanScope,
  runDirectiveSweepOnce,
  buildExecutionPrompt,
  executeApprovedDirective,
  PLAN_MARKER,
  APPROVED_MARKER,
  REJECTED_MARKER,
  RESULT_MARKER,
  DISPATCH_MARKER,
  DEFAULT_STALLED_AFTER_MS,
} from "./directive-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_STATE = path.join(__dirname, "directive-runner.regression.state.tmp");
const NOW = Date.parse("2026-09-01T10:00:00.000Z");

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

// The EXACT decision-comment prefixes telegram-listener.mjs writes when the
// owner taps APPROVE / REJECT on a decision card (DECISION_COMMENT_PREFIX in
// that file). Reused verbatim here so the test exercises the real wording.
const TG_APPROVE = "OWNER MENYETUJUI via Telegram (2026-09-01T09:30:00.000Z) — ketukan tombol oleh owner via @ahmadsuperbot. Label OWNER_REQUIRED dihapus sehingga alur otomatis dapat dilanjutkan.";
const TG_REJECT = "OWNER MENOLAK via Telegram (2026-09-01T09:30:00.000Z) — ketukan tombol oleh owner via @ahmadsuperbot. Status diubah menjadi cancelled; label OWNER_REJECTED ditambahkan.";

function makeSweepDeps({ issues, comments, plan = goodPlan, stateFile = TMP_STATE, extra = {} }) {
  const posts = [];
  const cards = [];
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
    // Stage 3 executor seam: never called in stage 2. The spy counts calls so
    // tests can assert it stays at zero.
    execute: async () => { executeCalls++; return { ok: true }; },
    stateFile,
    now: NOW,
    log: () => {},
    ...extra,
  };
  return { deps, posts, cards, spies, getExecuteCalls: () => executeCalls };
}

async function resetTmp() { await fs.unlink(TMP_STATE).catch(() => {}); }

async function t(name, fn) {
  try { await fn(); ok(name); } catch (e) { bad(name, e); }
}

await resetTmp();

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

await t("parsePlan parses well-formed plan and rejects missing VERIFY", () => {
  const parsed = parsePlan(goodPlan);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.files, ["ops-watcher/foo.mjs", "docs/bar.md"]);
  assert.equal(parsed.steps.length, 2);
  assert.equal(parsePlan(goodPlan.replace(/^VERIFY: .+\n/m, "")).ok, false);
});

await t("validatePlanScope rejects denied paths and accepts normal repo-relative files", () => {
  const badPlan = { files: ["ventures/x.mjs", "../outside.txt", "C:\\abs\\path.txt", ".env.local", "ops-watcher/heartbeat.mjs"] };
  const res = validatePlanScope(badPlan);
  assert.equal(res.ok, false);
  assert.equal(res.violations.length >= 5, true);
  assert.equal(validatePlanScope({ files: ["ops-watcher/foo.mjs", "docs/bar.md"] }).ok, true);
});

await t("sweep with one new directive posts exactly one plan comment and no execution/Telegram spy", async () => {
  await resetTmp();
  const issues = [issue({ id: "i1", identifier: "KOL-101" })];
  const comments = { i1: [] };
  const { deps, posts, spies } = makeSweepDeps({ issues, comments });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.scanned, 1);
  assert.equal(res.planned, 1);
  assert.equal(posts.length, 1);
  assert.match(posts[0].body.body, /^DIRECTIVE PLAN \(/);
  assert.equal(spies.execute + spies.telegram + spies.git + spies.pm2, 0);
});

await t("scope-violating plan posts refusal comment and no plan comment", async () => {
  await resetTmp();
  const badScope = goodPlan.replace("ops-watcher/foo.mjs, docs/bar.md", "ventures/x.mjs");
  const comments = { i1: [] };
  const { deps, posts } = makeSweepDeps({ issues: [issue({ id: "i1" })], comments, plan: badScope });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.refused, 1);
  assert.equal(posts.length, 1);
  assert.match(posts[0].body.body, /^PLAN_REFUSED/);
  assert.doesNotMatch(posts[0].body.body, /^DIRECTIVE PLAN \(/);
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
  assert.equal(comments.i1.filter((x) => /DIRECTIVE DRAFT FAILED/.test(x.body)).length, 2);
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

await t("an approved directive is reported and NOT executed (execute spy never called)", async () => {
  await resetTmp();
  const planAt = "2026-09-01T09:00:00.000Z";
  const after = "2026-09-01T09:30:00.000Z";
  const issues = [issue({ id: "kol70", identifier: "KOL-70", title: "approved directive" })];
  const comments = { kol70: [c(`${PLAN_MARKER} (iso):\n${goodPlan}`, planAt), c(TG_APPROVE, after)] };
  const { deps, posts, cards, getExecuteCalls } = makeSweepDeps({ issues, comments });
  const res = await runDirectiveSweepOnce(deps);
  assert.equal(res.approved.length, 1);
  assert.equal(res.approved[0].identifier, "KOL-70");
  assert.equal(res.approved[0].approvedAt, after);
  assert.equal(res.planned, 0);
  assert.equal(posts.length, 0);
  assert.equal(cards.length, 0);
  // Stage 2: no execution. The executor seam is never invoked.
  assert.equal(getExecuteCalls(), 0);
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
    stat: 0, appendEvidence: 0, guardLane: 0, recordOutcome: 0, git: 0, pm2: 0,
  };
  let mutated = false;
  const statFile = async (file) => {
    calls.stat++;
    return { size: 100, mtimeMs: mutated ? 2000 : 1000 };
  };
  const deps = {
    lane: "corleone",
    now: NOW,
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
    dispatchExecution: async (/* prompt */) => {
      calls.dispatch++;
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
  };
  return { deps, calls, isMutated: () => mutated, setMutated: (v) => { mutated = v; } };
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
  const { deps, calls } = makeExecDeps();
  const plan = parsePlan(goodPlan);
  const res = await executeApprovedDirective(issue(), plan, deps);
  assert.equal(res.outcome, "done");
  assert.ok(Array.isArray(res.filesChanged) && res.filesChanged.length > 0);
  assert.equal(calls.restore, 0);
  assert.equal(calls.appendEvidence, 1);
  assert.ok(typeof res.verifyTail === "string");
});

await t("executeApprovedDirective: verify red -> reverted verify-red, restoreFiles called with the snapshot", async () => {
  const { deps, calls } = makeExecDeps({ verifyResult: { ok: false, stdout: "", stderr: "AssertionError" } });
  const plan = parsePlan(goodPlan);
  const res = await executeApprovedDirective(issue(), plan, deps);
  assert.equal(res.outcome, "reverted");
  assert.equal(res.reason, "verify-red");
  assert.equal(calls.restore, 1);
  assert.equal(calls.appendEvidence, 1);
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
  const { deps, calls } = makeExecDeps({ mutateOnDispatch: false });
  const plan = parsePlan(goodPlan);
  const res = await executeApprovedDirective(issue(), plan, deps);
  assert.equal(res.outcome, "no-op");
  assert.equal(calls.restore, 0);
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

await resetTmp();
console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);