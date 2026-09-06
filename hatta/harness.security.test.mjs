// hatta/harness.security.test.mjs
// Adversarial regression suite for hatta/harness.mjs. This suite tests the
// exported pure guard functions only: no live model dispatch, no destructive
// commands, no real credentials printed.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateCommand,
  resolveWorkspacePath,
  protectedWorkspacePathReason,
  buildExecPlan,
  editFileTool,
  HARNESS_EVIDENCE_PATH,
  handleTerminationSignal,
  persistHarnessEvidence,
  runTask,
  effectiveMaxIterations,
  HARD_ITERATION_CEILING,
  clockReserveMs,
  MIN_CLOCK_RESERVE_MS,
  callTimeoutMs,
  MIN_CALL_TIMEOUT_MS,
  MODEL_TIERS,
  resolveModel,
  postChat,
  OllamaChatTimeoutError,
  OllamaModelUnavailableError,
} from "./harness.mjs";

// THE SANDBOX BOUNDARY THIS WHOLE FILE EXISTS TO TEST. It must be derived the
// same way harness.mjs derives it (both files live in <repo>/hatta/), never
// hardcoded: a security test that asserts against a directory which does not
// exist on the machine running it proves nothing about the boundary that is
// actually enforced. It would keep passing while the real sandbox was broken —
// which is exactly the state this repository was in until 2026-09-04.
const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cases = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function add(label, fn) {
  cases.push({ label, fn });
}

function expectBlocked(result, label) {
  assert.equal(result && result.ok, false, `${label} must be blocked; got ${JSON.stringify(result)}`);
}

function expectAllowed(result, label) {
  assert.equal(result && result.ok, true, `${label} must be allowed; got ${JSON.stringify(result)}`);
}

function mustBlockCommand(label, command, args) {
  add(label, () => expectBlocked(validateCommand(command, args), label));
}

function mustAllowCommand(label, command, args) {
  add(label, () => expectAllowed(validateCommand(command, args), label));
}

function mustBlockPath(label, requested) {
  add(label, () => expectBlocked(resolveWorkspacePath(requested), label));
}

function mustProtectPath(label, requested, opts) {
  add(label, () => assert.ok(protectedWorkspacePathReason(requested, opts), `${label} must be protected`));
}

function makeEvidence() {
  return { filesWritten: [] };
}

async function withTempWorkspaceFile(label, content, fn) {
  const rel = `hatta/workspace/${label}-${process.pid}-${Date.now()}.txt`;
  const abs = path.join(WORKSPACE_ROOT, rel);
  await fs.writeFile(abs, content, "utf8");
  try {
    await fn(rel, abs);
  } finally {
    await fs.rm(abs, { force: true }).catch(() => {});
  }
}

function finalChat(content = "done") {
  return async () => ({ message: { role: "assistant", content } });
}

function fixedClock() {
  const timestamps = ["2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z"];
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)];
}

function advancingClock(stepMs) {
  let current = Date.parse("2026-01-01T00:00:00.000Z") - stepMs;
  return () => {
    current += stepMs;
    return current;
  };
}

function loopingChat() {
  let calls = 0;
  const chat = async () => {
    calls += 1;
    return { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "unknown_probe_tool", arguments: "{}" } }] } };
  };
  chat.calls = () => calls;
  return chat;
}

async function withEnv(key, value, fn) {
  const original = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

// ---------------------------------------------------------------------------
// Harness evidence persistence and termination bookkeeping.
// ---------------------------------------------------------------------------
add("runTask persists harness evidence JSON with iterations", async () => {
  // NOT the real evidence path. hatta-dispatch reads that file to recover what
  // a timed-out run managed to do, so a test that overwrites it makes the next
  // timeout report this fixture as its own evidence.
  const evidencePath = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "hatta-evidence-")),
    ".harness-evidence.json",
  );

  const evidence = await runTask("offline evidence smoke", {
    chat: finalChat("evidence complete"),
    now: fixedClock(),
    persist: (record) => persistHarnessEvidence(record, fs, evidencePath),
  });
  const parsed = JSON.parse(await fs.readFile(evidencePath, "utf8"));

  assert.equal(evidence.ok, true);
  assert.equal(parsed.iterations, 1);
  assert.equal(parsed.finalMessage, "evidence complete");
  assert.ok(Object.hasOwn(parsed, "iterations"));
});

add("evidence write failure does not abort run or change returned evidence", async () => {
  const expected = await runTask("offline baseline", {
    chat: finalChat("same evidence"),
    persist: async () => {},
    now: fixedClock(),
  });
  const actual = await runTask("offline failing evidence write", {
    chat: finalChat("same evidence"),
    persist: (evidence) => persistHarnessEvidence(evidence, {
      mkdir: async () => {},
      writeFile: async () => { throw new Error("simulated write failure"); },
    }),
    now: fixedClock(),
  });

  assert.deepEqual(actual, expected);
});

