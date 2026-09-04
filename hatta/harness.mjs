import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// SECURITY SANDBOX BOUNDARY. Every file operation this harness performs is
// checked against WORKSPACE_ROOT, so a wrong value does not merely mislocate
// files — it makes the harness refuse every operation, which is exactly what
// happened when the checkout moved to a machine where the old hardcoded
// "D:\AI\Active FounderOS-Aidit" did not exist.
//
// Derived from this module's own location rather than process.cwd(): the
// harness stays scoped when invoked from a different directory (the property
// the old absolute path was bought for) WITHOUT being tied to one machine.
// harness.mjs lives in <repo>/hatta/, so the repository root is one level up.
const __harnessDir = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__harnessDir, "..");
const DEFAULT_ENDPOINT = "http://localhost:11434/api/chat";
const ENDPOINT_CONFIG = resolveEndpoint(process.env.OLLAMA_HOST);
const ENDPOINT = ENDPOINT_CONFIG.endpoint;
const MODEL = process.env.OLLAMA_MODEL_HATTA || "glm-5.3:cloud";
const MAX_ITERATIONS = Number.parseInt(process.env.HATTA_MAX_ITER || "40", 10);
const STDIO_LIMIT = 4000;
const SUMMARY_LIMIT = 700;
const READ_FILE_CONTENT_ELIDED_NOTE =
  "Content dropped from chat history after a newer read_file result. Call read_file again with this path to reload it.";
export const HARNESS_EVIDENCE_PATH = path.join(WORKSPACE_ROOT, "hatta", ".harness-evidence.json");
let currentEvidence = null;

const PROTECTED_SECRET_BASENAMES = new Set([
  ".env",
  "env.local..txt",
]);
const PROTECTED_SECRET_EXTENSIONS = new Set([".key", ".pem", ".p12", ".pfx"]);
const PACKAGE_MUTATION_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "bun.lock",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
]);
const SAFE_NODE_PREFIXES = ["ops-watcher/", "hatta/", "skills/"];
const SAFE_BUN_PREFIXES = ["ops-watcher/", "hatta/", "skills/"];
const RG_DENIED_FLAGS = new Set([
  "--pre",
  "--pre-glob",
  "--no-ignore",
  "--no-ignore-dot",
  "--no-ignore-exclude",
  "--no-ignore-files",
  "--unrestricted",
  "--hidden",
  "--follow",
  "-u",
  "-uu",
  "-uuu",
]);
const RG_FORCED_ARGS = [
  "--no-config",
  "--glob", "!*.key",
  "--glob", "!*.pem",
  "--glob", "!*.p12",
  "--glob", "!*.pfx",
  "--glob", "!env.local..txt",
  "--glob", "!**/.env",
  "--glob", "!**/.env.*",
];

// The prompt must name the SAME root the sandbox actually enforces. It used to
// name a hardcoded "D:\AI\Active FounderOS-Aidit" while WORKSPACE_ROOT is
// derived, so on any machine where those differ the model was told its boundary
// was somewhere the enforcement code disagreed with — it would build paths under
// the path it had been told about and have every one of them refused, with no
// message explaining why. Interpolating WORKSPACE_ROOT makes the two the same
// fact by construction.
const SYSTEM_PROMPT =
  `You are Hatta, a workspace-scoped technical executor for the Aidit OS project. Your write/read/list access is restricted to ${WORKSPACE_ROOT} and its subfolders only. You cannot access any other directory. Use the available tools to accomplish the task. Be concise.`;

