// Offline regression tests for HATTA harness chat-history compaction.
// No Ollama call, no network: runTask is driven by an injected chat function.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { OllamaChatTimeoutError, postChat, runTask } from "../hatta/harness.mjs";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WORKSPACE_TMP = path.join(ROOT, "hatta", "workspace");

let passed = 0, failed = 0;
const failures = [];
const ok = (name) => { console.log(`PASS: ${name}`); passed += 1; };
const bad = (name, err) => {
  console.log(`FAIL: ${name}`);
  if (err) console.log(`       ${err && err.stack ? err.stack : err}`);
  failures.push(name);
  failed += 1;
};

async function t(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

function toolCall(name, args) {
  return {
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function makeChat(responses, snapshots) {
  return async (messages) => {
    snapshots.push(JSON.parse(JSON.stringify(messages)));
    const response = responses.shift();
    assert.ok(response, "chat called more times than expected");
    return response;
  };
}

function fixedClock() {
  const timestamps = [
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:01.000Z",
    "2026-01-01T00:00:02.000Z",
    "2026-01-01T00:00:03.000Z",
  ];
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)];
}

function readFileResults(snapshot) {
  return snapshot
    .filter((message) => message.role === "tool" && message.name === "read_file")
    .map((message) => JSON.parse(message.content));
}

async function withWorkspaceFiles(files, fn) {
  await fs.mkdir(WORKSPACE_TMP, { recursive: true });
  const written = [];
  for (const [name, content] of Object.entries(files)) {
    const rel = `hatta/workspace/${name}-${process.pid}-${Date.now()}.txt`;
    const abs = path.join(ROOT, rel);
    await fs.writeFile(abs, content, "utf8");
    written.push({ rel, reportedPath: path.relative(ROOT, abs), abs, content });
  }

  try {
    await fn(written);
  } finally {
    await Promise.all(written.map((file) => fs.rm(file.abs, { force: true }).catch(() => {})));
  }
}

await t("H1 a single read_file result keeps content for the next model call", async () => {
  await withWorkspaceFiles({ one: "alpha\nbeta\n" }, async ([file]) => {
    const snapshots = [];
    const evidence = await runTask("read once", {
      chat: makeChat([
        { message: { role: "assistant", content: "", tool_calls: [toolCall("read_file", { path: file.rel })] } },
        { message: { role: "assistant", content: "done" } },
      ], snapshots),
      persist: async () => {},
      now: fixedClock(),
    });

    assert.equal(evidence.ok, true);
    assert.equal(snapshots.length, 2);

    const reads = readFileResults(snapshots[1]);
    assert.equal(reads.length, 1);
    assert.equal(reads[0].path, file.reportedPath);
    assert.equal(reads[0].content, file.content);
    assert.equal(reads[0].content_elided, undefined);
  });
});

await t("H2 older read_file bodies are elided after a newer read_file result exists", async () => {
  await withWorkspaceFiles({
    first: "first file body\n".repeat(20),
    second: "second file body\n".repeat(20),
  }, async ([first, second]) => {
    const snapshots = [];
    const evidence = await runTask("read twice", {
      chat: makeChat([
        { message: { role: "assistant", content: "", tool_calls: [toolCall("read_file", { path: first.rel })] } },
        { message: { role: "assistant", content: "", tool_calls: [toolCall("read_file", { path: second.rel })] } },
        { message: { role: "assistant", content: "done" } },
      ], snapshots),
      persist: async () => {},
      now: fixedClock(),
    });

    assert.equal(evidence.ok, true);
    assert.equal(snapshots.length, 3);

    const reads = readFileResults(snapshots[2]);
    assert.equal(reads.length, 2);
    assert.deepEqual(reads[0], {
      ok: true,
      path: first.reportedPath,
      bytes: Buffer.byteLength(first.content, "utf8"),
      content_elided: true,
      note: "Content dropped from chat history after a newer read_file result. Call read_file again with this path to reload it.",
    });
    assert.equal(Object.hasOwn(reads[0], "content"), false);
    assert.equal(reads[1].path, second.reportedPath);
    assert.equal(reads[1].content, second.content);
    assert.equal(reads[1].content_elided, undefined);
  });
});

await t("H3 a later non-read tool result does not elide the only live read_file body", async () => {
  await withWorkspaceFiles({ one: "still needed\n" }, async ([file]) => {
    const snapshots = [];
    const evidence = await runTask("read then echo", {
      chat: makeChat([
        { message: { role: "assistant", content: "", tool_calls: [toolCall("read_file", { path: file.rel })] } },
        { message: { role: "assistant", content: "", tool_calls: [toolCall("run_command", { command: "echo", args: ["ok"] })] } },
        { message: { role: "assistant", content: "done" } },
      ], snapshots),
      persist: async () => {},
      now: fixedClock(),
    });

    assert.equal(evidence.ok, true);
    assert.equal(snapshots.length, 3);

    const reads = readFileResults(snapshots[2]);
    assert.equal(reads.length, 1);
    assert.equal(reads[0].content, file.content);
    assert.equal(reads[0].content_elided, undefined);
  });
});

await t("H4 rereading the same path elides the earlier copy and keeps the newest copy", async () => {
  await withWorkspaceFiles({ repeat: "same path body\n".repeat(12) }, async ([file]) => {
    const snapshots = [];
    const evidence = await runTask("read same file twice", {
      chat: makeChat([
        { message: { role: "assistant", content: "", tool_calls: [toolCall("read_file", { path: file.rel })] } },
        { message: { role: "assistant", content: "", tool_calls: [toolCall("read_file", { path: file.rel })] } },
        { message: { role: "assistant", content: "done" } },
      ], snapshots),
      persist: async () => {},
      now: fixedClock(),
    });

    assert.equal(evidence.ok, true);
    assert.equal(snapshots.length, 3);

    const reads = readFileResults(snapshots[2]);
    assert.equal(reads.length, 2);
    assert.equal(reads[0].path, file.reportedPath);
    assert.equal(reads[0].bytes, Buffer.byteLength(file.content, "utf8"));
    assert.equal(reads[0].content_elided, true);
    assert.equal(Object.hasOwn(reads[0], "content"), false);
    assert.equal(reads[1].path, file.reportedPath);
    assert.equal(reads[1].content, file.content);
    assert.equal(reads[1].content_elided, undefined);
  });
});

await t("H5 read_file schema advertises offset and limit", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "done" } }),
    };
  };

  try {
    await postChat([{ role: "user", content: "schema check" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const readTool = capturedBody.tools.find((tool) => tool.function.name === "read_file");
  assert.ok(readTool, "read_file tool schema must be sent to Ollama");
  const props = readTool.function.parameters.properties;
  assert.equal(props.offset.type, "integer");
  assert.match(props.offset.description, /0-based line index/);
  assert.equal(props.limit.type, "integer");
  assert.match(props.limit.description, /Number of lines/);
  assert.deepEqual(readTool.function.parameters.required, ["path"]);
});

await t("H6 read_file returns a requested line slice with total and range metadata", async () => {
  await withWorkspaceFiles({ slice: "zero\none\ntwo\nthree\n" }, async ([file]) => {
    const snapshots = [];
    const evidence = await runTask("read a slice", {
      chat: makeChat([
        { message: { role: "assistant", content: "", tool_calls: [toolCall("read_file", { path: file.rel, offset: 1, limit: 2 })] } },
        { message: { role: "assistant", content: "done" } },
      ], snapshots),
      persist: async () => {},
      now: fixedClock(),
    });

    assert.equal(evidence.ok, true);
    const reads = readFileResults(snapshots[1]);
    assert.equal(reads.length, 1);
    assert.equal(reads[0].content, "one\ntwo\n");
    assert.equal(reads[0].totalLines, 4);
    assert.deepEqual(reads[0].range, { offset: 1, limit: 2 });
    assert.equal(reads[0].hasMoreBefore, true);
    assert.equal(reads[0].hasMoreAfter, true);
  });
});

await t("H7 read_file clamps negative offset, oversized limit, and past-end offset", async () => {
  await withWorkspaceFiles({ clamp: "a\nb\nc\n" }, async ([file]) => {
    const snapshots = [];
    const evidence = await runTask("read clamped slices", {
      chat: makeChat([
        { message: { role: "assistant", content: "", tool_calls: [toolCall("read_file", { path: file.rel, offset: -50, limit: 99 })] } },
        { message: { role: "assistant", content: "", tool_calls: [toolCall("read_file", { path: file.rel, offset: 99, limit: 10 })] } },
        { message: { role: "assistant", content: "done" } },
      ], snapshots),
      persist: async () => {},
      now: fixedClock(),
    });

    assert.equal(evidence.ok, true);

    const firstRead = readFileResults(snapshots[1])[0];
    assert.equal(firstRead.content, file.content);
    assert.equal(firstRead.totalLines, 3);
    assert.deepEqual(firstRead.range, { offset: 0, limit: 3 });
    assert.equal(firstRead.hasMoreBefore, false);
    assert.equal(firstRead.hasMoreAfter, false);

    const finalReads = readFileResults(snapshots[2]);
    assert.equal(finalReads.length, 2);
    assert.equal(finalReads[1].content, "");
    assert.equal(finalReads[1].totalLines, 3);
    assert.deepEqual(finalReads[1].range, { offset: 3, limit: 0 });
    assert.equal(finalReads[1].hasMoreBefore, true);
    assert.equal(finalReads[1].hasMoreAfter, false);
  });
});

await t("H8 postChat AbortError is recorded as timedOut in runTask evidence", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = process.env.HATTA_REQUEST_TIMEOUT_MS;
  process.env.HATTA_REQUEST_TIMEOUT_MS = "1";
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    const abort = () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (options.signal.aborted) abort();
    else options.signal.addEventListener("abort", abort, { once: true });
  });

  try {
    const evidence = await runTask("real abort timeout", {
      chat: postChat,
      persist: async () => {},
      now: fixedClock(),
    });

    assert.equal(evidence.ok, false);
    assert.equal(evidence.timedOut, true);
    assert.equal(evidence.error, "Ollama chat timed out after 1ms");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTimeout === undefined) delete process.env.HATTA_REQUEST_TIMEOUT_MS;
    else process.env.HATTA_REQUEST_TIMEOUT_MS = originalTimeout;
  }
});