add("termination handler prints terminated evidence JSON", async () => {
  await runTask("offline signal seed", {
    chat: finalChat("ready for signal"),
    persist: async () => {},
    now: fixedClock(),
  });

  const lines = [];
  let exitCode = null;
  handleTerminationSignal("SIGTERM", {
    writeLine: (line) => lines.push(line),
    exit: (code) => { exitCode = code; },
    now: () => "2026-01-01T00:00:02.000Z",
  });
  const parsed = JSON.parse(lines[0]);

  assert.equal(lines.length, 1);
  assert.equal(exitCode, 1);
  assert.equal(parsed.terminatedBy, "SIGTERM");
  assert.equal(parsed.finishedAt, "2026-01-01T00:00:02.000Z");
  assert.equal(parsed.iterations, 1);
});

// ---------------------------------------------------------------------------
// HATTA iteration budget: time-bounded loop with a hard ceiling.
// ---------------------------------------------------------------------------
add("fast clock runs far more than four iterations before hard ceiling", async () => {
  await withEnv("HATTA_MAX_ITER", undefined, async () => {
    const chat = loopingChat();
    const evidence = await runTask("fast loop", {
      chat,
      persist: async () => {},
      now: advancingClock(1),
    });

    assert.equal(evidence.ok, false);
    assert.equal(evidence.iterations, HARD_ITERATION_CEILING);
    assert.equal(chat.calls(), HARD_ITERATION_CEILING);
    assert.ok(evidence.iterations > 4, "fast loop should not stop at the old four-call count");
    assert.match(evidence.error, /Reached iteration ceiling \(40; hard=40; HATTA_MAX_ITER=unset\)/);
  });
});

add("slow clock stops before overrunning outer budget reserve", async () => {
  await withEnv("HATTA_MAX_ITER", undefined, async () => {
    const evidence = await runTask("slow loop", {
      chat: loopingChat(),
      persist: async () => {},
      now: advancingClock(120000),
    });

    assert.equal(evidence.ok, false);
    assert.equal(evidence.iterations, 2);
    assert.match(evidence.error, /Reached clock budget before a final answer/);
    // slowestCall=unobserved is the honest reading under a fake evidence clock:
    // the monotonic timer that measures a call is real, so a stubbed chat that
    // returns instantly gives it nothing to observe, and the reserve stays at
    // the conservative full per-request timeout — the pre-2026-09-06 behaviour,
    // preserved exactly for the case where nothing has been measured.
    assert.match(evidence.error, /elapsed=360000ms; outer=480000ms; reserve=120000ms; slowestCall=unobserved; remaining=120000ms/);
  });
});

// ---- The reserve follows observed call cost, not the worst case ----
// It was the full per-request timeout, charged unconditionally: an eight-minute
// budget could only ever work for six. Measured 2026-09-06, model calls took 13
// to 33 seconds and never anything near 120, and the run that hit this bound
// stopped while reporting 83607ms it refused to spend.
add("clock reserve follows observed call cost, floored and capped", () => {
  assert.equal(clockReserveMs({ observedCallMs: 33000 }), 66000, "twice the slowest observed call");
  assert.equal(clockReserveMs({ observedCallMs: 5000 }), MIN_CLOCK_RESERVE_MS, "never below one ordinary call plus its evidence write");
  assert.equal(clockReserveMs({ observedCallMs: 900000 }), 120000, "never above the per-request timeout, which bounds any single call");
  assert.equal(clockReserveMs({ observedCallMs: 33000, requestTimeoutMs: 40000 }), 40000, "the cap follows the caller's request timeout");
  for (const value of [undefined, null, 0, -1, Number.NaN, "slow"]) {
    assert.equal(clockReserveMs({ observedCallMs: value }), 120000,
      `unobserved cost (${String(value)}) must keep the conservative full reserve`);
  }
});

add("a 33s observed call buys back budget the old reserve threw away", () => {
  // The concrete claim, in the numbers from the 04:05 run on 2026-09-06.
  const outer = 450000;
  const oldRunnable = outer - 120000;
  const newRunnable = outer - clockReserveMs({ observedCallMs: 33000 });
  assert.equal(oldRunnable, 330000);
  assert.equal(newRunnable, 384000);
  assert.ok(newRunnable > oldRunnable, "the adaptive reserve must not cost a run time");
});

