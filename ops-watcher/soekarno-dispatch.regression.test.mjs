// ops-watcher/soekarno-dispatch.regression.test.mjs
// Offline regression coverage for the SOEKARNO SSH dispatcher. NO real ssh,
// NO real scp, NO real network: every spawn is injected. Run with:
//   node ops-watcher/soekarno-dispatch.regression.test.mjs

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REMOTE_PROMPT_PATH,
  SOEKARNO_HOST,
  buildRemoteCommand,
  buildScpArgs,
  buildSshArgs,
  dispatchSoekarno,
  hostIsThisMachine,
  parseClaudeJson,
  resolveLocalClaude,
  SOEKARNO_ALLOWED_TOOLS,
  SOEKARNO_SYSTEM_PROMPT,
} from "./soekarno-dispatch.mjs";

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTING_STATE_FILE = path.join(__dirname, "routing-state.json");
const LANE_USAGE_FILE = path.join(__dirname, "lane-usage.jsonl");

function snapshotFile(file) {
  return {
    file,
    existed: existsSync(file),
    content: existsSync(file) ? readFileSync(file, "utf8") : null,
  };
}

function restoreFile(snap) {
  if (snap.existed) {
    writeFileSync(snap.file, snap.content, "utf8");
  } else {
    rmSync(snap.file, { force: true });
  }
}

function snapshotRepoState() {
  return [snapshotFile(ROUTING_STATE_FILE), snapshotFile(LANE_USAGE_FILE)];
}

function restoreRepoState(snaps) {
  for (const snap of snaps) restoreFile(snap);
}

function setRoutingState(state) {
  writeFileSync(ROUTING_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function clearSoekarnoGuard() {
  setRoutingState({ lanes: {} });
}

function setSoekarnoSkipped() {
  setRoutingState({
    lanes: {
      claude: {
        lastFailureTs: Date.now(),
        lastFailureReason: "test cooldown",
        failureCount: 1,
        cooldownMs: 60_000,
      },
    },
  });
}

function makeTmpDir(root, name) {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function spawnHarness(results = {}) {
  const calls = [];
  const spawnSync = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (cmd === "scp") return results.scp ?? { status: 0, stdout: "", stderr: "" };
    if (cmd === "ssh") return results.ssh ?? { status: 0, stdout: "ok\n", stderr: "" };
    return results.claude ?? { status: 0, stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "local ok", session_id: "sess-local", num_turns: 1, duration_ms: 100 }), stderr: "" };
  };
  return { calls, spawnSync };
}

function noopLog() {}

function assertPromptClean(argv, prompt) {
  const haystack = argv.join("\u0000");
  assert.equal(haystack.includes(prompt), false, "prompt body is not present in ssh argv");
  for (const fragment of ["alpha", "double-fragment", "single-fragment", "line-two", "dangerous && operator", "\n", "&&"]) {
    assert.equal(haystack.includes(fragment), false, `prompt fragment ${JSON.stringify(fragment)} is not present in ssh argv`);
  }
}

async function runDispatch(prompt, over = {}) {
  clearSoekarnoGuard();
  const tmpDir = over.tmpDir || makeTmpDir(over.tmpRoot, over.tmpName || `case-${Date.now()}`);
  const h = spawnHarness(over.results);
  const result = await dispatchSoekarno(prompt, {
    spawnSync: h.spawnSync,
    log: over.log || noopLog,
    timeoutMs: over.timeoutMs || 1234,
    tmpDir,
    hostname: over.hostname || (() => "not-soekarno-test-host"),
    networkInterfaces: over.networkInterfaces || (() => ({
      test: [{ address: "203.0.113.44", family: "IPv4", internal: false }],
    })),
    pathDirs: over.pathDirs,
    _fs: over._fs,
  });
  return { ...h, result, tmpDir };
}

function localHostDeps() {
  return {
    hostname: () => "not-soekarno-test-host",
    networkInterfaces: () => ({
      tailscale: [{ address: "100.87.42.3", family: "IPv4", internal: false }],
    }),
  };
}

function localClaudeDeps() {
  if (process.platform !== "win32") return {};
  return {
    pathDirs: ["C:\\npm"],
    _fs: {
      readFileSync(file) {
        assert.equal(file, path.join("C:\\npm", "claude.cmd"));
        return '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe" %*';
      },
      accessSync(file) {
        assert.equal(path.resolve(file), path.resolve("C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"));
      },
    },
  };
}

