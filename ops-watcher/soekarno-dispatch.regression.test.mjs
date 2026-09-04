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
    throw new Error(`unexpected spawn: ${cmd}`);
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
  });
  return { ...h, result, tmpDir };
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
  const stdout = "answer line\n\n  ";
  const { result } = await runDispatch("success", {
    tmpRoot: TMP_ROOT,
    tmpName: "t7",
    results: { ssh: { status: 0, stdout, stderr: "" } },
  });

  assert.equal(result.ok, true, "T7: exit zero is green");
  assert.equal(result.stdout, stdout, "T7: stdout is returned verbatim");
  assert.equal(result.timedOut, false, "T7: success is not timed out");
  assert.equal(result.exitCode, 0, "T7: exit code is preserved");
  ok("T7: successful ssh returns stdout verbatim including trailing whitespace");
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
    ssh: { status: 0, stdout: "ran\n", stderr: "" },
  });
  const runResult = await dispatchSoekarno("guard run", {
    spawnSync: ran.spawnSync,
    log: noopLog,
    tmpDir: makeTmpDir(TMP_ROOT, "t8-run"),
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
    results: { ssh: { status: 0, stdout: "ok", stderr: "" } },
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