// ---- A call is bounded by what is left of the run, so the harness ends the run ----
// The clock reserve decides whether to START another iteration; it cannot decide
// how long that iteration runs. With the old fixed worst-case reserve those were
// the same question. With an adaptive reserve they are not, so the call itself
// has to be bounded — otherwise one unexpectedly slow call runs past the outer
// budget and the wrapper kills the harness instead of the harness stopping. A
// kill is uncatchable on Windows and leaves only the last evidence write.
add("a call is bounded by the budget left, never past the outer wall", () => {
  // Plenty of budget left: the standing per-request timeout applies unchanged.
  assert.equal(callTimeoutMs({ elapsedMs: 0, outerRunBudgetMs: 450000, requestTimeoutMs: 120000 }), 120000);
  assert.equal(callTimeoutMs({ elapsedMs: 300000, outerRunBudgetMs: 450000, requestTimeoutMs: 120000 }), 120000);

  // Near the wall: the call is cut to what remains, so it cannot outlive it.
  assert.equal(callTimeoutMs({ elapsedMs: 400000, outerRunBudgetMs: 450000, requestTimeoutMs: 120000 }), 50000);

  // Past the wall, or so close it does not matter: a floor, never zero or
  // negative — a one-millisecond timeout would report a healthy model as broken.
  assert.equal(callTimeoutMs({ elapsedMs: 450000, outerRunBudgetMs: 450000, requestTimeoutMs: 120000 }), MIN_CALL_TIMEOUT_MS);
  assert.equal(callTimeoutMs({ elapsedMs: 999999, outerRunBudgetMs: 450000, requestTimeoutMs: 120000 }), MIN_CALL_TIMEOUT_MS);

  // An explicitly requested timeout is never overridden by the floor. The floor
  // exists to stop a nearly-spent budget yielding a zero-length call, not to
  // veto a caller who asked for a short one.
  assert.equal(callTimeoutMs({ elapsedMs: 0, outerRunBudgetMs: 480000, requestTimeoutMs: 1 }), 1);

  // The invariant the whole function exists for.
  for (const elapsedMs of [0, 1, 100000, 300000, 449000]) {
    const bound = callTimeoutMs({ elapsedMs, outerRunBudgetMs: 450000, requestTimeoutMs: 120000 });
    assert.ok(bound > 0, "a call must always be given some time");
    assert.ok(bound <= 120000, "and never more than the per-request timeout");
  }
});

add("runTask hands each call its bound, and it shrinks as the run is spent", async () => {
  const bounds = [];
  let call = 0;
  await runTask("bounded calls", {
    // A clock that advances 100s per reading, so the run visibly spends itself.
    now: advancingClock(100000),
    persist: async () => {},
    chat: async (_messages, opts) => {
      bounds.push(opts && opts.timeoutMs);
      call += 1;
      return call < 3
        ? { message: { role: "assistant", content: "", tool_calls: [] } }
        : { message: { role: "assistant", content: "done" } };
    },
  });

  assert.ok(bounds.length >= 1, "every call must be given a bound");
  for (const b of bounds) assert.ok(Number.isFinite(b) && b > 0, `bad bound: ${b}`);
  for (let i = 1; i < bounds.length; i += 1) {
    assert.ok(bounds[i] <= bounds[i - 1], "the bound must never grow as the budget is spent");
  }
});

add("persistHarnessEvidence still defaults to the path hatta-dispatch reads", () => {
  // The path is injectable ONLY so tests stop clobbering the real evidence file.
  // If the injectable path ever became the default, a timed-out run would have
  // nothing to recover.
  const written = [];
  const io = { mkdir: async () => {}, writeFile: async (file) => { written.push(file); } };
  return persistHarnessEvidence({ ok: true }, io).then(() => {
    assert.deepEqual(written, [HARNESS_EVIDENCE_PATH]);
  });
});

add("HATTA_MAX_ITER=2 still caps the loop at 2", async () => {
  await withEnv("HATTA_MAX_ITER", "2", async () => {
    const chat = loopingChat();
    const evidence = await runTask("lowered loop", {
      chat,
      persist: async () => {},
      now: advancingClock(1),
    });

    assert.equal(effectiveMaxIterations(), 2);
    assert.equal(evidence.iterations, 2);
    assert.equal(chat.calls(), 2);
    assert.match(evidence.error, /Reached iteration ceiling \(2; hard=40; HATTA_MAX_ITER=2\)/);
  });
});

add("exhaustion messages name the bound and quote the numbers", async () => {
  const ceiling = await withEnv("HATTA_MAX_ITER", "3", () => runTask("ceiling message", {
    chat: loopingChat(),
    persist: async () => {},
    now: advancingClock(1),
  }));
  const clock = await withEnv("HATTA_MAX_ITER", undefined, () => runTask("clock message", {
    chat: loopingChat(),
    persist: async () => {},
    now: advancingClock(120000),
  }));

  assert.match(ceiling.error, /iteration ceiling \(3; hard=40; HATTA_MAX_ITER=3\)/);
  assert.match(clock.error, /clock budget/);
  assert.match(clock.error, /outer=480000ms; reserve=120000ms/);
});

