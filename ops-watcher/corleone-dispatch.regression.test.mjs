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

function jsonl(events) {
  return `${events.map((event) => typeof event === "string" ? event : JSON.stringify(event)).join("\n")}\n`;
}

function realisticJsonlStream() {
  return jsonl([
    { type: "thread.started", thread_id: "session-123" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: {
        type: "message",
        content: [{ type: "output_text", text: "first readable answer" }],
      },
    },
    {
      type: "turn.completed",
      model: "gpt-5",
      usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 4, reasoning_output_tokens: 1, total_tokens: 14 },
    },
    { type: "turn.started" },
    {
      type: "turn.completed",
      model: "gpt-5-codex",
      usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
    },
  ]);
}

async function t1_buildsNodeBackedInvocationForWindowsShim() {
  assert.equal(typeof mod.buildCodexInvocation, "function", "buildCodexInvocation is exported");
  const prompt = "alpha beta \"quoted\" %PATH% && still-one-arg";
  const codexJs = "C:\\Users\\WIN10\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js";
  const invocation = mod.buildCodexInvocation(prompt, { codexJs });

  assert.equal(invocation.file, process.execPath, "Windows shim path runs through node directly");
  assert.deepEqual(invocation.args, [codexJs, "exec", "--json", "-c", "model_reasoning_effort=medium", "-s", "workspace-write", prompt]);
  assert.equal(invocation.args.at(-1), prompt, "the free-form prompt stays one argv element");
  assert.ok(!("shell" in invocation.options), "the invocation does not opt into shell parsing");
  ok("T1: Windows codex.cmd shim is bypassed without shell parsing the prompt");
}

async function t2_buildsDirectCodexInvocationWithoutShim() {
  assert.equal(typeof mod.buildCodexInvocation, "function", "buildCodexInvocation is exported");
  const prompt = "plain prompt";
  const invocation = mod.buildCodexInvocation(prompt, { codexJs: null });

  assert.equal(invocation.file, "codex");
  assert.deepEqual(invocation.args, ["exec", "--json", "-c", "model_reasoning_effort=medium", "-s", "workspace-write", prompt]);
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
  assert.equal(deps.usage[0].turns, null, "unparseable stdout yields a complete record with null turns");
  assert.equal(deps.usage[0].cli.reasoningEffort, "medium", "default effort is logged in cli detail");
  assert.equal(deps.usage[0].cli.model, null, "missing model remains null");
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
  assert.ok(Object.prototype.hasOwnProperty.call(deps.usage[0], "turns"), "timeout usage includes turns");
  assert.ok(Object.prototype.hasOwnProperty.call(deps.usage[0], "cli"), "timeout usage includes cli detail");
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

async function t8_defaultEffortReachesSpawnArgv() {
  const deps = makeDeps({ status: 0, stdout: "", stderr: "" });
  await mod.dispatchCorleone("default effort", deps);

  assert.equal(deps.calls.length, 1, "codex spawned once");
  assert.ok(deps.calls[0].args.includes("--json"), "--json reaches argv");
  assert.ok(deps.calls[0].args.includes("-c"), "-c reaches argv");
  assert.ok(deps.calls[0].args.includes("model_reasoning_effort=medium"), "default effort reaches argv");
  ok("T8: default effort is passed as a per-invocation config override");
}

async function t9_eachExplicitEffortReachesSpawnArgv() {
  for (const effort of ["low", "medium", "high"]) {
    const deps = makeDeps({ status: 0, stdout: "", stderr: "" }, { effort });
    await mod.dispatchCorleone(`effort ${effort}`, deps);

    assert.equal(deps.calls.length, 1, `${effort} spawned once`);
    assert.ok(deps.calls[0].args.includes(`model_reasoning_effort=${effort}`), `${effort} reaches argv`);
    assert.equal(deps.usage[0].cli.reasoningEffort, effort, `${effort} is logged in cli detail`);
  }
  ok("T9: explicit low, medium, and high efforts reach argv and lane usage");
}

async function t10_unknownEffortIsRefusedWithoutSpawn() {
  const deps = makeDeps({ status: 0, stdout: "must not run", stderr: "" }, { effort: "turbo" });
  const result = await mod.dispatchCorleone("bad effort", deps);

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.match(result.diagnostic, /invalid --effort turbo/);
  assert.equal(deps.calls.length, 0, "codex is not spawned for an unknown effort");
  assert.equal(deps.usage.length, 0, "no lane usage record claims a codex run happened");
  ok("T10: unknown --effort values are refused before spawn");
}

async function t11_parserExtractsTurnsAndCliFromRealisticJsonl() {
  assert.equal(typeof mod.parseCodexExecJsonl, "function", "parseCodexExecJsonl is exported");
  const parsed = mod.parseCodexExecJsonl(realisticJsonlStream(), { effort: "medium" });

  assert.equal(parsed.turns, 2, "turn count is derived from turn events");
  assert.equal(parsed.cli.reasoningEffort, "medium");
  assert.equal(parsed.cli.sessionId, "session-123");
  assert.equal(parsed.cli.model, "gpt-5-codex");
  assert.equal(parsed.cli.inputTokens, 20);
  assert.equal(parsed.cli.cachedInputTokens, 2);
  assert.equal(parsed.cli.outputTokens, 8);
  assert.equal(parsed.cli.reasoningOutputTokens, 1);
  assert.equal(parsed.cli.totalTokens, 28);
  assert.equal(parsed.readableStdout, "first readable answer\n");
  ok("T11: parser extracts turns, readable text, and scalar cli detail from JSONL");
}

async function t12_malformedJsonlIsSkippedAndRecordStillGetsParsedFields() {
  const stdout = jsonl([
    "{\"type\":\"turn.started\"",
    { type: "turn.started" },
    { type: "turn.completed", model: "gpt-5", usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 } },
  ]);
  const deps = makeDeps({ status: 0, stdout, stderr: "" });
  const result = await mod.dispatchCorleone("mixed jsonl", deps);

  assert.equal(result.ok, true);
  assert.equal(deps.usage[0].turns, 1, "malformed line is skipped while valid turn events count");
  assert.equal(deps.usage[0].cli.model, "gpt-5");
  assert.equal(deps.usage[0].cli.inputTokens, 3);
  assert.equal(deps.usage[0].cli.outputTokens, 5);
  ok("T12: malformed JSONL lines are skipped without throwing or dropping the usage record");
}