async function t1_promptNeverReachesSshArgv() {
  const prompt = "alpha \"double-fragment\" 'single-fragment'\nline-two dangerous && operator";
  const { calls } = await runDispatch(prompt, { tmpRoot: TMP_ROOT, tmpName: "t1" });
  const ssh = calls.find((c) => c.cmd === "ssh");

  assert.ok(ssh, "T1: ssh was called");
  assertPromptClean(ssh.args, prompt);
  assertPromptClean(buildSshArgs(), prompt);
  assert.equal(buildRemoteCommand().includes(prompt), false, "T1: remote command does not contain prompt body");
  ok("T1: prompt text and shell operators never reach ssh argv");
}

async function t2_bothSpawnsUseShellFalseAndHiddenWindows() {
  const { calls } = await runDispatch("check spawn options", { tmpRoot: TMP_ROOT, tmpName: "t2" });

  assert.equal(calls.length, 2, "T2: scp and ssh are both spawned");
  for (const call of calls) {
    assert.equal(call.options.shell, false, `T2: ${call.cmd} uses shell:false`);
    assert.equal(call.options.windowsHide, true, `T2: ${call.cmd} hides the Windows console`);
  }
  ok("T2: scp and ssh both use shell:false and windowsHide:true");
}

async function t3_orderAndWiringUseScpThenSshClaudeLane() {
  const { calls, tmpDir } = await runDispatch("check wiring", { tmpRoot: TMP_ROOT, tmpName: "t3" });
  const localPath = path.join(tmpDir, "prompt.txt");
  const expectedRemote = `${SOEKARNO_HOST}:${REMOTE_PROMPT_PATH}`;

  assert.deepEqual(calls.map((c) => c.cmd), ["scp", "ssh"], "T3: scp runs before ssh");
  assert.equal(calls[0].args.at(-2), localPath, "T3: scp receives the local prompt path");
  assert.equal(calls[0].args.at(-1), expectedRemote, "T3: scp destination is host:remote prompt path");
  assert.equal(calls[1].args.at(-2), SOEKARNO_HOST, "T3: ssh receives the SOEKARNO host");
  assert.equal(calls[1].args.at(-1), buildRemoteCommand(), "T3: ssh receives the remote PowerShell command");
  assert.match(calls[1].args.at(-1), /claude -p/, "T3: ssh command invokes Claude print mode");
  ok("T3: dispatcher copies first, then sshes to Claude on the Lenovo");
}

async function t4_scpFailureStopsBeforeSsh() {
  const { calls, result } = await runDispatch("copy fails", {
    tmpRoot: TMP_ROOT,
    tmpName: "t4",
    results: { scp: { status: 1, stdout: "", stderr: "scp denied" } },
  });

  assert.equal(result.ok, false, "T4: scp failure is red");
  assert.equal(result.timedOut, false, "T4: scp failure is not a timeout");
  assert.equal(result.stderr, "scp denied", "T4: scp stderr is surfaced");
  assert.deepEqual(calls.map((c) => c.cmd), ["scp"], "T4: ssh is never spawned after failed copy");
  ok("T4: failed prompt copy prevents the remote Claude run");
}

async function t5_sshTimeoutReturnsTimedOut() {
  const { result } = await runDispatch("ssh timeout", {
    tmpRoot: TMP_ROOT,
    tmpName: "t5",
    results: {
      ssh: {
        status: null,
        stdout: "partial",
        stderr: "waiting",
        error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
      },
    },
  });

  assert.equal(result.ok, false, "T5: timeout is red");
  assert.equal(result.timedOut, true, "T5: timeout is explicitly marked");
  assert.equal(result.stdout, "partial", "T5: timeout keeps stdout");
  assert.equal(result.stderr, "waiting", "T5: timeout keeps stderr");
  ok("T5: ssh ETIMEDOUT is returned as timedOut:true");
}

