// ops-watcher/mcp-probe.mjs
// Read-only probe for repository-level MCP configuration.
//
//   node ops-watcher/mcp-probe.mjs
//
// It reports three separate states per server:
//   registered   - present in .mcp.json
//   configured   - command shape and required secret references are available
//   reachable    - a live MCP initialize + tools/list round trip succeeded
//
// Secret values are never printed. Tests inject the transport so they do not
// call real MCP servers.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadLocalEnv, describeSecretPresence } from "./local-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export const DEFAULT_MCP_CONFIG_FILE = path.join(REPO_ROOT, ".mcp.json");
export const DEFAULT_TIMEOUT_MS = 15000;
export const ALLOWED_GITHUB_REPOSITORIES = [
  "copperhead666-trading/aidit-os",
  "copperhead666-trading/caveman-trading-os",
];

const SECRET_NAME_RE = /(?:TOKEN|SECRET|PASSWORD|KEY|PAT|CREDENTIAL)/i;

function safeReason(err) {
  const msg = err && err.message ? err.message : String(err || "unknown error");
  return msg.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

function redactKnownSecrets(text, values) {
  let out = safeReason(text);
  for (const value of values || []) {
    if (typeof value !== "string" || value.length === 0) continue;
    out = out.split(value).join("[redacted]");
  }
  return out;
}

function parseEnvRef(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const braced = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(trimmed);
  if (braced) return braced[1];
  const bare = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  if (bare) return bare[1];
  return null;
}

function isSecretEnvKey(key) {
  return SECRET_NAME_RE.test(String(key || ""));
}

function normalizeServers(config) {
  const servers = config?.mcpServers || config?.servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return [];
  return Object.keys(servers).sort().map((name) => ({ name, config: servers[name] || {} }));
}

export function parseMcpConfigText(text) {
  try {
    const config = JSON.parse(String(text || ""));
    const servers = normalizeServers(config);
    return { ok: true, config, servers, reason: null };
  } catch (err) {
    return { ok: false, config: null, servers: [], reason: `invalid JSON: ${safeReason(err)}` };
  }
}

export async function readMcpConfig({ file = DEFAULT_MCP_CONFIG_FILE, readFile = fs.readFile } = {}) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    const code = err && err.code ? `${err.code}: ` : "";
    return { ok: false, config: null, servers: [], reason: `${code}${safeReason(err)}` };
  }
  return parseMcpConfigText(text);
}

export function requiredEnvNamesForServer(serverConfig) {
  const names = new Set();
  const env = serverConfig && typeof serverConfig.env === "object" ? serverConfig.env : {};
  for (const [targetName, rawValue] of Object.entries(env || {})) {
    const ref = parseEnvRef(rawValue);
    if (ref && isSecretEnvKey(targetName)) names.add(ref);
  }
  return [...names].sort();
}

export function resolveServerEnv(serverConfig, { env = process.env, loadEnv = loadLocalEnv } = {}) {
  const configuredEnv = serverConfig && typeof serverConfig.env === "object" ? serverConfig.env : {};
  const requiredNames = requiredEnvNamesForServer(serverConfig);
  const loaded = loadEnv(requiredNames, { env });
  const presence = describeSecretPresence(loaded);
  const childEnv = { ...env };
  const missing = [];
  const secretValues = [];

  for (const [targetName, rawValue] of Object.entries(configuredEnv || {})) {
    const ref = parseEnvRef(rawValue);
    if (ref) {
      const value = loaded.values[ref] || "";
      if (isSecretEnvKey(targetName) && !value) {
        missing.push(ref);
      } else if (value) {
        childEnv[targetName] = value;
        if (isSecretEnvKey(targetName)) secretValues.push(value);
      }
      continue;
    }
    if (typeof rawValue === "string") {
      childEnv[targetName] = rawValue;
    }
  }

  return { childEnv, missing: [...new Set(missing)].sort(), presence, secretValues };
}

function encodeMcpMessage(obj) {
  return `${JSON.stringify(obj)}\n`;
}

export function parseMcpFrames(bufferText) {
  const messages = [];
  let rest = String(bufferText || "");
  if (/content-length:/i.test(rest)) {
    while (true) {
      const headerEnd = rest.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;
      const header = rest.slice(0, headerEnd);
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        rest = rest.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const body = rest.slice(bodyStart, bodyStart + length);
      if (body.length < length) break;
      try {
        messages.push(JSON.parse(body));
      } catch {
        // Ignore malformed frames; the reachability result will explain timeout
        // or missing response rather than leaking raw output.
      }
      rest = rest.slice(bodyStart + length);
    }
    return messages;
  }

  for (const line of rest.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      messages.push(JSON.parse(trimmed));
    } catch {
      // Ignore partial or malformed lines; callers retry as more data arrives.
    }
  }
  return messages;
}