function resolveEndpoint(rawHost) {
  const raw = rawHost || DEFAULT_ENDPOINT;
  try {
    const url = new URL(raw);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    if (url.protocol !== "http:" || !localHosts.has(url.hostname)) {
      return {
        endpoint: raw,
        error: `Refused non-local Ollama endpoint: ${raw}`,
      };
    }
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/api/chat";
    } else if (!url.pathname.endsWith("/api/chat")) {
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/chat`;
    }
    return { endpoint: url.toString(), error: null };
  } catch (error) {
    return { endpoint: raw, error: `Invalid Ollama endpoint: ${error.message}` };
  }
}

const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file inside the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          offset: { type: "integer", description: "0-based line index to start reading from. Defaults to 0; negative values are clamped to 0." },
          limit: { type: "integer", description: "Number of lines to return. Defaults to the end of the file; out-of-range values are clamped." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a UTF-8 text file inside the workspace, creating parent directories first.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          content: { type: "string", description: "File content to write." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Edit an existing UTF-8 text file inside the workspace by replacing one exact, unique text match. Prefer edit_file over write_file for any change to an existing file, because write_file must restate the entire file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          search: { type: "string", description: "Exact text to find." },
          replace: { type: "string", description: "Text to substitute." },
        },
        required: ["path", "search", "replace"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List a directory inside the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative directory path.", "default": "." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run an allowlisted command in the workspace without a shell.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "One of: git, node, npm, bun, rg, dir, type, echo." },
          args: { type: "array", items: { type: "string" }, description: "Command arguments." },
        },
        required: ["command", "args"],
      },
    },
  },
];

function truncate(value, limit = STDIO_LIMIT) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}... [truncated]` : text;
}

function makeEvidence(startedAt) {
  return {
    ok: false,
    iterations: 0,
    model: MODEL,
    endpoint: ENDPOINT,
    toolCalls: [],
    filesWritten: [],
    finalMessage: null,
    error: null,
    timedOut: false,
    startedAt,
    finishedAt: null,
  };
}

export async function persistHarnessEvidence(evidence, io = fs) {
  try {
    await io.mkdir(path.dirname(HARNESS_EVIDENCE_PATH), { recursive: true });
    await io.writeFile(HARNESS_EVIDENCE_PATH, JSON.stringify(evidence), "utf8");
  } catch {
    // Best-effort harness bookkeeping; never fail the model run over evidence persistence.
  }
  return evidence;
}

async function persistRunEvidence(evidence, persist) {
  try {
    await persist(evidence);
  } catch {
    // Keep persistence failures out of the returned evidence and normal run flow.
  }
  return evidence;
}

export function handleTerminationSignal(signal, {
  writeLine = (line) => process.stdout.write(`${line}\n`),
  exit = (code) => process.exit(code),
  now = () => new Date().toISOString(),
} = {}) {
  const timestamp = now();
  const evidence = currentEvidence || makeEvidence(timestamp);
  evidence.terminatedBy = signal;
  evidence.finishedAt = timestamp;
  currentEvidence = evidence;
  writeLine(JSON.stringify(evidence));
  exit(1);
}

// Exported (Phase 7 security audit) as pure, side-effect-free functions so the
// tool-execution guard can be unit-tested directly without a live model dispatch.
// Adding `export` here is purely additive: it changes nothing about CLI behavior.
function normalizeForCompare(p) {
  const resolved = path.resolve(String(p));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sameOrInside(parent, child) {
  const p = normalizeForCompare(parent);
  const c = normalizeForCompare(child);
  return c === p || c.startsWith(p + path.sep);
}

function realpathSafe(p) {
  try {
    return realpathSync.native ? realpathSync.native(p) : realpathSync(p);
  } catch {
    return null;
  }
}

function nearestExistingAncestor(resolvedPath) {
  let current = existsSync(resolvedPath) ? resolvedPath : path.dirname(resolvedPath);
  while (!existsSync(current)) {
    const next = path.dirname(current);
    if (next === current) return null;
    current = next;
  }
  return current;
}

// Exported as a pure guard for tests. This is now both lexical and realpath-
// checked: an in-workspace junction/symlink whose real target escapes the root
// is refused before read/write/command execution can touch it. For paths that
// do not exist yet, the nearest existing ancestor is realpath-checked, which
// covers writes through a linked parent directory.
export function resolveWorkspacePath(requested = ".") {
  const root = path.resolve(WORKSPACE_ROOT);
  const rootReal = realpathSafe(root) || root;
  const requestedText = String(requested == null || requested === "" ? "." : requested);
  const resolved = path.resolve(root, requestedText);

  if (!sameOrInside(root, resolved)) {
    return {
      ok: false,
      requested: requestedText,
      root,
      resolved,
      error: `Refused path outside workspace: ${requestedText}`,
    };
  }

  const ancestor = nearestExistingAncestor(resolved);
  if (!ancestor) {
    return { ok: false, requested: requestedText, root, resolved, error: `Refused path with no existing ancestor: ${requestedText}` };
  }
  const ancestorReal = realpathSafe(ancestor);
  if (!ancestorReal) {
    return { ok: false, requested: requestedText, root, resolved, error: `Refused unreadable path ancestor: ${requestedText}` };
  }
  const realResolved = path.resolve(ancestorReal, path.relative(ancestor, resolved));
  if (!sameOrInside(rootReal, realResolved)) {
    return {
      ok: false,
      requested: requestedText,
      root,
      resolved,
      realResolved,
      error: `Refused realpath escape outside workspace: ${requestedText}`,
    };
  }

  return { ok: true, requested: requestedText, root, rootReal, resolved, realResolved };
}

function relativeToWorkspace(resolvedPath) {
  const rel = path.relative(WORKSPACE_ROOT, resolvedPath);
  return rel || ".";
}

function normalizedRelativePath(resolvedPath) {
  return relativeToWorkspace(resolvedPath).replace(/\\/g, "/");
}

function isSecretLikeRelativePath(rel) {
  const base = path.basename(rel).toLowerCase();
  if (PROTECTED_SECRET_BASENAMES.has(base)) return true;
  if (base.startsWith(".env.")) return true;
  if (PROTECTED_SECRET_EXTENSIONS.has(path.extname(base))) return true;
  return /(^|[._-])(token|secret|credential|password|apikey|api-key)([._-]|$)/i.test(base);
}

export function protectedWorkspacePathReason(requested, { write = false } = {}) {
  const resolved = requested && typeof requested === "object" && requested.ok ? requested : resolveWorkspacePath(requested);
  if (!resolved.ok) return resolved.error;
  const rel = normalizedRelativePath(resolved.resolved);
  const parts = rel.split("/").map((p) => p.toLowerCase()).filter(Boolean);
  if (parts.includes(".git")) return "Refused Git metadata path (.git is executable repository control state).";
  if (isSecretLikeRelativePath(rel)) return "Refused credential/secret-like path.";
  if (write && PACKAGE_MUTATION_BASENAMES.has(path.basename(rel).toLowerCase())) {
    return "Refused package-manager control file write from HATTA harness.";
  }
  return null;
}

function lineSegments(content) {
  const segments = content.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) || [];
  if (segments.at(-1) === "") segments.pop();
  return segments;
}

function clampedInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function sliceContentByLines(content, args = {}) {
  const lines = lineSegments(content);
  const totalLines = lines.length;
  const requestedOffset = Math.max(0, clampedInteger(args?.offset, 0));
  const start = Math.min(requestedOffset, totalLines);
  const hasLimit = args && Object.hasOwn(args, "limit") && args.limit !== undefined && args.limit !== null;
  const requestedLimit = hasLimit
    ? Math.max(0, clampedInteger(args.limit, 0))
    : totalLines - start;
  const end = Math.min(totalLines, start + requestedLimit);

  return {
    content: lines.slice(start, end).join(""),
    totalLines,
    range: {
      offset: start,
      limit: end - start,
    },
    hasMoreBefore: start > 0,
    hasMoreAfter: end < totalLines,
  };
}

async function readFileTool(args) {
  const resolved = resolveWorkspacePath(args?.path);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const protectedReason = protectedWorkspacePathReason(resolved);
  if (protectedReason) return { ok: false, error: protectedReason };

  try {
    const content = await fs.readFile(resolved.resolved, "utf8");
    const slice = sliceContentByLines(content, args);
    return {
      ok: true,
      path: relativeToWorkspace(resolved.resolved),
      bytes: Buffer.byteLength(content, "utf8"),
      content: slice.content,
      totalLines: slice.totalLines,
      range: slice.range,
      hasMoreBefore: slice.hasMoreBefore,
      hasMoreAfter: slice.hasMoreAfter,
    };
  } catch (error) {
    return { ok: false, error: `read_file failed: ${error.message}` };
  }
}

async function writeFileTool(args, evidence) {
  const resolved = resolveWorkspacePath(args?.path);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const protectedReason = protectedWorkspacePathReason(resolved, { write: true });
  if (protectedReason) return { ok: false, error: protectedReason };

  try {
    const content = String(args?.content ?? "");
    await fs.mkdir(path.dirname(resolved.resolved), { recursive: true });
    await fs.writeFile(resolved.resolved, content, "utf8");
    const rel = relativeToWorkspace(resolved.resolved);
    evidence.filesWritten.push(rel);
    return { ok: true, path: rel, bytes: Buffer.byteLength(content, "utf8") };
  } catch (error) {
    return { ok: false, error: `write_file failed: ${error.message}` };
  }
}

export async function editFileTool(args, evidence) {
  const resolved = resolveWorkspacePath(args?.path);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const protectedReason = protectedWorkspacePathReason(resolved, { write: true });
  if (protectedReason) return { ok: false, error: protectedReason };

  const search = String(args?.search ?? "");
  if (search === "") return { ok: false, error: "edit_file: search text must not be empty" };

  try {
    const content = await fs.readFile(resolved.resolved, "utf8");
    const occurrences = content.split(search).length - 1;
    if (occurrences === 0) return { ok: false, error: "edit_file: search text not found" };
    if (occurrences > 1) return { ok: false, error: `edit_file: search text is not unique (${occurrences} occurrences)` };

    const updated = content.replace(search, String(args?.replace ?? ""));
    await fs.writeFile(resolved.resolved, updated, "utf8");
    const rel = relativeToWorkspace(resolved.resolved);
    evidence.filesWritten.push(rel);
    return { ok: true, path: rel, bytes: Buffer.byteLength(updated, "utf8"), replaced: 1 };
  } catch (error) {
    return { ok: false, error: `edit_file failed: ${error.message}` };
  }
}

async function listDirectoryTool(args) {
  const resolved = resolveWorkspacePath(args?.path || ".");
  if (!resolved.ok) return { ok: false, error: resolved.error };

  try {
    const entries = await fs.readdir(resolved.resolved, { withFileTypes: true });
    return {
      ok: true,
      path: relativeToWorkspace(resolved.resolved),
      entries: entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      })),
    };
  } catch (error) {
    return { ok: false, error: `list_directory failed: ${error.message}` };
  }
}

