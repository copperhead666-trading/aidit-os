// ops-watcher/ahmad-mcp-server.mjs
// Minimal, dependency-free MCP (Model Context Protocol) stdio server that gives
// a headless AHMAD dispatch (ops-watcher/ahmad-dispatch.mjs spawning
// `claude -p ... --mcp-config ...`) a SCOPED command-execution tool, in place
// of the built-in Bash tool (which the dispatcher disallows entirely via
// --disallowedTools). This exists because CLI-level `--allowedTools
// "Bash(node *)"` sub-pattern scoping was empirically verified (live, 2026-08-28,
// 5 separate `claude -p` calls) to NOT restrict Bash in this trusted workspace —
// only whole-tool `--disallowedTools` removal actually enforces anything. So the
// real scoping boundary here is: Bash/Write/Edit/NotebookEdit removed entirely,
// and this server's single `run_command` tool is the ONLY way headless AHMAD can
// execute anything.
//
// Deliberately narrower than hatta/harness.mjs's allowlist (git, npm, bun, rg
// all excluded here), not a smaller copy of it. Reason: the independent harness
// security audit recorded in config/agent-registry.json
// (independent_harness_security_audit_2026-08-28) found REAL, NOT-YET-FIXED
// CRITICAL bypasses in that exact validator shape — F1 `git -c alias.x='!...'`
// shell escape, F2 `bun x <pkg>`, F3 `rg --pre <binary>` — none of which are
// remediated yet. Reusing that allowlist here (an automatically-triggered path,
// fired by remote Telegram input) would inherit those same holes. Since AHMAD's
// actual job in this dispatch (process/delegate/report) only ever needs to run
// `node <one of a fixed list of .mjs scripts>`, git/npm/bun/rg are dropped
// entirely rather than carried over with known holes.
//
// Command shape enforced (see validateRunCommand, the exported pure function —
// unit-tested offline in ahmad-mcp-server.regression.test.mjs with NO real MCP
// protocol or child process involved):
//   - exe MUST be exactly "node".
//   - argv[1] (the script) MUST be one of ALLOWED_SCRIPTS (below), resolved
//     against the workspace root and confirmed to exist on disk.
//   - No argument may start with "-" UNLESS it is exactly one of
//     ALLOWED_FLAGS ("--once"). This closes the node -e/--eval/-p/--print/
//     --import=data: inline-eval smuggling class (F6 in the same audit) by
//     construction: node only treats args BEFORE the script path as its own
//     flags, so once argv[1] is a verified real .mjs file, everything after it
//     is passed through to the script's own argv, never reinterpreted as a node
//     flag — but a caller could still try to sneak "--eval" etc. as a script
//     ARGUMENT hoping some layer misparses it, so it is denied outright anyway.
//   - Everything after the (optional) flag is free-form text (e.g. the task
//     prompt handed to hatta/harness.mjs) — this is DATA to the child script,
//     never re-parsed as a command/flag by node or this server.
//   - Workspace-root confinement: the resolved script path must stay inside
//     REPO_ROOT (no ../ escape), mirroring hatta/harness.mjs's own path jail.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Fixed, hand-maintained list (NOT a directory scan — a stray new script must
// never silently become runnable by headless AHMAD). Add to this list only
// deliberately.
export const ALLOWED_SCRIPTS = [
  "hatta/harness.mjs",
  "ops-watcher/test-runner.mjs",
  "ops-watcher/review-runner.mjs",
  "ops-watcher/telegram-notify.mjs",
  "ops-watcher/ahmad-notify.mjs",
  "ops-watcher/heartbeat.mjs",
  "ops-watcher/ahmad-dispatch.mjs",
  "ops-watcher/steward.mjs",
  "ops-watcher/sjahrir-dispatch.mjs",
  "ops-watcher/corleone-dispatch.mjs",
  "ops-watcher/ahmad-escalate.mjs",
  "ops-watcher/hatta-flash-dispatch.mjs",
  "ops-watcher/hatta-dispatch.mjs",
  "ops-watcher/graphify-analyst.mjs",
];
const ALLOWED_FLAGS = new Set(["--once"]);
const RUN_TIMEOUT_MS = 9 * 60 * 1000; // under heartbeat.mjs's 10-min per-step cap
const OUTPUT_CAP = 8000;

function cap(s, n = OUTPUT_CAP) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + `\n...[truncated ${s.length - n} bytes]` : s;
}