// ---------------------------------------------------------------------------
// Legitimate HATTA workflows that must keep working.
// ---------------------------------------------------------------------------
mustAllowCommand("allow git status --short", "git", ["status", "--short"]);
mustAllowCommand("allow git diff --stat", "git", ["diff", "--stat"]);
mustAllowCommand("allow git log -1 --oneline", "git", ["log", "-1", "--oneline"]);
mustAllowCommand("allow rg normal workspace search", "rg", ["OWNER_REQUIRED", "ops-watcher"]);
mustAllowCommand("allow node harness security test", "node", ["hatta/harness.security.test.mjs"]);
mustAllowCommand("allow node --test on workspace test", "node", ["--test", "hatta/harness.security.test.mjs"]);
mustAllowCommand("allow npm run test policy shape", "npm", ["run", "test"]);
mustAllowCommand("allow bun test on workspace test only", "bun", ["test", "hatta/harness.security.test.mjs"]);
mustAllowCommand("allow echo text even if it contains rm as harmless data", "echo", ["please", "rm", "nothing"]);

add("git exec plan trusts the HATTA workspace without exposing git -c to the model", () => {
  const inherited = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "alias.pwn",
    GIT_CONFIG_VALUE_0: "!powershell -enc AAAA",
  };
  const plan = buildExecPlan("git", ["status", "--short"], { env: inherited });
  assert.deepEqual(plan.args, ["--no-pager", "status", "--short"]);
  assert.equal(plan.env.GIT_CONFIG_COUNT, "1");
  assert.equal(plan.env.GIT_CONFIG_KEY_0, "safe.directory");
  assert.equal(plan.env.GIT_CONFIG_VALUE_0, WORKSPACE_ROOT);
});

// ---------------------------------------------------------------------------
// F1/F4/F5/F7: git must be a read-only subcommand policy, not a git allowlist.
// ---------------------------------------------------------------------------
mustBlockCommand("block git alias shell escape via -c", "git", ["-c", "alias.x=!powershell -enc AAAA", "x"]);
mustBlockCommand("block F1 exact PoC git alias shell escape", "git", ["-c", "alias.pwn=!powershell -enc <b64>", "pwn"]);
mustBlockCommand("block git compact -c alias escape", "git", ["-calias.x=!sh -c whoami", "x"]);
mustBlockCommand("block git --config-env escape", "git", ["--config-env=alias.x=EVIL", "x"]);
mustBlockCommand("block git config --global mutation", "git", ["config", "--global", "user.email", "attacker@example.test"]);
mustBlockCommand("block git clean -fdx destructive secret deletion", "git", ["clean", "-fdx"]);
mustBlockCommand("block git reset --hard", "git", ["reset", "--hard", "HEAD~1"]);
mustBlockCommand("block git push", "git", ["push", "origin", "main"]);
mustBlockCommand("block git fetch network egress", "git", ["fetch", "origin"]);
mustBlockCommand("block git diff external diff", "git", ["diff", "--ext-diff"]);
mustBlockCommand("block git worktree override", "git", ["--work-tree=C:/Windows", "status"]);
mustBlockCommand("block git -C outside workspace", "git", ["-C", "C:/Windows", "status"]);

// .git is inside the workspace lexically, but it is executable repository
// control state. HATTA must not arm hooks/config for a later benign git command.
mustProtectPath("protect .git/config read/write surface", ".git/config", { write: true });
mustProtectPath("protect .git hooks write surface", ".git/hooks/pre-commit", { write: true });
mustBlockCommand("block type .git/config", "type", [".git/config"]);

// ---------------------------------------------------------------------------
// F2: bun package runner and package/network mutation classes.
// ---------------------------------------------------------------------------
mustBlockCommand("block bun x malicious package", "bun", ["x", "malicious-registry-package"]);
mustBlockCommand("block F2 exact PoC bun x rimraf", "bun", ["x", "rimraf", "hatta"]);
mustBlockCommand("block bunx top-level alias", "bunx", ["rimraf", "hatta"]);
mustBlockCommand("block bun exec equivalent", "bun", ["exec", "malicious-registry-package"]);
mustBlockCommand("block bun create", "bun", ["create", "vite"]);
mustBlockCommand("block bun install", "bun", ["install"]);
mustBlockCommand("block bun inline eval", "bun", ["--eval", "console.log(1)"]);

// ---------------------------------------------------------------------------
// F3/F8: rg must not spawn preprocessors or bypass ignore/secret filters.
// ---------------------------------------------------------------------------
mustBlockCommand("block rg --pre interpreter", "rg", ["--pre", "wscript", "."]);
mustBlockCommand("block F3 exact PoC rg preprocessor escape", "rg", ["--pre", "wscript", ".", "x.js"]);
mustBlockCommand("block rg --pre=interpreter", "rg", ["--pre=wscript", "."]);
mustBlockCommand("block rg --pre-glob companion", "rg", ["--pre-glob", "*.js", "x"]);
mustBlockCommand("block rg no-ignore secret bypass", "rg", ["--no-ignore", "pcp_", "."]);
mustBlockCommand("block rg unrestricted shorthand", "rg", ["-uuu", "pcp_", "."]);
mustBlockCommand("block rg hidden traversal", "rg", ["--hidden", "token", "."]);
mustBlockCommand("block rg explicit secret file path", "rg", ["pcp_", "ops-watcher/gibran-api.key"]);