export function hasForbiddenGitArgs(args) {
  return validateGitCommand((args || []).map(String)).ok === false;
}

// Legacy export kept for older tests/reports. Command safety is now enforced by
// structured per-command policy below, not by substring blocking.
export function argContainsDeniedText(arg) {
  const text = String(arg || "").toLowerCase();
  return /(^|\s)(rm|del)(\s|$)/.test(text) || /remove-item|format|shutdown/.test(text);
}

export function argLooksLikePath(arg) {
  const text = String(arg);
  return (
    text === "." ||
    text === ".." ||
    text.startsWith("..") ||
    /^[a-zA-Z]:/.test(text) ||
    path.isAbsolute(text) ||
    text.includes("\\") ||
    text.includes("/")
  );
}

export function hasInlineEvalFlag(args) {
  return args.some((a) => {
    const s = String(a);
    return (
      s === "-e" || s === "--eval" || s.startsWith("--eval=") ||
      s === "-p" || s === "--print" || s.startsWith("--print=") ||
      s === "--import" || s.startsWith("--import=") ||
      s === "--require" || s.startsWith("--require=") || s === "-r" ||
      s === "--loader" || s.startsWith("--loader=") ||
      s === "--experimental-loader" || s.startsWith("--experimental-loader=") ||
      s === "--preload" || s.startsWith("--preload=")
    );
  });
}

