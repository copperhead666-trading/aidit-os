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
// Model tiers, named in one place so lanes cannot drift apart. Benchmark:
// heavy runs glm-5.2, code runs glm-5.1, light runs a flash model.
// OLLAMA_MODEL_HATTA overrides the code tier for comparison runs.
export const MODEL_TIERS = Object.freeze({
  code: "glm-5.1:cloud",        // HATTA's default: it edits code
  heavy: "glm-5.2:cloud",       // reserved; nothing routes here yet
  light: "glm-5.3-flash:cloud", // the flash lane
});

export function resolveModel(envOverride = process.env.OLLAMA_MODEL_HATTA) {
  return envOverride || MODEL_TIERS.code;
}

const MODEL = resolveModel();
const OUTER_RUN_BUDGET_MS = Number.parseInt(process.env.HATTA_OUTER_RUN_BUDGET_MS || "480000", 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.HATTA_REQUEST_TIMEOUT_MS || "120000", 10);
export const HARD_ITERATION_CEILING = 40;

// HATTA_MAX_ITER can only lower the ceiling, never raise it. Letting an explicit
// value win outright would let a fast-looping model spin forever. The clock is
// the physical bound; the override is a preference below the hard ceiling.
export function effectiveMaxIterations({
  hardCeiling = HARD_ITERATION_CEILING,
  override = process.env.HATTA_MAX_ITER,
} = {}) {
  const asked = Number.parseInt(override ?? "", 10);
  if (!Number.isFinite(asked) || asked < 1) return hardCeiling;
  return Math.min(asked, hardCeiling);
}

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

function timeMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

// The smallest reserve worth keeping: enough for one ordinary model call plus
// the evidence write that follows it. Below this the harness would start an
// iteration it has no realistic chance of finishing.
export const MIN_CLOCK_RESERVE_MS = 30 * 1000;

/**
 * How much of the budget to hold back for the last call.
 *
 * THE RESERVE USED TO BE THE WORST CASE, CHARGED EVERY TIME. It was the full
 * per-request timeout — 120 seconds — subtracted unconditionally, so a run with
 * an eight-minute budget could only work for six. Measured on 2026-09-06:
 * model calls took 13 to 33 seconds, never anything close to 120, and the run
 * that hit this bound stopped while reporting `remaining=83607ms` it refused to
 * spend. A quarter of paid budget was structurally unreachable.
 *
 * So the reserve now follows what calls in THIS run have actually cost: twice
 * the slowest one seen, floored at MIN_CLOCK_RESERVE_MS and still capped by the
 * per-request timeout, which remains the hard bound on any single call. With no
 * observation yet it stays at the cap — pessimism is correct only while there
 * is nothing to be pessimistic about.
 */
// The floor on a per-call bound. Below this there is no point starting a call
// at all, and a one-second timeout would report a healthy model as broken.
export const MIN_CALL_TIMEOUT_MS = 5 * 1000;

/**
 * The per-request timeout as it stands RIGHT NOW.
 *
 * Read live rather than from the module-load constant, because postChat always
 * read it live and something depends on that: HATTA_REQUEST_TIMEOUT_MS set
 * after import has to take effect. The harness-history suite sets it to 1ms
 * mid-run to prove an aborted fetch becomes a typed timeout carrying the right
 * number, and a module-load snapshot silently reports 120000 instead — the
 * check still passes on the important part and lies about the figure, which is
 * the kind of green test that hides a broken knob.
 */