// ---------------------------------------------------------------------------
// F6 and equivalents: interpreter option escapes.
// ---------------------------------------------------------------------------
mustBlockCommand("block node -e fs.rmSync", "node", ["-e", "require('fs').rmSync('hatta',{recursive:true,force:true})"]);
mustBlockCommand("block node --eval base64 child_process", "node", ["--eval", "require('child_process').execSync(Buffer.from('cm0gLXJmIGhhdHRh','base64').toString())"]);
mustBlockCommand("block node --import data URL", "node", ["--import", "data:text/javascript,console.log(1)", "hatta/harness.security.test.mjs"]);
mustBlockCommand("block F6 exact PoC node --import data URL", "node", ["--import", "data:text/javascript,<payload>"]);
mustBlockCommand("block node --import=data URL", "node", ["--import=data:text/javascript,console.log(1)"]);
mustBlockCommand("block node --require planted loader", "node", ["--require", "hatta/pwn.cjs", "hatta/harness.security.test.mjs"]);
mustBlockCommand("block node --loader planted loader", "node", ["--loader", "hatta/pwn.mjs", "hatta/harness.security.test.mjs"]);
mustBlockCommand("block node script outside approved roots", "node", ["graphify-out/cache/pwn.mjs"]);
mustBlockCommand("block node absolute outside workspace", "node", ["C:/Windows/System32/cscript.exe"]);

// ---------------------------------------------------------------------------
// edit_file workspace edits and write guard parity.
// ---------------------------------------------------------------------------
add("edit_file replaces one unique match and preserves surrounding bytes", async () => {
  const original = "alpha\nKEEP-BEFORE\nneedle\nKEEP-AFTER\nomega\n";
  await withTempWorkspaceFile("edit-unique", original, async (rel, abs) => {
    const evidence = makeEvidence();
    const result = await editFileTool({ path: rel, search: "needle", replace: "replacement" }, evidence);
    const updated = await fs.readFile(abs, "utf8");
    const writeFileStyleRel = path.relative(WORKSPACE_ROOT, abs);

    assert.deepEqual(result, {
      ok: true,
      path: writeFileStyleRel,
      bytes: Buffer.byteLength(original.replace("needle", "replacement"), "utf8"),
      replaced: 1,
    });
    assert.equal(updated, "alpha\nKEEP-BEFORE\nreplacement\nKEEP-AFTER\nomega\n");
    assert.deepEqual(evidence.filesWritten, [writeFileStyleRel]);
  });
});

add("edit_file refuses non-unique search and leaves disk unchanged", async () => {
  const original = "first target\nsecond target\n";
  await withTempWorkspaceFile("edit-duplicate", original, async (rel, abs) => {
    const evidence = makeEvidence();
    const result = await editFileTool({ path: rel, search: "target", replace: "changed" }, evidence);

    expectBlocked(result, "duplicate edit_file search");
    assert.equal(result.error, "edit_file: search text is not unique (2 occurrences)");
    assert.equal(await fs.readFile(abs, "utf8"), original);
    assert.deepEqual(evidence.filesWritten, []);
  });
});

add("edit_file refuses missing search and leaves disk unchanged", async () => {
  const original = "alpha\nbeta\ngamma\n";
  await withTempWorkspaceFile("edit-missing", original, async (rel, abs) => {
    const evidence = makeEvidence();
    const result = await editFileTool({ path: rel, search: "delta", replace: "changed" }, evidence);

    expectBlocked(result, "missing edit_file search");
    assert.equal(result.error, "edit_file: search text not found after line-ending normalization");
    assert.equal(await fs.readFile(abs, "utf8"), original);
    assert.deepEqual(evidence.filesWritten, []);
  });
});

add("edit_file matches LF search text in CRLF file and preserves CRLF", async () => {
  const original = "alpha\r\nKEEP-BEFORE\r\nneedle\r\nKEEP-AFTER\r\nomega\r\n";
  await withTempWorkspaceFile("edit-crlf-search-lf", original, async (rel, abs) => {
    const evidence = makeEvidence();
    const result = await editFileTool({
      path: rel,
      search: "KEEP-BEFORE\nneedle\nKEEP-AFTER",
      replace: "KEEP-BEFORE\nreplacement\nKEEP-AFTER",
    }, evidence);
    const updated = await fs.readFile(abs, "utf8");
    const expected = "alpha\r\nKEEP-BEFORE\r\nreplacement\r\nKEEP-AFTER\r\nomega\r\n";

    assert.equal(result.ok, true);
    assert.equal(result.bytes, Buffer.byteLength(expected, "utf8"));
    assert.equal(result.replaced, 1);
    assert.equal(updated, expected);
    assert.deepEqual(evidence.filesWritten, [path.relative(WORKSPACE_ROOT, abs)]);
  });
});