async function t13_nothingUsableStillLogsNullsNotGaps() {
  const deps = makeDeps({ status: 0, stdout: "not json\n{}\n", stderr: "" });
  await mod.dispatchCorleone("empty jsonl", deps);

  assert.equal(deps.usage.length, 1, "one usage record is still logged");
  assert.ok(Object.prototype.hasOwnProperty.call(deps.usage[0], "turns"), "turns key exists");
  assert.equal(deps.usage[0].turns, null);
  assert.ok(Object.prototype.hasOwnProperty.call(deps.usage[0], "cli"), "cli key exists");
  assert.equal(deps.usage[0].cli.reasoningEffort, "medium");
  assert.equal(deps.usage[0].cli.sessionId, null);
  assert.equal(deps.usage[0].cli.model, null);
  assert.equal(deps.usage[0].cli.inputTokens, null);
  assert.equal(deps.usage[0].cli.cachedInputTokens, null);
  assert.equal(deps.usage[0].cli.outputTokens, null);
  assert.equal(deps.usage[0].cli.reasoningOutputTokens, null);
  assert.equal(deps.usage[0].cli.totalTokens, null);
  ok("T13: unusable JSONL still yields a complete usage record with null event fields");
}

async function t14_cliArgsParserAcceptsEffortFlagShapes() {
  assert.deepEqual(mod.parseDispatchArgs(["prompt"]).effort, "medium");
  assert.deepEqual(mod.parseDispatchArgs(["prompt", "--effort", "low"]).effort, "low");
  assert.deepEqual(mod.parseDispatchArgs(["prompt", "--effort=high"]).effort, "high");
  const badArgs = mod.parseDispatchArgs(["prompt", "--effort", "unknown"]);
  assert.equal(badArgs.ok, false);
  assert.match(badArgs.diagnostic, /invalid --effort unknown/);
  ok("T14: CLI argument parsing validates effort values");
}

async function t15_timeoutPathLogsParsedTurnsAndCliDetail() {
  const deps = makeDeps({ status: null, signal: "SIGTERM", stdout: realisticJsonlStream(), stderr: "working...\n" }, { timeoutMs: 123, effort: "high" });
  const result = await mod.dispatchCorleone("slow json task", deps);

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(deps.usage[0].timedOut, true);
  assert.equal(deps.usage[0].turns, 2);
  assert.equal(deps.usage[0].cli.reasoningEffort, "high");
  assert.equal(deps.usage[0].cli.sessionId, "session-123");
  assert.equal(deps.usage[0].cli.model, "gpt-5-codex");
  assert.equal(deps.usage[0].cli.totalTokens, 28);
  ok("T15: timeout usage records still include parsed turns and cli detail");
}

// The shape codex-cli 0.153 actually emits. Every task whose deliverable is
// TEXT came back empty, because item.type is agent_message carrying a plain
// string and no branch matched it. File-writing packets never noticed; directive
// planning did, and failed as "plan is too short" attempt after attempt.
function t16_agentMessageItemIsTheAnswer() {
  const jsonl = [
    JSON.stringify({ type: "thread.started", thread_id: "t1" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "OBJECTIVE: build the thing" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 4 } }),
  ].join("\n");
  const parsed = mod.parseCodexExecJsonl(jsonl, { effort: "low" });
  assert.match(parsed.readableStdout, /OBJECTIVE: build the thing/);
  assert.equal(parsed.turns, 1);
  ok("T16: an agent_message item is the lane ANSWER, not dropped");
}

async function main() {
  console.log("# corleone-dispatch regression tests");
  const tests = [
    t16_agentMessageItemIsTheAnswer,
    t1_buildsNodeBackedInvocationForWindowsShim,
    t2_buildsDirectCodexInvocationWithoutShim,
    t3_successLogsChildOutputForLaneUsageDetail,
    t4_nonZeroExitLogsChildOutputForLaneUsageDetail,
    t5_timeoutLogsTimedOutAndPartialOutput,
    t6_spawnErrorLogsOutputAndErrorMessage,
    t7_laneGuardSkipDoesNotSpawn,
    t8_defaultEffortReachesSpawnArgv,
    t9_eachExplicitEffortReachesSpawnArgv,
    t10_unknownEffortIsRefusedWithoutSpawn,
    t11_parserExtractsTurnsAndCliFromRealisticJsonl,
    t12_malformedJsonlIsSkippedAndRecordStillGetsParsedFields,
    t13_nothingUsableStillLogsNullsNotGaps,
    t14_cliArgsParserAcceptsEffortFlagShapes,
    t15_timeoutPathLogsParsedTurnsAndCliDetail,
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
