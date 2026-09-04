// Offline regression tests for HATTA harness chat-history compaction.
// No Ollama call, no network: runTask is driven by an injected chat function.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTask } from "../hatta/harness.mjs";

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

console.log("");
console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