add("edit_file keeps LF file LF after normalized multi-line edit", async () => {
  const original = "alpha\nKEEP-BEFORE\nneedle\nKEEP-AFTER\nomega\n";
  await withTempWorkspaceFile("edit-lf-search-lf", original, async (rel, abs) => {
    const evidence = makeEvidence();
    const result = await editFileTool({
      path: rel,
      search: "KEEP-BEFORE\nneedle\nKEEP-AFTER",
      replace: "KEEP-BEFORE\nreplacement\nKEEP-AFTER",
    }, evidence);
    const updated = await fs.readFile(abs, "utf8");
    const expected = "alpha\nKEEP-BEFORE\nreplacement\nKEEP-AFTER\nomega\n";

    assert.equal(result.ok, true);
    assert.equal(result.bytes, Buffer.byteLength(expected, "utf8"));
    assert.equal(result.replaced, 1);
    assert.equal(updated, expected);
  });
});

add("edit_file still accepts CRLF search text in CRLF file", async () => {
  const original = "alpha\r\nKEEP-BEFORE\r\nneedle\r\nKEEP-AFTER\r\nomega\r\n";
  await withTempWorkspaceFile("edit-crlf-search-crlf", original, async (rel, abs) => {
    const evidence = makeEvidence();
    const result = await editFileTool({
      path: rel,
      search: "KEEP-BEFORE\r\nneedle\r\nKEEP-AFTER",
      replace: "KEEP-BEFORE\r\nreplacement\r\nKEEP-AFTER",
    }, evidence);
    const updated = await fs.readFile(abs, "utf8");
    const expected = "alpha\r\nKEEP-BEFORE\r\nreplacement\r\nKEEP-AFTER\r\nomega\r\n";

    assert.equal(result.ok, true);
    assert.equal(result.bytes, Buffer.byteLength(expected, "utf8"));
    assert.equal(result.replaced, 1);
    assert.equal(updated, expected);
  });
});

add("edit_file refuses non-unique search after line-ending normalization", async () => {
  const original = "one\r\nneedle\r\ntwo\r\nneedle\r\n";
  await withTempWorkspaceFile("edit-normalized-duplicate", original, async (rel, abs) => {
    const evidence = makeEvidence();
    const result = await editFileTool({ path: rel, search: "needle\n", replace: "changed\n" }, evidence);

    expectBlocked(result, "normalized duplicate edit_file search");
    assert.equal(result.error, "edit_file: search text is not unique after line-ending normalization (2 occurrences)");
    assert.equal(await fs.readFile(abs, "utf8"), original);
    assert.deepEqual(evidence.filesWritten, []);
  });
});

add("edit_file refuses non-unique search across different line-ending styles", async () => {
  const original = "one\r\nneedle\r\nx\r\ntwo\nneedle\nx\n";
  await withTempWorkspaceFile("edit-mixed-normalized-duplicate", original, async (rel, abs) => {
    const evidence = makeEvidence();
    const result = await editFileTool({ path: rel, search: "needle\nx\n", replace: "changed\nx\n" }, evidence);

    expectBlocked(result, "mixed normalized duplicate edit_file search");
    assert.equal(result.error, "edit_file: search text is not unique after line-ending normalization (2 occurrences)");
    assert.equal(await fs.readFile(abs, "utf8"), original);
    assert.deepEqual(evidence.filesWritten, []);
  });
});

add("edit_file missing search message says normalized text is absent", async () => {
  const original = "alpha\r\nbeta\r\ngamma\r\n";
  await withTempWorkspaceFile("edit-normalized-missing", original, async (rel, abs) => {
    const evidence = makeEvidence();
    const result = await editFileTool({ path: rel, search: "delta\n", replace: "changed\n" }, evidence);

    expectBlocked(result, "normalized missing edit_file search");
    assert.equal(result.error, "edit_file: search text not found after line-ending normalization");
    assert.equal(await fs.readFile(abs, "utf8"), original);
    assert.deepEqual(evidence.filesWritten, []);
  });
});

add("edit_file refuses to edit mixed line-ending files instead of guessing", async () => {
  const original = "alpha\r\nneedle\nomega\r\n";
  await withTempWorkspaceFile("edit-mixed-eol", original, async (rel, abs) => {
    const evidence = makeEvidence();
    const result = await editFileTool({ path: rel, search: "needle", replace: "changed" }, evidence);

    expectBlocked(result, "mixed line-ending edit_file search");
    assert.equal(result.error, "edit_file: file has mixed line endings; refusing to guess original style");
    assert.equal(await fs.readFile(abs, "utf8"), original);
    assert.deepEqual(evidence.filesWritten, []);
  });
});