export function runMcpStdioProbe(serverConfig, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cwd = REPO_ROOT,
  env = process.env,
  spawnFn = spawn,
} = {}) {
  return new Promise((resolve) => {
    const command = serverConfig?.command;
    const args = Array.isArray(serverConfig?.args) ? serverConfig.args : [];
    if (!command || typeof command !== "string") {
      resolve({ ok: false, reason: "missing command" });
      return;
    }

    let stdout = "";
    let stderr = "";
    let child;
    let settled = false;
    let initialized = false;
    let listed = false;
    let sentToolsList = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.kill?.("SIGTERM"); } catch { /* ignore */ }
      resolve(result);
    };

    const sendToolsList = () => {
      if (sentToolsList) return;
      sentToolsList = true;
      child.stdin.write(encodeMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }));
      child.stdin.write(encodeMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    };

    const handleMessages = () => {
      const messages = parseMcpFrames(stdout);
      initialized = initialized || messages.some((m) => m?.id === 1 && m?.result?.serverInfo);
      if (initialized) sendToolsList();
      listed = listed || messages.some((m) => m?.id === 2 && Array.isArray(m?.result?.tools));
      if (initialized && listed) {
        const listResponse = messages.find((m) => m?.id === 2 && Array.isArray(m?.result?.tools));
        finish({ ok: true, reason: "initialize and tools/list succeeded", toolCount: listResponse.result.tools.length });
      }
    };

    let timer = null;
    try {
      child = spawnFn(command, args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      resolve({ ok: false, reason: `spawn failed: ${safeReason(err)}` });
      return;
    }

    timer = setTimeout(() => {
      finish({ ok: false, reason: "timed out waiting for MCP response" });
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
      handleMessages();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      finish({ ok: false, reason: `process error: ${safeReason(err)}` });
    });
    child.on("close", (code) => {
      if (settled) return;
      const tail = safeReason(stderr).replace(/\s+/g, " ").trim().slice(0, 1000);
      finish({ ok: false, reason: `process exited ${code}${tail ? `: ${tail}` : ""}` });
    });

    child.stdin.write(encodeMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "aidit-os-mcp-probe", version: "1.0.0" },
      },
    }));
  });
}

export async function probeServer(name, serverConfig, {
  env = process.env,
  loadEnv = loadLocalEnv,
  transport = runMcpStdioProbe,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const result = {
    name,
    registered: true,
    configured: false,
    reachable: null,
    reason: "",
    secretPresence: {},
    toolCount: null,
  };

  if (!serverConfig || typeof serverConfig !== "object") {
    result.reason = "server entry is not an object";
    return result;
  }
  if (!serverConfig.command || typeof serverConfig.command !== "string") {
    result.reason = "server command missing";
    return result;
  }

  const resolved = resolveServerEnv(serverConfig, { env, loadEnv });
  result.secretPresence = resolved.presence;
  if (resolved.missing.length > 0) {
    result.reason = `missing required env: ${resolved.missing.join(", ")}`;
    return result;
  }

  result.configured = true;
  const live = await transport(serverConfig, { env: resolved.childEnv, timeoutMs });
  result.reachable = Boolean(live && live.ok);
  result.reason = redactKnownSecrets(live?.reason || (result.reachable ? "reachable" : "unreachable"), resolved.secretValues);
  result.toolCount = Number.isFinite(live?.toolCount) ? live.toolCount : null;
  return result;
}

export async function probeMcpConfig({
  file = DEFAULT_MCP_CONFIG_FILE,
  readFile = fs.readFile,
  env = process.env,
  loadEnv = loadLocalEnv,
  transport = runMcpStdioProbe,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const read = await readMcpConfig({ file, readFile });
  if (!read.ok) {
    return { ok: false, reason: read.reason, servers: [] };
  }

  const servers = [];
  for (const entry of read.servers) {
    servers.push(await probeServer(entry.name, entry.config, { env, loadEnv, transport, timeoutMs }));
  }
  return { ok: true, reason: null, servers };
}

function yn(value) {
  if (value === null || value === undefined) return "not checked";
  return value ? "yes" : "no";
}

export function formatProbeReport(report) {
  const lines = ["MCP probe"];
  if (!report?.ok) {
    lines.push(`config: not readable (${report?.reason || "unknown reason"})`);
    return lines.join("\n");
  }
  if (!Array.isArray(report.servers) || report.servers.length === 0) {
    lines.push("config: readable, 0 server(s) registered");
    return lines.join("\n");
  }
  lines.push(`config: readable, ${report.servers.length} server(s) registered`);
  for (const server of report.servers) {
    lines.push(`server: ${server.name}`);
    lines.push(`  registered: ${yn(server.registered)}`);
    lines.push(`  configured: ${yn(server.configured)}`);
    lines.push(`  reachable: ${yn(server.reachable)}`);
    if (server.toolCount !== null) lines.push(`  tools: ${server.toolCount}`);
    if (server.reason) lines.push(`  reason: ${server.reason}`);
    const secretNames = Object.keys(server.secretPresence || {}).sort();
    for (const secretName of secretNames) {
      const presence = server.secretPresence[secretName];
      lines.push(`  secret ${secretName}: ${presence.present ? `present (length ${presence.length})` : "missing"}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  try {
    const report = await probeMcpConfig();
    console.log(formatProbeReport(report));
    process.exit(0);
  } catch {
    console.error("MCP probe could not run: internal error (no secret disclosed)");
    process.exit(1);
  }
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isEntry) {
  main();
}