async function t6_sshStartFailureSurfacesMessage() {
  const { result } = await runDispatch("ssh cannot start", {
    tmpRoot: TMP_ROOT,
    tmpName: "t6",
    results: {
      ssh: {
        status: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("spawn ssh ENOENT"), { code: "ENOENT" }),
      },
    },
  });

  assert.equal(result.ok, false, "T6: start failure is red");
  assert.equal(result.timedOut, false, "T6: ENOENT is not a timeout");
  assert.equal(result.stderr, "spawn ssh ENOENT", "T6: start failure message is surfaced");
  ok("T6: ssh start failures are surfaced instead of swallowed");
}

async function t7_successReturnsStdoutVerbatim() {
  // claude -p --output-format json returns a result envelope; the lane's
  // answer is the envelope's `result` field, returned verbatim.
  const answer = "answer line\n\n  ";
  const envelope = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: answer,
    session_id: "sess-t7",
    num_turns: 2,
    duration_ms: 1200,
    duration_api_ms: 900,
    usage: { input_tokens: 10, output_tokens: 20 },
  });
  const { result } = await runDispatch("success", {
    tmpRoot: TMP_ROOT,
    tmpName: "t7",
    results: { ssh: { status: 0, stdout: envelope, stderr: "" } },
  });

  assert.equal(result.ok, true, "T7: exit zero is green");
  assert.equal(result.stdout, answer, "T7: the parsed result text is returned verbatim");
  assert.equal(result.timedOut, false, "T7: success is not timed out");
  assert.equal(result.exitCode, 0, "T7: exit code is preserved");
  assert.equal(result.turns, 2, "T7: num_turns from the envelope reaches the caller");
  ok("T7: successful ssh returns the parsed JSON result verbatim including trailing whitespace");
}