add("edit_file read failures are returned instead of thrown", async () => {
  const evidence = makeEvidence();
  const result = await editFileTool({ path: "hatta/workspace", search: "needle", replace: "changed" }, evidence);

  expectBlocked(result, "unreadable edit_file path");
  assert.match(result.error, /^edit_file failed:/);
  assert.deepEqual(evidence.filesWritten, []);
});

add("edit_file refuses empty search text", async () => {
  const original = "alpha\nbeta\n";
  await withTempWorkspaceFile("edit-empty", original, async (rel, abs) => {
    const evidence = makeEvidence();
    const result = await editFileTool({ path: rel, search: "", replace: "changed" }, evidence);

    expectBlocked(result, "empty edit_file search");
    assert.equal(result.error, "edit_file: search text must not be empty");
    assert.equal(await fs.readFile(abs, "utf8"), original);
    assert.deepEqual(evidence.filesWritten, []);
  });
});

add("edit_file refuses outside workspace path with write_file guard error", async () => {
  const outsidePath = "../../Windows/System32/drivers/etc/hosts";
  const result = await editFileTool({ path: outsidePath, search: "x", replace: "y" }, makeEvidence());
  const writeFileGuard = resolveWorkspacePath(outsidePath);

  expectBlocked(result, "outside edit_file path");
  assert.equal(result.error, writeFileGuard.error);
});

add("edit_file refuses protected secret path with write_file guard error", async () => {
  const secretPath = "hatta/workspace/.env.edit-file-test";
  const result = await editFileTool({ path: secretPath, search: "x", replace: "y" }, makeEvidence());
  const writeFileGuard = protectedWorkspacePathReason(secretPath, { write: true });

  expectBlocked(result, "protected edit_file path");
  assert.equal(result.error, writeFileGuard);
});

// ---------------------------------------------------------------------------
// Secret exposure and package-manager control files.
// ---------------------------------------------------------------------------
mustProtectPath("protect gibran api key", "ops-watcher/gibran-api.key");
mustProtectPath("protect env.local..txt", "env.local..txt");
mustProtectPath("protect .env.production", ".env.production");
mustProtectPath("protect package.json writes", "package.json", { write: true });
mustBlockCommand("block type key file", "type", ["ops-watcher/gibran-api.key"]);
mustBlockCommand("block npm exec", "npm", ["exec", "some-package"]);
mustBlockCommand("block npm install", "npm", ["install"]);

// ---------------------------------------------------------------------------
// PACKET-HARNESS-PATH-FILTER: .md files are not credential stores.
// The name-pattern heuristic must not refuse them, but all earlier checks
// (basename, extension, .env. prefix, .git) remain authoritative.
// ---------------------------------------------------------------------------
add("allow docs/packets/PACKET-STEWARD-SECRET-SHAPES.md - .md exempt from name-pattern heuristic", () => {
  assert.equal(protectedWorkspacePathReason("docs/packets/PACKET-STEWARD-SECRET-SHAPES.md"), null);
});
add("allow docs/token-rotation-runbook.md - .md exempt from name-pattern heuristic", () => {
  assert.equal(protectedWorkspacePathReason("docs/token-rotation-runbook.md"), null);
});
add("allow README.md - .md exempt from name-pattern heuristic", () => {
  assert.equal(protectedWorkspacePathReason("README.md"), null);
});

mustProtectPath("still refuse .env.local under .env prefix rule", ".env.local");
mustProtectPath("still refuse .env.production.md under .env prefix rule", ".env.production.md");
mustProtectPath("still refuse config/api-token.json under name-pattern rule", "config/api-token.json");
mustProtectPath("still refuse secrets.md.key under extension rule", "secrets.md.key");
mustProtectPath("still refuse secret-data.json under name-pattern rule", "secret-data.json");
mustProtectPath("still refuse .env under basename rule", ".env");
mustProtectPath("still refuse .git/config - .git rule untouched", ".git/config");

// Plural keyword forms must also be refused.
mustProtectPath("refuse tokens.json (plural of token)", "tokens.json");
mustProtectPath("refuse secrets.md.key (plural of secret)", "secrets.md.key");
mustProtectPath("refuse credentials.json (plural of credential)", "credentials.json");
mustProtectPath("refuse passwords.csv (plural of password)", "passwords.csv");
mustProtectPath("refuse api-keys.json (plural of api-key)", "api-keys.json");
mustProtectPath("refuse apikeys.txt (plural of apikey)", "apikeys.txt");