function reject(message) {
  return { ok: false, error: message };
}

function okPolicy(extra = {}) {
  return { ok: true, ...extra };
}

function validateArgArray(args) {
  if (!Array.isArray(args)) return reject("Command args must be an array.");
  if (args.length > 80) return reject("Refused excessive argument count.");
  for (const arg of args) {
    if (String(arg).includes("\0")) return reject("Refused NUL byte in argument.");
  }
  return okPolicy();
}

function validateWorkspacePathForCommand(arg, { allowSecret = false } = {}) {
  const resolved = resolveWorkspacePath(arg);
  if (!resolved.ok) return reject(resolved.error);
  if (!allowSecret) {
    const protectedReason = protectedWorkspacePathReason(resolved);
    if (protectedReason) return reject(protectedReason);
  }
  return okPolicy({ resolved });
}

function validatePathLikeArgs(args) {
  for (const arg of args) {
    if (!argLooksLikePath(arg)) continue;
    const v = validateWorkspacePathForCommand(arg);
    if (!v.ok) return v;
  }
  return okPolicy();
}

function relHasAllowedPrefix(rel, prefixes) {
  const normalized = rel.replace(/\\/g, "/");
  return prefixes.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}

function validateScriptPath(script, prefixes) {
  if (!script || String(script).startsWith("-")) return reject("Expected an explicit workspace script path.");
  const v = validateWorkspacePathForCommand(script);
  if (!v.ok) return v;
  const rel = normalizedRelativePath(v.resolved.resolved);
  if (!/\.(mjs|cjs|js)$/i.test(rel)) return reject(`Refused non-JS script path: ${script}`);
  if (!relHasAllowedPrefix(rel, prefixes)) return reject(`Refused script outside approved harness script roots: ${script}`);
  return okPolicy({ rel });
}

