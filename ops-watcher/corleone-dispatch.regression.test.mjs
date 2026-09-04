// Offline regression coverage for ops-watcher/corleone-dispatch.mjs.
// No real Codex spawn, no network, no account usage: spawn/log/guard are injected.
// Run with:
//   node ops-watcher/corleone-dispatch.regression.test.mjs

import assert from "node:assert/strict";

const mod = await import("./corleone-dispatch.mjs");

let passed = 0;
let failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(`  ${e && e.stack ? e.stack : e}`);
  failures.push(n);
  failed++;
};

function makeDeps(spawnResult, overrides = {}) {
  const calls = [];
  const usage = [];
  const outcomes = [];
  return {
    calls,
    usage,
    outcomes,
    spawnSync: (file, args, options) => {
      calls.push({ file, args, options });
      return spawnResult;
    },
    logLaneUsage: async (record) => { usage.push(record); },
    recordLaneOutcome: async (lane, outcome) => { outcomes.push({ lane, outcome }); },
    guardLaneStart: async () => ({ skip: false }),
    resolveCodexEntry: () => null,
    now: (() => {
      let t = 1000;
      return () => { t += 25; return t; };
    })(),
    ...overrides,
  };
}

async function t1_buildsNodeBackedInvocationForWindowsShim() {
  assert.equal(typeof mod.buildCodexInvocation, "function", "buildCodexInvocation is exported");
  const prompt = "alpha beta \"quoted\" %PATH% && still-one-arg";
  const codexJs = "C:\\Users\\WIN10\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js";
  const invocation = mod.buildCodexInvocation(prompt, { codexJs });

  assert.equal(invocation.file, process.execPath, "Windows shim path runs through node directly");
  assert.deepEqual(invocation.args, [codexJs, "exec", "-s", "workspace-write", prompt]);
  assert.equal(invocation.args.at(-1), prompt, "the free-form prompt stays one argv element");
  assert.ok(!("shell" in invocation.options), "the invocation does not opt into shell parsing");
  ok("T1: Windows codex.cmd shim is bypassed without shell parsing the prompt");
}

async function t2_buildsDirectCodexInvocationWithoutShim() {
  assert.equal(typeof mod.buildCodexInvocation, "function", "buildCodexInvocation is exported");
  const prompt = "plain prompt";
  const invocation = mod.buildCodexInvocation(prompt, { codexJs: null });

  assert.equal(invocation.file, "codex");
  assert.deepEqual(invocation.args, ["exec", "-s", "workspace-write", prompt]);
  assert.equal(invocation.args.at(-1), prompt, "the prompt is still one argv element");
  assert.ok(!("shell" in invocation.options), "direct codex invocation also stays shell:false by default");
  ok("T2: direct Codex invocation keeps the safe argv shape");
}

async function t3_successLogsChildOutputForLaneUsageDetail() {
  assert.equal(typeof mod.dispatchCorleone, "function", "dispatchCorleone is exported");
  const deps = makeDeps({ status: 0, stdout: "final answer\n", stderr: "debug line\n" });
  const result = await mod.dispatchCorleone("do work", deps);

  assert.equal(result.ok, true, "success returns ok");
  assert.equal(result.exitCode, 0);
  assert.equal(deps.usage.length, 1, "one usage record logged");
  assert.equal(deps.usage[0].lane, "corleone");
  assert.equal(deps.usage[0].stdout, "final answer\n", "stdout is passed through for byte accounting");
  assert.equal(deps.usage[0].stderr, "debug line\n", "stderr is passed through for byte accounting");
  assert.equal(deps.usage[0].durationMs, 25, "duration comes from injected clock");
  ok("T3: successful runs pass child stdout/stderr into lane usage detail");
}

async function t4_nonZeroExitLogsChildOutputForLaneUsageDetail() {
  const deps = makeDeps({ status: 1, stdout: "partial transcript", stderr: "unexpected argument 'with'\n" });
  const result = await mod.dispatchCorleone("bad prompt", deps);

  assert.equal(result.ok, false, "non-zero exit returns red");
  assert.equal(result.exitCode, 1);
  assert.equal(deps.outcomes[0].outcome.stdout, "partial transcript");
  assert.equal(deps.outcomes[0].outcome.stderr, "unexpected argument 'with'\n");
  assert.equal(deps.usage[0].ok, false);
  assert.equal(deps.usage[0].exitCode, 1);
  assert.equal(deps.usage[0].stdout, "partial transcript");
  assert.equal(deps.usage[0].stderr, "unexpected argument 'with'\n");
  ok("T4: non-zero exits log child output so failures are diagnosable");
}

async function t5_timeoutLogsTimedOutAndPartialOutput() {
  const deps = makeDeps({ status: null, signal: "SIGTERM", stdout: "partial before kill", stderr: "working...\n" }, { timeoutMs: 123 });
  const result = await mod.dispatchCorleone("slow task", deps);

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(deps.outcomes[0].outcome.timedOut, true);
  assert.equal(deps.usage[0].timedOut, true);
  assert.equal(deps.usage[0].exitCode, 1);
  assert.equal(deps.usage[0].stdout, "partial before kill");
  assert.equal(deps.usage[0].stderr, "working...\n");
  ok("T5: timeouts log timedOut plus partial child output");
}

async function t6_spawnErrorLogsOutputAndErrorMessage() {
  const err = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
  const deps = makeDeps({ status: null, stdout: "", stderr: "", error: err });
  const result = await mod.dispatchCorleone("start", deps);

  assert.equal(result.ok, false);
  assert.equal(result.stderr, "spawn codex ENOENT");
  assert.equal(deps.usage[0].ok, false);
  assert.equal(deps.usage[0].stdout, "");
  assert.equal(deps.usage[0].stderr, "spawn codex ENOENT");
  ok("T6: spawn errors are logged with the error message as stderr detail");
}

async function t7_laneGuardSkipDoesNotSpawn() {
  const deps = makeDeps({ status: 0, stdout: "must not run", stderr: "" }, {
    guardLaneStart: async () => ({ skip: true, reason: "cooldown", remainingMs: 61_000 }),
  });
  const result = await mod.dispatchCorleone("guarded", deps);

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(deps.calls.length, 0, "no codex spawn while guarded");
  assert.deepEqual(deps.usage[0].extra, { skipped: true, reason: "cooldown" });
  ok("T7: lane guard skip is recorded and does not spawn Codex");
}

async function main() {
  console.log("# corleone-dispatch regression tests");
  const tests = [
    t1_buildsNodeBackedInvocationForWindowsShim,
    t2_buildsDirectCodexInvocationWithoutShim,
    t3_successLogsChildOutputForLaneUsageDetail,
    t4_nonZeroExitLogsChildOutputForLaneUsageDetail,
    t5_timeoutLogsTimedOutAndPartialOutput,
    t6_spawnErrorLogsOutputAndErrorMessage,
    t7_laneGuardSkipDoesNotSpawn,
  ];

  for (const t of tests) {
    try {
      await t();
    } catch (e) {
      bad(t.name, e);
    }
  }

  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("regression runner crashed:", e);
  process.exit(1);
});
