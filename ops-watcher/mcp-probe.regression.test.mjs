// ops-watcher/mcp-probe.regression.test.mjs
// Offline regression tests for the repository MCP probe. NO real GitHub calls
// and NO real child process spawn; the transport is injected.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import {
  parseMcpConfigText,
  parseMcpFrames,
  probeMcpConfig,
  formatProbeReport,
  runMcpStdioProbe,
} from "./mcp-probe.mjs";

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(`       ${e && e.stack ? e.stack : e}`);
  failures.push(n);
  failed++;
};

async function t(name, fn) {
  try { await fn(); ok(name); } catch (e) { bad(name, e); }
}

const SECRET = "ghp_super_secret_value_that_must_not_leak_1234567890";

function fakeReadFileFrom(textOrError) {
  return async () => {
    if (textOrError instanceof Error) throw textOrError;
    return textOrError;
  };
}

function fakeLoadEnv(values = {}) {
  return (names) => {
    const found = {};
    const out = {};
    for (const name of names) {
      const value = values[name] || "";
      found[name] = value.length > 0;
      out[name] = value;
    }
    return { found, values: out };
  };
}

function encodeFrame(obj) {
  const body = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

const VALID_CONFIG = JSON.stringify({
  mcpServers: {
    github: {
      command: "D:\\AI\\tools\\github-mcp-server\\github-mcp-server.exe",
      args: ["stdio"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" },
    },
  },
});

await t("(1) valid .mcp.json parses and yields a server list", () => {
  const parsed = parseMcpConfigText(VALID_CONFIG);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.servers.length, 1);
  assert.equal(parsed.servers[0].name, "github");
});

await t("(1b) shared .mcp.json is not ignored by git", () => {
  const checked = spawnSync("git", ["check-ignore", "-q", ".mcp.json"], {
    cwd: new URL("..", import.meta.url),
    windowsHide: true,
    shell: false,
  });
  assert.notEqual(checked.status, 0, ".mcp.json must be trackable shared configuration");
});

await t("(1c) GitHub MCP config uses native binary, not Docker", () => {
  const parsed = parseMcpConfigText(VALID_CONFIG);
  const github = parsed.config.mcpServers.github;
  assert.notEqual(github.command, "docker", "GitHub MCP must not depend on Docker on this host");
  assert.deepEqual(github.args, ["stdio"], "native GitHub MCP server runs in stdio mode");
  assert.equal(github.env.GITHUB_PERSONAL_ACCESS_TOKEN, "${GITHUB_TOKEN}", "shared config stores env ref, not literal token");
});

await t("(1d) MCP parser accepts content-length and JSON-line stdio messages", () => {
  const framed = encodeFrame({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "framed" } } });
  const lines = [
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "line" } } }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [] } }),
    "",
  ].join("\n");

  assert.equal(parseMcpFrames(framed)[0].result.serverInfo.name, "framed");
  assert.equal(parseMcpFrames(lines).length, 2);
});

await t("(2) missing .mcp.json is reported as a reason, not thrown", async () => {
  const err = new Error("ENOENT: no such file or directory, open '.mcp.json'");
  err.code = "ENOENT";
  const report = await probeMcpConfig({
    readFile: fakeReadFileFrom(err),
    transport: async () => {
      throw new Error("transport must not run");
    },
  });
  assert.equal(report.ok, false);
  assert.match(report.reason, /ENOENT|no such file/i);
  assert.doesNotThrow(() => formatProbeReport(report));
});

await t("(3) malformed .mcp.json is reported as a reason, not thrown", async () => {
  const report = await probeMcpConfig({
    readFile: fakeReadFileFrom("{ mcpServers: ["),
    transport: async () => {
      throw new Error("transport must not run");
    },
  });
  assert.equal(report.ok, false);
  assert.match(report.reason, /invalid JSON/i);
  assert.doesNotThrow(() => formatProbeReport(report));
});

await t("(4) server without credentials is not configured, not failed", async () => {
  let transportCalls = 0;
  const report = await probeMcpConfig({
    readFile: fakeReadFileFrom(VALID_CONFIG),
    loadEnv: fakeLoadEnv({}),
    transport: async () => {
      transportCalls++;
      return { ok: true, reason: "should not happen" };
    },
  });
  assert.equal(report.ok, true);
  assert.equal(report.servers.length, 1);
  assert.equal(report.servers[0].registered, true);
  assert.equal(report.servers[0].configured, false);
  assert.equal(report.servers[0].reachable, null);
  assert.match(report.servers[0].reason, /missing required env: GITHUB_TOKEN/);
  assert.equal(transportCalls, 0, "unconfigured servers must not be spawned");
});

await t("(5) configured server uses injected transport and reports reachable", async () => {
  let seenToken = null;
  const report = await probeMcpConfig({
    readFile: fakeReadFileFrom(VALID_CONFIG),
    loadEnv: fakeLoadEnv({ GITHUB_TOKEN: SECRET }),
    transport: async (_server, { env }) => {
      seenToken = env.GITHUB_PERSONAL_ACCESS_TOKEN;
      return { ok: true, reason: "initialize and tools/list succeeded", toolCount: 42 };
    },
  });
  assert.equal(seenToken, SECRET);
  assert.equal(report.servers[0].configured, true);
  assert.equal(report.servers[0].reachable, true);
  assert.equal(report.servers[0].toolCount, 42);
});

await t("(6) probe report never prints credential values", async () => {
  const report = await probeMcpConfig({
    readFile: fakeReadFileFrom(VALID_CONFIG),
    loadEnv: fakeLoadEnv({ GITHUB_TOKEN: SECRET }),
    transport: async () => ({ ok: false, reason: `auth failed for Bearer ${SECRET}` }),
  });
  const text = formatProbeReport(report);
  assert.equal(text.includes(SECRET), false, `secret leaked into report: ${text}`);
  assert.match(text, /Bearer \[redacted\]/);
  assert.match(text, /secret GITHUB_TOKEN: present \(length \d+\)/);
});

await t("(7) stdio probe waits for initialize response before tools/list", async () => {
  const writes = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: (chunk) => { writes.push(String(chunk)); return true; } };
  child.kill = () => {};

  const resultPromise = runMcpStdioProbe(
    { command: "fake-github-mcp", args: ["stdio"] },
    { spawnFn: () => child, timeoutMs: 1000 },
  );

  assert.match(writes.join(""), /"method":"initialize"/);
  assert.equal(writes[0].startsWith("Content-Length:"), false, "GitHub MCP native server expects JSON-line stdio");
  assert.equal(writes.join("").includes('"method":"tools/list"'), false);

  child.stdout.emit("data", Buffer.from(encodeFrame({
    jsonrpc: "2.0",
    id: 1,
    result: { serverInfo: { name: "fake", version: "1.0.0" } },
  })));

  assert.match(writes.join(""), /"method":"notifications\/initialized"/);
  assert.match(writes.join(""), /"method":"tools\/list"/);

  child.stdout.emit("data", Buffer.from(encodeFrame({
    jsonrpc: "2.0",
    id: 2,
    result: { tools: [{ name: "get_issue" }] },
  })));

  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(result.toolCount, 1);
});

console.log("");
console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