function validateGitCommand(args) {
  if (args.length === 0) return reject("git requires an allowed read-only subcommand.");
  if (args.some((a) => /^-c($|=)/i.test(a) || a === "--config-env" || a.startsWith("--config-env=") || a === "-C" || a.startsWith("--git-dir") || a.startsWith("--work-tree") || a === "--exec-path" || a.startsWith("--exec-path="))) {
    return reject("Refused git global/config/worktree override flag.");
  }

  let idx = 0;
  if (args[idx] === "--no-pager") idx += 1;
  const subcmd = args[idx];
  if (!subcmd || subcmd.startsWith("-")) return reject("git subcommand must be explicit and read-only.");
  const rest = args.slice(idx + 1);
  const allowed = new Set(["status", "diff", "log", "show", "rev-parse", "branch", "ls-files"]);
  if (!allowed.has(subcmd)) return reject(`Refused git subcommand: ${subcmd}`);
  if (rest.some((a) => a === "--global" || a === "--system" || a === "--local" || a === "--worktree" || a === "--force" || a === "-f" || a === "--ext-diff" || a === "--textconv")) {
    return reject("Refused unsafe git option for read-only harness policy.");
  }

  if (subcmd === "status") {
    const okFlags = new Set(["--short", "-s", "--branch", "-b", "-sb", "--porcelain", "--porcelain=v1", "--porcelain=v2", "--untracked-files=no", "--untracked-files=normal", "--untracked-files=all", "-uno", "--ignored=no", "--"]);
    for (const a of rest) if (a.startsWith("-") && !okFlags.has(a)) return reject(`Refused git status option: ${a}`);
  } else if (subcmd === "branch") {
    const okFlags = new Set(["--show-current", "--list", "-a", "-r", "-vv", "--no-color"]);
    for (const a of rest) if (!okFlags.has(a)) return reject(`Refused git branch argument: ${a}`);
  } else if (subcmd === "rev-parse") {
    const okArgs = new Set(["--show-toplevel", "--show-prefix", "--is-inside-work-tree", "--abbrev-ref", "--git-dir", "HEAD", "--"]);
    for (const a of rest) if (a.startsWith("-") && !okArgs.has(a)) return reject(`Refused git rev-parse option: ${a}`);
  } else if (subcmd === "ls-files") {
    const okFlags = new Set(["--", "--stage", "-s", "--others", "--modified", "--deleted", "--cached", "--exclude-standard", "--error-unmatch"]);
    for (const a of rest) if (a.startsWith("-") && !okFlags.has(a)) return reject(`Refused git ls-files option: ${a}`);
  } else {
    const denied = rest.find((a) => a === "--output" || a.startsWith("--output=") || a === "--exec" || a.startsWith("--exec=") || a === "--upload-pack" || a.startsWith("--upload-pack="));
    if (denied) return reject(`Refused git ${subcmd} option: ${denied}`);
  }

  return validatePathLikeArgs(rest);
}

function validateNodeCommand(args) {
  if (hasInlineEvalFlag(args)) return reject("Refused Node inline/import/require/loader execution flag.");
  if (args[0] === "--version" || args[0] === "-v") return args.length === 1 ? okPolicy() : reject("node --version accepts no extra args.");
  if (args[0] === "--test") {
    for (const a of args.slice(1)) {
      if (a.startsWith("-")) return reject(`Refused node --test option: ${a}`);
      const v = validateScriptPath(a, SAFE_NODE_PREFIXES);
      if (!v.ok) return v;
    }
    return okPolicy();
  }
  const script = validateScriptPath(args[0], SAFE_NODE_PREFIXES);
  if (!script.ok) return script;
  return validatePathLikeArgs(args.slice(1));
}

function validateNpmCommand(args) {
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) return okPolicy();
  if (args[0] === "test" && args.length === 1) return okPolicy();
  if (args[0] === "run" && ["test", "lint", "check"].includes(args[1]) && args.length === 2) return okPolicy();
  return reject("Refused npm operation outside test/lint/check policy.");
}

function validateBunCommand(args) {
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) return okPolicy();
  const subcmd = args[0];
  if (["x", "exec", "create", "add", "install", "update", "upgrade", "pm", "link"].includes(subcmd)) {
    return reject(`Refused bun package/network execution subcommand: ${subcmd}`);
  }
  if (hasInlineEvalFlag(args)) return reject("Refused Bun inline/preload execution flag.");
  if (subcmd !== "test") return reject(`Refused bun subcommand: ${subcmd || "(none)"}`);
  for (const a of args.slice(1)) {
    if (a.startsWith("-")) return reject(`Refused bun test option: ${a}`);
    const v = validateScriptPath(a, SAFE_BUN_PREFIXES);
    if (!v.ok) return v;
  }
  return okPolicy();
}

function rgFlagName(arg) {
  if (!arg.startsWith("-")) return null;
  return arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
}