await t("H9 only the typed inner timeout error sets evidence.timedOut", async () => {
  const textOnly = await runTask("this task text says Ollama chat timed out after 1ms", {
    chat: async () => { throw new Error("Ollama chat timed out after 1ms"); },
    persist: async () => {},
    now: fixedClock(),
  });
  assert.equal(textOnly.ok, false);
  assert.equal(textOnly.timedOut, false);

  const typed = await runTask("typed timeout", {
    chat: async () => { throw new OllamaChatTimeoutError(123); },
    persist: async () => {},
    now: fixedClock(),
  });
  assert.equal(typed.ok, false);
  assert.equal(typed.timedOut, true);
  assert.equal(typed.error, "Ollama chat timed out after 123ms");
});

await t("H10 network errors, HTTP errors, and failed tool results are not timeouts", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
    const network = await runTask("network refusal", {
      chat: postChat,
      persist: async () => {},
      now: fixedClock(),
    });
    assert.equal(network.ok, false);
    assert.equal(network.timedOut, false);
    assert.equal(network.error, "ECONNREFUSED");

    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => "provider unavailable",
    });
    const http = await runTask("http error", {
      chat: postChat,
      persist: async () => {},
      now: fixedClock(),
    });
    assert.equal(http.ok, false);
    assert.equal(http.timedOut, false);
    assert.match(http.error, /Ollama chat failed: HTTP 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const failedTool = await runTask("missing file", {
    chat: makeChat([
      { message: { role: "assistant", content: "", tool_calls: [toolCall("read_file", { path: "hatta/workspace/does-not-exist-for-timeout-test.txt" })] } },
      { message: { role: "assistant", content: "done" } },
    ], []),
    persist: async () => {},
    now: fixedClock(),
  });
  assert.equal(failedTool.ok, true);
  assert.equal(failedTool.timedOut, false);
  assert.equal(failedTool.toolCalls.length, 1);
  assert.equal(failedTool.toolCalls[0].ok, false);
});