export function currentRequestTimeoutMs() {
  const parsed = Number.parseInt(process.env.HATTA_REQUEST_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : REQUEST_TIMEOUT_MS;
}

/**
 * How long THIS call may take, given what is left of the run's budget.
 *
 * WHY THE RESERVE ALONE IS NOT ENOUGH. The clock reserve decides whether to
 * start another iteration; it cannot decide how long that iteration runs. With
 * a fixed worst-case reserve those were the same question — the reserve was the
 * per-request timeout, so a call that ran to its limit landed exactly on the
 * outer budget. An adaptive reserve breaks that identity: a call that suddenly
 * takes far longer than twice the slowest one seen could run past the outer
 * budget and be killed by the wrapper instead of stopping itself.
 *
 * So the call is bounded by what is actually left. The harness stays the thing
 * that ends the run, which is the difference between a stop it can report and a
 * kill it cannot — TerminateProcess is uncatchable on Windows, and a killed
 * harness leaves only whatever the last evidence write happened to contain.
 */
export function callTimeoutMs({
  elapsedMs = 0,
  outerRunBudgetMs = OUTER_RUN_BUDGET_MS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const remaining = outerRunBudgetMs - elapsedMs;
  if (!Number.isFinite(remaining)) return requestTimeoutMs;
  // The floor applies to the REMAINING budget, never to the requested timeout.
  // Clamping the other way round let a 5-second floor override an explicit
  // HATTA_REQUEST_TIMEOUT_MS of 1ms, so the knob stopped working while every
  // test that did not check the number kept passing.
  return Math.min(requestTimeoutMs, Math.max(MIN_CALL_TIMEOUT_MS, remaining));
}

export function clockReserveMs({
  observedCallMs,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const cap = Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? requestTimeoutMs : REQUEST_TIMEOUT_MS;
  const observed = Number(observedCallMs);
  if (!Number.isFinite(observed) || observed <= 0) return cap;
  return Math.min(cap, Math.max(MIN_CLOCK_RESERVE_MS, observed * 2));
}

function iterationStopReason(index, startedAtMs, nowMs, {
  maxIterations = effectiveMaxIterations(),
  outerRunBudgetMs = OUTER_RUN_BUDGET_MS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  observedCallMs = null,
} = {}) {
  if (index >= maxIterations) {
    return {
      bound: "ceiling",
      message: `Reached iteration ceiling (${maxIterations}; hard=${HARD_ITERATION_CEILING}; HATTA_MAX_ITER=${process.env.HATTA_MAX_ITER || "unset"}) before a final answer.`,
    };
  }

  // THE FLOOR IS ONE CALL, ALWAYS.
  //
  // A budget smaller than a single per-call timeout used to yield
  // max(1, floor(budget/perCall)) = 1 iteration. The clock-based bound made it
  // ZERO: the reserve alone exhausted the budget before the first call, so the
  // harness returned having done nothing at all and reported it as a budget
  // exhaustion. A run that never calls the model is not a short run, it is a
  // broken one, and it hides whatever it was asked to do.
  if (index === 0) return null;

  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const reserveMs = clockReserveMs({ observedCallMs, requestTimeoutMs });
  const runnableBudgetMs = Math.max(0, outerRunBudgetMs - reserveMs);
  if (elapsedMs >= runnableBudgetMs) {
    return {
      bound: "clock",
      message: `Reached clock budget before a final answer (elapsed=${elapsedMs}ms; outer=${outerRunBudgetMs}ms; reserve=${reserveMs}ms; slowestCall=${Number.isFinite(Number(observedCallMs)) && Number(observedCallMs) > 0 ? `${Math.round(Number(observedCallMs))}ms` : "unobserved"}; remaining=${Math.max(0, outerRunBudgetMs - elapsedMs)}ms).`,
    };
  }

  return null;
}

// `filePath` is injectable ONLY so tests stop writing the real evidence file.
// They did until 2026-09-06, and hatta-dispatch reads that same path to recover
// what a timed-out run managed to do. After any suite run the file held a
// fixture — one iteration, no tool calls, finalMessage "evidence complete",
// startedAt 2026-01-01 — and the next timeout would have reported that fixture
// as the run's own evidence. Production callers pass nothing and keep the real
// path; a test that needs a file gets its own.
export async function persistHarnessEvidence(evidence, io = fs, filePath = HARNESS_EVIDENCE_PATH) {
  try {
    await io.mkdir(path.dirname(filePath), { recursive: true });
    await io.writeFile(filePath, JSON.stringify(evidence), "utf8");
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
  if (path.extname(base) === ".md") return false;           // .md exempt from name-pattern heuristic
  return /(^|[._-])(tokens?|secrets?|credentials?|passwords?|apikeys?|api-keys?)([._-]|$)/i.test(base);
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

function normalizeLineEndings(content) {
  return String(content).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function countOccurrences(content, search) {
  return content.split(search).length - 1;
}

function detectOriginalLineEnding(content) {
  const crlf = content.match(/\r\n/g)?.length || 0;
  const lf = content.match(/(?<!\r)\n/g)?.length || 0;
  const cr = content.match(/\r(?!\n)/g)?.length || 0;
  const styles = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length;

  if (styles > 1) {
    return { ok: false, error: "edit_file: file has mixed line endings; refusing to guess original style" };
  }
  if (cr > 0) {
    return { ok: false, error: "edit_file: file has unsupported CR line endings; refusing to guess original style" };
  }
  return { ok: true, eol: crlf > 0 ? "\r\n" : "\n" };
}

function restoreOriginalLineEnding(content, eol) {
  return eol === "\n" ? content : content.replace(/\n/g, eol);
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
    const replace = String(args?.replace ?? "");
    const occurrences = countOccurrences(content, search);
    const normalizedContent = normalizeLineEndings(content);
    const normalizedSearch = normalizeLineEndings(search);
    const normalizedOccurrences = countOccurrences(normalizedContent, normalizedSearch);

    if (normalizedOccurrences === 0) {
      return { ok: false, error: "edit_file: search text not found after line-ending normalization" };
    }
    if (occurrences > 1) return { ok: false, error: `edit_file: search text is not unique (${occurrences} occurrences)` };
    if (normalizedOccurrences > 1) {
      return {
        ok: false,
        error: `edit_file: search text is not unique after line-ending normalization (${normalizedOccurrences} occurrences)`,
      };
    }

    const lineEnding = detectOriginalLineEnding(content);
    if (!lineEnding.ok) return { ok: false, error: lineEnding.error };

    const normalizedUpdated = normalizedContent.replace(normalizedSearch, normalizeLineEndings(replace));
    const updated = restoreOriginalLineEnding(normalizedUpdated, lineEnding.eol);
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

function makeSafeExecEnv(command, baseEnv = process.env) {
  const env = { ...baseEnv };
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
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/i.test(key)) delete env[key];
  }
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = path.join(WORKSPACE_ROOT, "hatta", ".harness-empty-gitconfig");
  if (command === "git") {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "safe.directory";
    env.GIT_CONFIG_VALUE_0 = WORKSPACE_ROOT;
  }
  env.GIT_PAGER = "cat";
  env.PAGER = "cat";
  env.HUSKY = "0";
  if (command === "npm") env.npm_config_ignore_scripts = "true";
  return env;
}

export function buildExecPlan(command, args, { env = process.env } = {}) {
  if (command === "git") {
    const subcmd = args[0] === "--no-pager" ? args[1] : args[0];
    const rest = args[0] === "--no-pager" ? args.slice(2) : args.slice(1);
    const forced = ["--no-pager", subcmd];
    if (["diff", "log", "show"].includes(subcmd)) forced.push("--no-ext-diff", "--no-textconv");
    return { command, args: [...forced, ...rest], env: makeSafeExecEnv(command, env) };
  }
  if (command === "rg") return { command, args: [...RG_FORCED_ARGS, ...args], env: makeSafeExecEnv(command, env) };
  return { command, args, env: makeSafeExecEnv(command, env) };
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

// Thrown when the endpoint rejects a model outright (retired or missing) so a
// lane dying for that reason says so in the first line of its failure instead
// of surfacing as an ordinary HTTP failure or looking like a timeout.
export class OllamaModelUnavailableError extends Error {
  constructor(model, body) {
    super(`Ollama model ${model} unavailable: ${truncate(body, 200)}`);
    this.name = "OllamaModelUnavailableError";
    this.model = model;
    this.body = body;
  }
}

// Returns "retired" for bodies like {"error":"glm-4.7 was retired at ..."} and
// "missing" for bodies like {"error":"model 'glm-5.1-flash' not found"},
// else null. Models have been retired twice in two months; this will repeat.
function classifyModelUnavailable(body) {
  if (typeof body !== "string" || body.length === 0) return null;
  if (body.includes("was retired at")) return "retired";
  if (body.includes("not found")) return "missing";
  return null;
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

export async function postChat(messages, { timeoutMs } = {}) {
  if (ENDPOINT_CONFIG.error) throw new Error(ENDPOINT_CONFIG.error);

  // The caller may bound this call more tightly than the standing per-request
  // timeout when the run's own budget is nearly spent. See callTimeoutMs.
  const requestTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : Number.parseInt(process.env.HATTA_REQUEST_TIMEOUT_MS || "120000", 10);
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
      if (classifyModelUnavailable(body)) {
        throw new OllamaModelUnavailableError(MODEL, body);
      }
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
  // DELIBERATELY NOT `now`. `now` is the evidence clock, and tests drive it with
  // a fake that jumps minutes per call to simulate a slow run. Timing the model
  // call with that same clock would make every extra reading consume simulated
  // budget, so adding a measurement would change when the loop stops. This is a
  // separate monotonic reading whose only job is "how long did that call take";
  // under a fake evidence clock it reports ~0, which reads as unobserved and
  // leaves the conservative full reserve in place.
  monotonicMs = () => Date.now(),
  maxIterations = effectiveMaxIterations(),
  outerRunBudgetMs = OUTER_RUN_BUDGET_MS,
} = {}) {
  const startedAt = now();
  const startedAtMs = timeMs(startedAt);
  const evidence = makeEvidence(startedAt);
  currentEvidence = evidence;
  const messages = [{ role: "user", content: prompt }];

  // The slowest model call seen in THIS run. The clock reserve is derived from
  // it rather than from the per-request timeout, so a fast model is not charged
  // a slow model's worst case for the whole run.
  let slowestCallMs = null;

  try {
    for (let index = 0; ; index += 1) {
      // ONE clock reading per iteration, reused. The evidence clock is injected,
      // and tests drive it with a fake that jumps minutes per call — so an extra
      // reading here would silently spend simulated budget and change when the
      // loop stops. Reading once and passing the value around costs nothing and
      // keeps the measurement out of the thing being measured.
      const iterationNowMs = timeMs(now());
      const perRequestMs = currentRequestTimeoutMs();
      const stop = iterationStopReason(index, startedAtMs, iterationNowMs, {
        maxIterations,
        observedCallMs: slowestCallMs,
        outerRunBudgetMs,
        requestTimeoutMs: perRequestMs,
      });
      if (stop) {
        evidence.error = stop.message;
        return evidence;
      }

      evidence.iterations = index + 1;
      const callStartedMs = monotonicMs();
      const response = await chat(messages, {
        timeoutMs: callTimeoutMs({
          elapsedMs: Math.max(0, iterationNowMs - startedAtMs),
          outerRunBudgetMs,
          requestTimeoutMs: perRequestMs,
        }),
      });
      const callMs = Math.max(0, monotonicMs() - callStartedMs);
      if (slowestCallMs === null || callMs > slowestCallMs) slowestCallMs = callMs;
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