// ---- Pure validator (no I/O beyond the sync-safe path check below is async,
// so this is exported async but does nothing but string/path checks). ----
export async function validateRunCommand({ exe, args } = {}) {
  if (exe !== "node") return { ok: false, reason: `exe must be "node", got ${JSON.stringify(exe)}` };
  const argv = Array.isArray(args) ? args : [];
  if (argv.length === 0) return { ok: false, reason: "missing script argument" };
  const scriptArg = argv[0];
  if (typeof scriptArg !== "string" || scriptArg.startsWith("-")) {
    return { ok: false, reason: "first argument must be a script path, not a flag" };
  }
  const normalized = scriptArg.replace(/\\/g, "/");
  if (!ALLOWED_SCRIPTS.includes(normalized)) {
    return { ok: false, reason: `script not in ALLOWED_SCRIPTS: ${normalized}` };
  }
  const resolved = path.resolve(REPO_ROOT, normalized);
  const rel = path.relative(REPO_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, reason: "script path escapes workspace root" };
  }
  let exists = false;
  try {
    const st = await fs.stat(resolved);
    exists = st.isFile();
  } catch {
    exists = false;
  }
  if (!exists) return { ok: false, reason: `script does not exist on disk: ${normalized}` };

  // Remaining args: only ALLOWED_FLAGS may start with "-"; anything else
  // starting with "-" is rejected outright (defense in depth — see file header
  // on why this is belt-and-braces, not the primary defense).
  for (const a of argv.slice(1)) {
    if (typeof a === "string" && a.startsWith("-") && !ALLOWED_FLAGS.has(a)) {
      return { ok: false, reason: `argument not allowed: ${a}` };
    }
  }
  return { ok: true, scriptPath: resolved };
}

// Real command runner (spawn, shell:false, bounded timeout). Never throws.
export function runCommandReal(exe, argv, { timeoutMs = RUN_TIMEOUT_MS, cwd = REPO_ROOT } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(exe, argv, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      resolve({ code: null, stdout: "", stderr: String(err && err.message), timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(err && err.message), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

// ---- Tool implementation (dependency-injected run for testability) ----
export async function handleRunCommand(args, { run = runCommandReal } = {}) {
  const v = await validateRunCommand({ exe: "node", args: Array.isArray(args && args.args) ? args.args : [] });
  if (!v.ok) {
    return { isError: true, content: [{ type: "text", text: `DENIED: ${v.reason}` }] };
  }
  const argv = Array.isArray(args.args) ? args.args : [];
  const r = await run("node", argv, {});
  const text =
    `exit=${r.code === null ? "null" : r.code}${r.timedOut ? " (timeout)" : ""}\n` +
    `--- stdout ---\n${cap(r.stdout)}\n--- stderr ---\n${cap(r.stderr)}\n`;
  return { isError: r.code !== 0, content: [{ type: "text", text }] };
}

const TOOL_DEF = {
  name: "run_command",
  description:
    "Run a scoped, pre-approved node script (see ALLOWED_SCRIPTS in ops-watcher/ahmad-mcp-server.mjs — hatta/harness.mjs to delegate implementation, and a fixed set of ops-watcher/*.mjs scripts). Only 'node <allowed-script> [--once] [free-form data args]' is accepted; anything else is DENIED. This is the ONLY command-execution tool available in this session (Bash is disallowed).",
  inputSchema: {
    type: "object",
    properties: {
      args: {
        type: "array",
        items: { type: "string" },
        description:
          "argv passed to node, e.g. [\"hatta/harness.mjs\", \"<task prompt text>\"] or [\"ops-watcher/review-runner.mjs\", \"--once\"].",
      },
    },
    required: ["args"],
  },
};

// ---- Minimal MCP stdio server (newline-delimited JSON-RPC 2.0, no SDK — this
// workspace's convention is dependency-free Node built-ins only). ----
export function makeServer({ run = runCommandReal, write = (s) => process.stdout.write(s) } = {}) {
  function send(obj) {
    write(JSON.stringify(obj) + "\n");
  }
  async function handleMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    const { id, method, params } = msg;
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: (params && params.protocolVersion) || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "ahmad-mcp-server", version: "1.0.0" },
        },
      });
      return;
    }
    if (method === "notifications/initialized") {
      return; // no response for notifications
    }
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: [TOOL_DEF] } });
      return;
    }
    if (method === "tools/call") {
      const name = params && params.name;
      const toolArgs = (params && params.arguments) || {};
      if (name !== "run_command") {
        send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: `unknown tool: ${name}` }] } });
        return;
      }
      const result = await handleRunCommand(toolArgs, { run });
      send({ jsonrpc: "2.0", id, result });
      return;
    }
    if (id !== undefined) {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
    }
  }
  return { handleMessage, send };
}

function main() {
  const server = makeServer();
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return; // ignore malformed lines rather than crashing the server
    }
    server.handleMessage(msg).catch((err) => {
      try {
        process.stderr.write(`ahmad-mcp-server: handler error: ${err && err.stack ? err.stack : err}\n`);
      } catch { /* ignore */ }
    });
  });
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) main();