// Keyword embedded in a longer word must NOT be refused.
assert.ok(!protectedWorkspacePathReason("tokenisation.mjs"), "tokenisation.mjs is not secret-like; keyword is part of a longer word");

// Lexical path escapes.
mustBlockPath("block relative path escape", "../../Windows/System32/drivers/etc/hosts");
mustBlockPath("block absolute path escape", "C:/Windows/System32");

// Realpath escape: a junction/symlink inside the workspace that points outside
// must be refused. This creates only a test link and a temp dir, then unlinks
// the link rather than deleting through it.
add("block junction/symlink realpath escape", async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "hatta-outside-"));
  const linkRel = `hatta/_security_link_${process.pid}_${Date.now()}`;
  const linkAbs = path.join(WORKSPACE_ROOT, linkRel);
  try {
    await fs.symlink(outside, linkAbs, process.platform === "win32" ? "junction" : "dir");
  } catch (err) {
    skipped += 1;
    console.log(`SKIP  | ${err.code || err.message} while creating symlink/junction`);
    await fs.rm(outside, { recursive: true, force: true }).catch(() => {});
    return;
  }
  try {
    expectBlocked(resolveWorkspacePath(`${linkRel}/escape.txt`), "realpath escape through workspace link");
  } finally {
    await fs.unlink(linkAbs).catch(() => {});
    await fs.rm(outside, { recursive: true, force: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Model tiers and retired/missing model surfacing (PACKET-MODEL-TIERS).
// ---------------------------------------------------------------------------

add("MODEL_TIERS has exactly code/heavy/light, each a non-empty :cloud string", () => {
  assert.deepEqual(Object.keys(MODEL_TIERS).sort(), ["code", "heavy", "light"]);
  for (const [tier, model] of Object.entries(MODEL_TIERS)) {
    assert.equal(typeof model, "string", `${tier} must be a string`);
    assert.ok(model.length > 0, `${tier} must be non-empty`);
    assert.ok(model.endsWith(":cloud"), `${tier} must end in :cloud`);
  }
  assert.ok(Object.isFrozen(MODEL_TIERS), "MODEL_TIERS must be frozen");
});

add("resolveModel defaults to MODEL_TIERS.code when OLLAMA_MODEL_HATTA is unset", () => {
  assert.equal(resolveModel(undefined), MODEL_TIERS.code);
  assert.equal(resolveModel(""), MODEL_TIERS.code);
});

add("resolveModel lets an explicit OLLAMA_MODEL_HATTA win (comparison runs depend on it)", () => {
  const original = process.env.OLLAMA_MODEL_HATTA;
  process.env.OLLAMA_MODEL_HATTA = "glm-5.2:cloud";
  try {
    assert.equal(resolveModel(), "glm-5.2:cloud");
  } finally {
    if (original === undefined) delete process.env.OLLAMA_MODEL_HATTA;
    else process.env.OLLAMA_MODEL_HATTA = original;
  }
});

add("postChat surfaces 'was retired at' as OllamaModelUnavailableError, not a timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: "glm-4.7 was retired at 2026-07-15 00:00:00" }),
    { status: 404, headers: { "content-type": "application/json" } },
  );
  try {
    await assert.rejects(
      () => postChat([{ role: "user", content: "x" }]),
      (err) => err instanceof OllamaModelUnavailableError
        && err.name === "OllamaModelUnavailableError"
        && err.message.includes("was retired at")
        && err.message.includes(MODEL_TIERS.code)
        && !(err instanceof OllamaChatTimeoutError),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

add("postChat surfaces 'not found' as OllamaModelUnavailableError, not a timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: "model 'glm-5.1-flash' not found" }),
    { status: 404, headers: { "content-type": "application/json" } },
  );
  try {
    await assert.rejects(
      () => postChat([{ role: "user", content: "x" }]),
      (err) => err instanceof OllamaModelUnavailableError
        && err.name === "OllamaModelUnavailableError"
        && err.message.includes("not found")
        && !(err instanceof OllamaChatTimeoutError),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

add("postChat still maps a genuine abort to OllamaChatTimeoutError, never to retirement", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    throw err;
  };
  try {
    await assert.rejects(
      () => postChat([{ role: "user", content: "x" }]),
      (err) => err instanceof OllamaChatTimeoutError
        && err.name === "OllamaChatTimeoutError"
        && !(err instanceof OllamaModelUnavailableError),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const c of cases) {
  try {
    await c.fn();
    console.log(`PASS  | ${c.label}`);
    passed += 1;
  } catch (err) {
    console.log(`FAIL  | ${c.label}`);
    console.log(`       ${err && err.stack ? err.stack : err}`);
    failed += 1;
  }
}

console.log("");
console.log(`ADVERSARIAL HARNESS TEST SUMMARY: ${passed} passed, ${failed} failed, ${skipped} skipped.`);
if (failed > 0) process.exitCode = 1;




