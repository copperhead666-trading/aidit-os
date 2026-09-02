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
  validateVerifyCommand,
  runDirectiveSweepOnce,
  capturePlanForExecution,
  readStateOutcome,
  UNEXECUTABLE_MARKER,
  buildExecutionPrompt,
  executeApprovedDirective,
  PLAN_MARKER,
  APPROVED_MARKER,
  REJECTED_MARKER,
  RESULT_MARKER,
  DISPATCH_MARKER,
  DEFAULT_STALLED_AFTER_MS,
  DEFAULT_MAX_PLAN_ATTEMPTS,
  MAX_EXECUTIONS_PER_SWEEP,
  SWEEP_MIN_INTERVAL_MS,
} from "./directive-runner.mjs";
import { verifyFile } from "./verify-file.mjs";

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
    ...extra,
  };
  return { deps, posts, cards, messages, patches, labels, spies, getExecuteCalls: () => executeCalls };
}
async function resetTmp() { await fs.unlink(TMP_STATE).catch(() => {}); }
function memoryStateFs(initial) {
  let data = JSON.stringify(initial);
  return {
    readFile: async () => data,
    writeFile: async (_file, body) => { data = String(body); },
  };
}

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
  assert.equal(posts.length, 1);
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
  assert.equal(posts.length, 1);
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
  assert.equal(posts.length, 1);
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
  assert.equal(posts.length, 1);
  assert.match(posts[0].body.body, /^DIRECTIVE OWNER REQUIRED/);
  assert.match(posts[0].body.body, /setelah 2 percobaan/);
  assert.match(posts[0].body.body, /perintah verifikasi di rencana berada di luar bentuk aman/i);
  assert.match(posts[0].body.body, /memberi arahan yang lebih spesifik/i);
  assert.match(posts[0].body.body, /menutup issue/i);
  assert.doesNotMatch(posts[0].body.body, /verify-out-of-scope/);
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
  assert.equal(first.posts.length, 1);
  assert.equal(second.labels.length, 0);
  assert.equal(second.posts.length, 0);
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
  assert.equal(posts.length, 0);
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
  assert.equal(posts.length, 1);
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
    assert.match(posts[0].body.body, plain);
    assert.doesNotMatch(posts[0].body.body, raw);
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
  assert.equal(posts.length, 1);
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
  assert.equal(posts.length, 1);
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
  assert.equal(posts.length, 1);
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
  assert.match(denied.reason, /denied directory/);
  assert.equal(reads.length, beforeDenied);
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
await t("K4 the report is posted once per approval, not once per five-minute sweep", async () => {
  const ev = evidenceSpy();
  const { issues, comments } = approved73([planComment73(kol73Plan), c(TG_APPROVE, "2026-09-01T09:30:00.000Z")]);
  const { deps, posts } = makeSweepDeps({ issues, comments, extra: { appendEvidence: ev.appendEvidence } });
  await runDirectiveSweepOnce(deps);
  await runDirectiveSweepOnce(deps);
  await runDirectiveSweepOnce(deps);
  assert.equal(unexecutablePosts(posts).length, 1, "the owner is not told the same thing three times");
  // Evidence is a log, not a notification: every sweep still records that the
  // directive could not be captured, so the silence is auditable afterwards.
  assert.equal(ev.records.filter((r) => r.type === "directive-capture-failed").length, 3);
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

await resetTmp();
console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);