function validateRgCommand(args) {
  let positionalSeen = 0;
  let stopOptions = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!stopOptions && arg === "--") { stopOptions = true; continue; }
    if (!stopOptions && arg.startsWith("-")) {
      const flag = rgFlagName(arg);
      if (RG_DENIED_FLAGS.has(flag)) return reject(`Refused rg escape/secret-bypass flag: ${arg}`);
      if (flag === "--pre" || flag === "--pre-glob") return reject(`Refused rg preprocessor flag: ${arg}`);
      if (["-g", "--glob", "-t", "--type", "-T", "--type-not", "-e", "--regexp", "-A", "-B", "-C", "-m", "--max-count"].includes(flag) && !arg.includes("=")) i += 1;
      continue;
    }
    positionalSeen += 1;
    if (positionalSeen >= 2 || argLooksLikePath(arg)) {
      const v = validateWorkspacePathForCommand(arg);
      if (!v.ok) return v;
    }
  }
  return okPolicy();
}

function validateSimpleFileCommand(command, args) {
  if (command === "echo") return okPolicy();
  if (command === "dir") {
    if (args.length > 1) return reject("dir accepts at most one workspace path.");
    return args.length ? validateWorkspacePathForCommand(args[0]) : okPolicy();
  }
  if (command === "type") {
    if (args.length !== 1) return reject("type requires exactly one workspace file path.");
    return validateWorkspacePathForCommand(args[0]);
  }
  return reject(`Unhandled command: ${command}`);
}

export function validateCommand(command, args) {
  const normalizedCommand = String(command || "").trim();
  const commandArgs = Array.isArray(args) ? args.map(String) : args;
  const basic = validateArgArray(commandArgs);
  if (!basic.ok) return basic;

  const policies = {
    git: validateGitCommand,
    node: validateNodeCommand,
    npm: validateNpmCommand,
    bun: validateBunCommand,
    rg: validateRgCommand,
    dir: (a) => validateSimpleFileCommand("dir", a),
    type: (a) => validateSimpleFileCommand("type", a),
    echo: (a) => validateSimpleFileCommand("echo", a),
  };
  const policy = policies[normalizedCommand];
  if (!policy) return reject(`Refused command outside allowlist: ${normalizedCommand}`);
  return policy(commandArgs);
}

function makeSafeExecEnv(command) {
  const env = { ...process.env };
  for (const key of [
    "NODE_OPTIONS",
    "BUN_OPTIONS",
    "RIPGREP_CONFIG_PATH",
    "GIT_EXTERNAL_DIFF",
    "GIT_ASKPASS",
    "SSH_ASKPASS",
    "GCM_INTERACTIVE",
    "npm_config_script_shell",
  ]) delete env[key];
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = path.join(WORKSPACE_ROOT, "hatta", ".harness-empty-gitconfig");
  env.GIT_PAGER = "cat";
  env.PAGER = "cat";
  env.HUSKY = "0";
  if (command === "npm") env.npm_config_ignore_scripts = "true";
  return env;
}