await t("H11 default MAX_ITERATIONS agrees with the outer budget over per-call timeout", async () => {
  // MAX_ITERATIONS is fixed at import time, so probe it in fresh child
  // processes with different env. The child drives runTask with a chat that
  // never produces a final answer, so the loop must end at the ceiling itself.
  const probe = `
    import(${JSON.stringify(pathToFileURL(path.join(ROOT, "hatta", "harness.mjs")).href)})
      .then(async (m) => {
        const evidence = await m.runTask("loop forever", {
          chat: async () => ({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "unknown_probe_tool", arguments: "{}" } }] } }),
          persist: async () => {},
        });
        console.log(JSON.stringify({ iterations: evidence.iterations, error: evidence.error }));
      });
  `;
  const runProbe = async (env) => {
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", probe], {
      env: { ...process.env, ...env },
    });
    return JSON.parse(stdout.trim().split("\n").at(-1));
  };

  // 480000 / 120000 = 4. The old default of 40 was never reachable.
  const defaultRun = await runProbe({});
  assert.equal(defaultRun.iterations, 4);
  // The message must name the ceiling AND the bound that produced it. "Reached
  // 4" alone reads as a bug; the arithmetic reads as a fact somebody can act on.
  assert.match(defaultRun.error, /Reached MAX_ITERATIONS \(4, set by the 480000ms outer budget over a 120000ms per-call timeout\)/);

  // HATTA_MAX_ITER can only LOWER the ceiling.
  const lowerOverride = await runProbe({ HATTA_MAX_ITER: "2" });
  assert.equal(lowerOverride.iterations, 2, "an explicit ceiling below the derived one wins");
  assert.match(lowerOverride.error, /set by HATTA_MAX_ITER=2/);

  // It must NOT raise it. This is the case that was asserted backwards: an
  // explicit 6 used to win outright, which reintroduces the exact bug being
  // fixed — the outer wrapper still kills the run at 480000ms, and the failure
  // surfaces as an opaque outer timeout instead of the harness's own evidence.
  // The budget is a physical bound; the override is a preference.
  const higherOverride = await runProbe({ HATTA_MAX_ITER: "40" });
  assert.equal(higherOverride.iterations, 4, "an explicit ceiling above the budget does NOT win");

  // Halving the per-call timeout doubles what the same budget affords.
  const scaledRun = await runProbe({ HATTA_REQUEST_TIMEOUT_MS: "60000" });
  assert.equal(scaledRun.iterations, 8);

  // A budget smaller than a single call still yields at least 1, never 0.
  const tinyBudget = await runProbe({ HATTA_OUTER_RUN_BUDGET_MS: "1000" });
  assert.equal(tinyBudget.iterations, 1, "the floor is 1 iteration, not 0");
});

console.log("");
console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