async function t8_laneGuardSkipIsHonouredAndNonSkipRuns() {
  setSoekarnoSkipped();
  const skipped = spawnHarness();
  const skipResult = await dispatchSoekarno("guard skip", {
    spawnSync: skipped.spawnSync,
    log: noopLog,
    tmpDir: makeTmpDir(TMP_ROOT, "t8-skip"),
  });

  assert.equal(skipResult.ok, false, "T8: skipped result is red");
  assert.equal(skipResult.skipped, true, "T8: skipped result is marked");
  assert.equal(skipped.calls.length, 0, "T8: skip spawns nothing");

  clearSoekarnoGuard();
  const ran = spawnHarness({
    ssh: { status: 0, stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ran", session_id: "sess-t8", num_turns: 2, duration_ms: 1200, model: "claude-opus-5", usage: { input_tokens: 10, output_tokens: 20 } }), stderr: "" },
  });
  const runResult = await dispatchSoekarno("guard run", {
    spawnSync: ran.spawnSync,
    log: noopLog,
    tmpDir: makeTmpDir(TMP_ROOT, "t8-run"),
    hostname: () => "not-soekarno-test-host",
    networkInterfaces: () => ({
      test: [{ address: "203.0.113.44", family: "IPv4", internal: false }],
    }),
  });

  assert.equal(runResult.ok, true, "T8: non-skip path succeeds with fake spawns");
  assert.deepEqual(ran.calls.map((c) => c.cmd), ["scp", "ssh"], "T8: non-skip path runs both spawns");
  ok("T8: lane guard skip is honoured and a non-skip actually runs");
}

async function t9_promptFileIsCleanedAfterSuccessAndFailure() {
  const successDir = makeTmpDir(TMP_ROOT, "t9-success");
  const success = await runDispatch("cleanup success", {
    tmpRoot: TMP_ROOT,
    tmpDir: successDir,
    results: { ssh: { status: 0, stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok", session_id: "sess-t9", num_turns: 1, duration_ms: 900, model: "claude-opus-5" }), stderr: "" } },
  });
  assert.equal(success.result.ok, true, "T9: success setup is green");
  assert.equal(existsSync(path.join(successDir, "prompt.txt")), false, "T9: prompt file removed after success");

  const failureDir = makeTmpDir(TMP_ROOT, "t9-failure");
  const failure = await runDispatch("cleanup failure", {
    tmpRoot: TMP_ROOT,
    tmpDir: failureDir,
    results: { scp: { status: 1, stdout: "", stderr: "copy failed" } },
  });
  assert.equal(failure.result.ok, false, "T9: failure setup is red");
  assert.equal(existsSync(path.join(failureDir, "prompt.txt")), false, "T9: prompt file removed after failure");
  ok("T9: local prompt file is cleaned up after success and failure");
}

// =====================================================================
// T10-T12: the CONTRACT, not just the happy path.
//
// The mandated mutations — "drop --output-format json" and "let invalid JSON
// fall back to raw prose" — both left this suite GREEN. Nothing asserted the
// flags reach the command, and nothing asserted that unparseable output is a
// REPORTED FAILURE rather than a silent acceptance of scraped text. Those two
// gaps are the entire point of replacing prose scraping, so they are asserted
// here.
// =====================================================================

async function t10_theClaudeFlagsReachTheRemoteCommand() {
  const cmd = buildRemoteCommand();
  // --output-format json is what makes the result parseable at all. Without it
  // the lane is back to scraping prose and every parse below is theatre.
  assert.match(cmd, /--output-format json/, "T10: --output-format json is passed");
  // --allowedTools pins the lane to what its role actually needs. A tool it is
  // not given cannot be misused.
  assert.match(cmd, /--allowedTools/, "T10: --allowedTools is passed");
  for (const tool of SOEKARNO_ALLOWED_TOOLS) {
    assert.ok(cmd.includes(tool), `T10: allowed tool ${tool} is named in the command`);
  }
  assert.match(cmd, /--append-system-prompt/, "T10: --append-system-prompt is passed");
  assert.ok(cmd.includes(SOEKARNO_SYSTEM_PROMPT.slice(0, 40)), "T10: the role context is the one actually sent");
  ok("T10: --output-format json, --allowedTools and --append-system-prompt all reach the command");
}

async function t11_invalidJsonIsAFailureNotASilentFallback() {
  // THE WHOLE REASON THIS CHANGE EXISTS. Accepting raw text when the envelope
  // fails to parse is precisely the prose-scraping being replaced, and it fails
  // silently: the caller gets a plausible-looking answer with no numbers and no
  // indication anything went wrong.
  for (const raw of ["ran\n", "ok", "I could not do that", "{broken", "[1,2,3]", '"a string"', ""]) {
    const parsed = parseClaudeJson(raw);
    assert.equal(parsed.ok, false, `T11: ${JSON.stringify(raw)} is a reported failure`);
    assert.ok(parsed.error && parsed.error.length > 0, "T11: and it says why");
    assert.equal(parsed.result, undefined, "T11: no result is handed back from unparseable output");
  }
  ok("T11: unparseable output is a reported failure, never a silent fallback to raw prose");
}

async function t12_aValidEnvelopeYieldsResultTurnsAndCli() {
  const parsed = parseClaudeJson(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "the answer",
    session_id: "sess-1",
    num_turns: 4,
    duration_ms: 5000,
    model: "claude-opus-5",
    usage: { input_tokens: 100, output_tokens: 200 },
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.result, "the answer");
  assert.equal(parsed.turns, 4, "T12: turns come from the envelope, not from counting lines");
  assert.equal(parsed.cli.session_id, "sess-1");
  assert.equal(parsed.cli.model, "claude-opus-5");
  assert.equal(parsed.cli.usage_input_tokens, 100, "T12: usage numbers are flattened into cli detail");
  assert.equal(parsed.cli.usage_output_tokens, 200);
  assert.equal(parsed.isError, false);
  ok("T12: a valid envelope yields the result plus real per-run numbers");
}

async function t13_hostIsThisMachineMatchesHostnameInterfaceAndLocalhost() {
  assert.equal(hostIsThisMachine("WIN10@lane-box", {
    hostname: () => "LANE-BOX",
    networkInterfaces: () => ({}),
  }), true, "T13: injected hostname match is local");
  assert.equal(hostIsThisMachine("WIN10@100.87.42.3", localHostDeps()), true, "T13: injected interface address match is local");
  assert.equal(hostIsThisMachine("WIN10@localhost", {
    hostname: () => "elsewhere",
    networkInterfaces: () => ({}),
  }), true, "T13: localhost is local");
  assert.equal(hostIsThisMachine("WIN10@203.0.113.99", localHostDeps()), false, "T13: unrelated address is remote");
  ok("T13: hostIsThisMachine recognizes hostname, interface, localhost and remote addresses");
}

async function t14_localHostSpawnsClaudeAndNeverScpOrSsh() {
  const prompt = "local branch prompt";
  const { calls, result } = await runDispatch(prompt, {
    tmpRoot: TMP_ROOT,
    tmpName: "t14",
    ...localHostDeps(),
    ...localClaudeDeps(),
  });

  assert.equal(result.ok, true, "T14: local claude result is green");
  assert.equal(calls.length, 1, "T14: only local claude is spawned");
  assert.notEqual(calls[0].cmd, "scp", "T14: scp is not called");
  assert.notEqual(calls[0].cmd, "ssh", "T14: ssh is not called");
  assert.equal(calls[0].args[0], "-p", "T14: local claude receives -p");
  assert.equal(calls[0].args[1], prompt, "T14: local claude receives the prompt as one argv entry");
  ok("T14: local SOEKARNO dispatch spawns claude directly without scp or ssh");
}

async function t15_localSpawnUsesHiddenWindowAndNoShell() {
  const { calls } = await runDispatch("local options", {
    tmpRoot: TMP_ROOT,
    tmpName: "t15",
    ...localHostDeps(),
    ...localClaudeDeps(),
  });

  assert.equal(calls.length, 1, "T15: local branch has one spawn");
  assert.equal(calls[0].options.windowsHide, true, "T15: local claude hides the Windows console");
  assert.equal(calls[0].options.shell, false, "T15: local claude uses shell:false");
  ok("T15: local claude spawn uses windowsHide:true and shell:false");
}

async function t16_remoteHostStillUsesScpAndSsh() {
  const { calls } = await runDispatch("remote still remote", {
    tmpRoot: TMP_ROOT,
    tmpName: "t16",
    hostname: () => "another-host",
    networkInterfaces: () => ({
      ethernet: [{ address: "192.0.2.10", family: "IPv4", internal: false }],
    }),
  });

  assert.deepEqual(calls.map((c) => c.cmd), ["scp", "ssh"], "T16: remote host still runs scp then ssh");
  ok("T16: nonmatching host still takes the scp and ssh path");
}

async function t17_missingLocalClaudeIsFailureAndSpawnsNothing() {
  const { calls, result } = await runDispatch("missing claude", {
    tmpRoot: TMP_ROOT,
    tmpName: "t17",
    ...localHostDeps(),
    pathDirs: [],
  });

  if (process.platform === "win32") {
    assert.equal(result.ok, false, "T17: missing local claude is red");
    assert.match(result.stderr, /local claude executable could not be resolved/, "T17: missing local claude is reported");
    assert.equal(calls.length, 0, "T17: no spawn happens without local claude");
  } else {
    assert.equal(resolveLocalClaude({ pathDirs: [] }), "claude", "T17: non-Windows local claude is the executable name");
  }
  ok("T17: unresolved local claude fails without falling through to ssh on Windows");
}

const TMP_ROOT = path.join(os.tmpdir(), `soekarno-dispatch-regression-${process.pid}`);

async function main() {
  const snaps = snapshotRepoState();
  mkdirSync(TMP_ROOT, { recursive: true });
  const tests = [
    t1_promptNeverReachesSshArgv,
    t2_bothSpawnsUseShellFalseAndHiddenWindows,
    t3_orderAndWiringUseScpThenSshClaudeLane,
    t4_scpFailureStopsBeforeSsh,
    t5_sshTimeoutReturnsTimedOut,
    t6_sshStartFailureSurfacesMessage,
    t7_successReturnsStdoutVerbatim,
    t8_laneGuardSkipIsHonouredAndNonSkipRuns,
    t9_promptFileIsCleanedAfterSuccessAndFailure,
    t10_theClaudeFlagsReachTheRemoteCommand,
    t11_invalidJsonIsAFailureNotASilentFallback,
    t12_aValidEnvelopeYieldsResultTurnsAndCli,
    t13_hostIsThisMachineMatchesHostnameInterfaceAndLocalhost,
    t14_localHostSpawnsClaudeAndNeverScpOrSsh,
    t15_localSpawnUsesHiddenWindowAndNoShell,
    t16_remoteHostStillUsesScpAndSsh,
    t17_missingLocalClaudeIsFailureAndSpawnsNothing,
  ];

  try {
    for (const t of tests) {
      try {
        await t();
      } catch (e) {
        bad(t.name, e);
      }
    }
  } finally {
    restoreRepoState(snaps);
    rmSync(TMP_ROOT, { recursive: true, force: true });
  }

  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("regression runner crashed:", e);
  process.exit(1);
});