function buildExecPlan(command, args) {
  if (command === "git") {
    const subcmd = args[0] === "--no-pager" ? args[1] : args[0];
    const rest = args[0] === "--no-pager" ? args.slice(2) : args.slice(1);
    const forced = ["--no-pager", subcmd];
    if (["diff", "log", "show"].includes(subcmd)) forced.push("--no-ext-diff", "--no-textconv");
    return { command, args: [...forced, ...rest], env: makeSafeExecEnv(command) };
  }
  if (command === "rg") return { command, args: [...RG_FORCED_ARGS, ...args], env: makeSafeExecEnv(command) };
  return { command, args, env: makeSafeExecEnv(command) };
}
async function runCommandTool(args) {
  const command = String(args?.command ?? "");
  const commandArgs = Array.isArray(args?.args) ? args.args.map(String) : [];
  const validation = validateCommand(command, commandArgs);
  if (!validation.ok) return { ok: false, error: validation.error };

  if (command === "echo") {
    return { ok: true, stdout: `${commandArgs.join(" ")}\n`, stderr: "" };
  }

  if (command === "dir") {
    const listResult = await listDirectoryTool({ path: commandArgs[0] || "." });
    if (!listResult.ok) return listResult;
    return {
      ok: true,
      stdout: listResult.entries.map((entry) => `${entry.type}\t${entry.name}`).join("\n"),
      stderr: "",
    };
  }

  if (command === "type") {
    const readResult = await readFileTool({ path: commandArgs[0] });
    if (!readResult.ok) return readResult;
    return { ok: true, stdout: readResult.content, stderr: "" };
  }

  try {
    const execPlan = buildExecPlan(command, commandArgs);
    const result = await execFileAsync(execPlan.command, execPlan.args, {
      cwd: WORKSPACE_ROOT,
      timeout: 30_000,
      windowsHide: true,
      shell: false,
      env: execPlan.env,
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
    };
  } catch (error) {
    return {
      ok: false,
      error: `run_command failed: ${error.message}`,
      stdout: truncate(error.stdout),
      stderr: truncate(error.stderr),
    };
  }
}

function parseToolArguments(rawArgs) {
  if (rawArgs && typeof rawArgs === "object") return rawArgs;
  if (typeof rawArgs !== "string" || rawArgs.trim() === "") return {};
  try {
    return JSON.parse(rawArgs);
  } catch {
    return {};
  }
}

function summarizeArgs(name, args) {
  if (name === "write_file") {
    return truncate(
      JSON.stringify({ path: args?.path, contentLength: String(args?.content ?? "").length }),
      SUMMARY_LIMIT,
    );
  }
  if (name === "edit_file") {
    return truncate(
      JSON.stringify({
        path: args?.path,
        searchLength: String(args?.search ?? "").length,
        replaceLength: String(args?.replace ?? "").length,
      }),
      SUMMARY_LIMIT,
    );
  }
  return truncate(JSON.stringify(args ?? {}), SUMMARY_LIMIT);
}

function summarizeResult(result) {
  if (!result?.ok) return truncate(result?.error || JSON.stringify(result), SUMMARY_LIMIT);
  if (typeof result.stdout === "string" || typeof result.stderr === "string") {
    return truncate(
      JSON.stringify({ stdout: truncate(result.stdout, 300), stderr: truncate(result.stderr, 300) }),
      SUMMARY_LIMIT,
    );
  }
  if (typeof result.content === "string") {
    return truncate(JSON.stringify({ path: result.path, contentLength: result.content.length }), SUMMARY_LIMIT);
  }
  return truncate(JSON.stringify(result), SUMMARY_LIMIT);
}

function parseMessageResult(content) {
  if (typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function makeElidedReadFileResult(result) {
  return {
    ok: true,
    path: result.path,
    bytes: Number.isFinite(result.bytes)
      ? result.bytes
      : Buffer.byteLength(result.content, "utf8"),
    content_elided: true,
    note: READ_FILE_CONTENT_ELIDED_NOTE,
  };
}

function elideSupersededReadFileResults(messages) {
  const readResults = [];
  let latestContentIndex = -1;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "tool" || message.name !== "read_file") continue;

    const result = parseMessageResult(message.content);
    if (!result || result.ok !== true || typeof result.content !== "string") continue;

    readResults.push({ index, message, result });
    latestContentIndex = index;
  }

  if (latestContentIndex < 0) return;

  for (const { index, message, result } of readResults) {
    if (index === latestContentIndex) continue;
    message.content = JSON.stringify(makeElidedReadFileResult(result));
  }
}

function appendToolResultMessage(messages, name, result) {
  messages.push({
    role: "tool",
    name,
    content: JSON.stringify(result),
  });
  elideSupersededReadFileResults(messages);
}

export class OllamaChatTimeoutError extends Error {
  constructor(requestTimeoutMs) {
    super(`Ollama chat timed out after ${requestTimeoutMs}ms`);
    this.name = "OllamaChatTimeoutError";
    this.requestTimeoutMs = requestTimeoutMs;
  }
}

async function executeToolCall(toolCall, evidence) {
  const name = toolCall?.function?.name || toolCall?.name;
  const args = parseToolArguments(toolCall?.function?.arguments ?? toolCall?.arguments);
  let result;

  if (name === "read_file") result = await readFileTool(args);
  else if (name === "write_file") result = await writeFileTool(args, evidence);
  else if (name === "edit_file") result = await editFileTool(args, evidence);
  else if (name === "list_directory") result = await listDirectoryTool(args);
  else if (name === "run_command") result = await runCommandTool(args);
  else result = { ok: false, error: `Unknown tool: ${name}` };

  evidence.toolCalls.push({
    name,
    ok: Boolean(result.ok),
    argsSummary: summarizeArgs(name, args),
    resultSummary: summarizeResult(result),
  });

  return { name, result };
}

export async function postChat(messages) {
  if (ENDPOINT_CONFIG.error) throw new Error(ENDPOINT_CONFIG.error);

  const requestTimeoutMs = Number.parseInt(process.env.HATTA_REQUEST_TIMEOUT_MS || "120000", 10);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        system: SYSTEM_PROMPT,
        messages,
        tools,
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Ollama chat failed: HTTP ${response.status} ${truncate(body, 500)}`);
    }

    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new OllamaChatTimeoutError(requestTimeoutMs);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runTask(prompt, {
  chat = postChat,
  persist = persistHarnessEvidence,
  now = () => new Date().toISOString(),
} = {}) {
  const startedAt = now();
  const evidence = makeEvidence(startedAt);
  currentEvidence = evidence;
  const messages = [{ role: "user", content: prompt }];

  try {
    for (let index = 0; index < MAX_ITERATIONS; index += 1) {
      evidence.iterations = index + 1;
      const response = await chat(messages);
      const assistantMessage = response?.message || { role: "assistant", content: "" };
      messages.push(assistantMessage);

      const toolCalls = assistantMessage.tool_calls || [];
      if (toolCalls.length === 0) {
        evidence.ok = true;
        evidence.finalMessage = assistantMessage.content || "";
        return evidence;
      }

      for (const toolCall of toolCalls) {
        const { name, result } = await executeToolCall(toolCall, evidence);
        appendToolResultMessage(messages, name, result);
      }
      await persistRunEvidence(evidence, persist);
    }

    evidence.error = `Reached MAX_ITERATIONS (${MAX_ITERATIONS}) before a final answer.`;
    return evidence;
  } catch (error) {
    if (error instanceof OllamaChatTimeoutError) evidence.timedOut = true;
    evidence.error = error?.message || String(error);
    return evidence;
  } finally {
    evidence.finishedAt = now();
    await persistRunEvidence(evidence, persist);
  }
}

function addSelftestCase(evidence, name, requested, expectedAllowed) {
  const result = resolveWorkspacePath(requested);
  const passed = result.ok === expectedAllowed;
  evidence.toolCalls.push({
    name,
    ok: passed,
    argsSummary: JSON.stringify({ path: requested, expectedAllowed }),
    resultSummary: passed
      ? `pass: ${result.ok ? "allowed" : "refused"}`
      : `fail: ${result.ok ? "allowed" : "refused"} ${requested}`,
  });
  return passed;
}

async function runSelftest() {
  const startedAt = new Date().toISOString();
  const evidence = makeEvidence(startedAt);
  evidence.model = "selftest";
  evidence.endpoint = "none";

  const outsideRoot = path.resolve(path.parse(WORKSPACE_ROOT).root, "outside-workspace-selftest");
  const results = [
    addSelftestCase(evidence, "selftest.path_escape", "../../Windows/System32", false),
    addSelftestCase(evidence, "selftest.path_escape", "C:\\Windows", false),
    addSelftestCase(evidence, "selftest.path_escape", outsideRoot, false),
    addSelftestCase(evidence, "selftest.path_escape", "hatta", true),
  ];

  evidence.iterations = results.length;
  evidence.ok = results.every(Boolean);
  evidence.finalMessage = evidence.ok ? "Selftest passed." : "Selftest failed.";
  evidence.error = evidence.ok ? null : "One or more selftest assertions failed.";
  evidence.finishedAt = new Date().toISOString();
  return evidence;
}

async function main() {
  const args = process.argv.slice(2);
  const isSelftest = args.length === 1 && args[0] === "--selftest";
  const prompt = args.join(" ").trim();
  const evidence = isSelftest ? await runSelftest() : prompt ? await runTask(prompt) : makeEvidence(new Date().toISOString());
  if (!isSelftest && !prompt) {
    evidence.error = 'Usage: node hatta/harness.mjs "<prompt>"';
    evidence.finishedAt = new Date().toISOString();
  }
  console.log(JSON.stringify(evidence));
  if (isSelftest && !evidence.ok) process.exitCode = 1;
  if (!isSelftest && !evidence.ok) process.exitCode = 1;
}

// Only run main() when this file is the entry point, so test modules can import
// the exported pure guard functions (resolveWorkspacePath / validateCommand /
// hasForbiddenGitArgs / argContainsDeniedText / argLooksLikePath /
// hasInlineEvalFlag / protectedWorkspacePathReason) without triggering a live Ollama dispatch. This mirrors
// the isEntry guard already used by ops-watcher/telegram-client.mjs and
// ops-watcher/watcher.mjs. CLI behavior
// (`node hatta/harness.mjs "<prompt>"` / `--selftest`) is unchanged.
const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) {
  process.once("SIGTERM", () => handleTerminationSignal("SIGTERM"));
  process.once("SIGINT", () => handleTerminationSignal("SIGINT"));
  main().catch((error) => {
    const evidence = makeEvidence(new Date().toISOString());
    currentEvidence = evidence;
    evidence.error = error.message;
    evidence.finishedAt = new Date().toISOString();
    console.log(JSON.stringify(evidence));
    process.exitCode = 1;
  });
}

