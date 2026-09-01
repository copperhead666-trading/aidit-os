// ops-watcher/gbrain-curator.mjs
// Single-sweep GBrain curator for canonical FounderOS-Aidit sources.
// Ingests the five canonical source files that ops-watcher/ahmad-context-retrieval.mjs
// expects to find indexed in GBrain (by slug), but only when the source file's mtime
// is newer than the last successful ingestion recorded in a small local state file.
//
//   node ops-watcher/gbrain-curator.mjs --once
//
// This is intentionally read-only with respect to Paperclip and Telegram. It only
// spawns `gbrain capture --file ... --slug ... --type concept --json` for stale or
// never-ingested canonical files. `capture --file` is used instead of `gbrain put`
// because `put` routes through stdin and has a documented ~45KB pipe-buffer limit on
// Windows; `capture` reads the file directly.
//
// The five slugs and their relative source paths are duplicated here (not imported)
// because ahmad-context-retrieval.mjs defines KNOWN_CANONICAL_SOURCES as an internal
// `const`. Keeping this copy identical to that map is critical: the retrieval side's
// inferCanonicalPath/freshness-check logic depends on these exact slugs.

import { promises as fs, readFileSync as defaultReadFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Mirrors the KNOWN_CANONICAL_SOURCES map in ahmad-context-retrieval.mjs.
// DO NOT change slugs here without changing the read-side map there.
const KNOWN_CANONICAL_SOURCES = new Map([
  ["agent-registry", "config/agent-registry.json"],
  ["canonical-decision-ledger", "config/decision-ledger.json"],
  ["paperclip-endpoint", "config/paperclip-endpoint.json"],
  ["master-canonical-backlog", "handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json"],
  ["canonical-role-map", "handoffs/sjahrir/CANONICAL-ROLE-MAP.json"],
]);

const DEFAULT_STATE_FILE = path.join(__dirname, "gbrain-curator-state.json");
export const CAPTURE_TIMEOUT_MS = 300000;
export const BACKOFF_MS = 6 * 60 * 60 * 1000;
export const GBRAIN_LOCK_FILE = path.join(os.homedir(), ".gbrain", "brain.pglite", ".gbrain-lock", "lock");
export const PROJECTION_MAX_BYTES = 60000;
export function projectAgentRegistry(rawText) {
  const source = JSON.parse(rawText);
  const projection = {
    projection_note: "Proyeksi ringkas dari config/agent-registry.json (sumber asli 181KB, terlalu besar untuk di-embed). Bagian naratif/historis dihilangkan; hanya metadata dan roster agen yang disertakan.",
    source_path: "config/agent-registry.json",
  };
  for (const key of [
    "schema_version",
    "workspace",
    "last_updated_at",
    "canonical_boundary_note",
    "note",
    "agents",
    "retired_reference_only",
    "external_agents_not_owned_by_this_registry",
  ]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      projection[key] = source[key];
    }
  }
  return JSON.stringify(projection, null, 2);
}

export const SOURCE_PROJECTIONS = new Map([["agent-registry", projectAgentRegistry]]);

async function defaultReadSource(file) {
  return fs.readFile(file, "utf8");
}

async function defaultWriteTemp(slug, text) {
  const tempFile = path.join(os.tmpdir(), "gbrain-curator-" + slug + ".json");
  await fs.writeFile(tempFile, text, "utf8");
  return tempFile;
}

function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === "EPERM") return true;
    return false;
  }
}

export function readGbrainLockHolder(lockFile, { readFileSync = defaultReadFileSync, isPidAlive = defaultIsPidAlive } = {}) {
  let raw;
  try {
    raw = readFileSync(lockFile, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.pid !== "number" || !isPidAlive(parsed.pid)) {
    return null;
  }
  return { pid: parsed.pid, command: parsed.command };
}

// ---- State-file persistence (mirrors telegram-listener.mjs) ----
// defaultReadState returns { ok, value?, code?, message? }. ok=false with
// code "ENOENT" means the file simply does not exist yet (first run) — caller
// treats that as an empty state with no warning. Any OTHER read failure (corrupt
// JSON, permission error) is surfaced so the caller can WARN.
export async function defaultReadState(file) {
  try {
    return { ok: true, value: JSON.parse(await fs.readFile(file, "utf8")) };
  } catch (err) {
    return { ok: false, code: err && err.code, message: err && err.message };
  }
}

// defaultWriteState returns { ok, code?, message? }. A failure here means the
// next run may re-ingest files that have not actually changed.
export async function defaultWriteState(file, obj) {
  try {
    await fs.writeFile(file, JSON.stringify(obj, null, 2), "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err && err.code, message: err && err.message };
  }
}

// Spawn `gbrain capture --file <sourceFile> --slug <slug> --type concept --json`
// and return a normalized { ok, slug, error? } result. ok=true only when the
// process exits 0 AND the JSON stdout does not itself contain an error field.
function terminateTimedOutCapture(child, { platform = process.platform, spawnFn = spawn } = {}) {
  if (platform === "win32" && child && child.pid) {
    try {
      const killer = spawnFn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      if (killer && typeof killer.on === "function") killer.on("error", () => {});
      return;
    } catch {
      // Fall through to the ordinary kill attempt below.
    }
  }
  try { child.kill("SIGTERM"); } catch { /* ignore */ }
}

export function runCaptureReal(sourceFile, slug, { timeoutMs = CAPTURE_TIMEOUT_MS, spawnFn = spawn, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawnFn("gbrain", ["capture", "--file", sourceFile, "--slug", slug, "--type", "concept", "--json"], {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, slug, error: String(err && err.message ? err.message : err) });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      terminateTimedOutCapture(child, { platform, spawnFn });
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, slug, error: String(err && err.message ? err.message : err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || timedOut) {
        resolve({
          ok: false,
          slug,
          error: timedOut
            ? `gbrain capture timed out after ${timeoutMs}ms`
            : `gbrain capture exited ${code}: ${stderr || stdout || "(no output)"}`,
        });
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        resolve({ ok: false, slug, error: `failed to parse gbrain JSON: ${err && err.message ? err.message : err}` });
        return;
      }
      if (parsed && parsed.error) {
        resolve({ ok: false, slug, error: String(parsed.error) });
        return;
      }
      resolve({ ok: true, slug, data: parsed });
    });
  });
}

function resolveSourceFile(relPath) {
  return path.resolve(ROOT, relPath);
}

function rootRel(relPath) {
  const full = resolveSourceFile(relPath);
  const rel = path.relative(ROOT, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return relPath;
  return rel;
}

// Core single sweep. All real I/O is dependency-injected.
// deps: {
//   sources (Map<slug, relPath>),
//   statFile (async (path) => fs.Stats),
//   runCapture (async (sourceFile, slug) => { ok, slug, error? }),
//   stateFile (string),
//   readState (async (file) => { ok, value?, code?, message? }),
//   writeState (async (file, obj) => { ok, code?, message? }),
//   readGbrainLockHolder (fn),
//   lockFile (string),
//   readFileSync (fn),
//   isPidAlive (fn),
//   readSource (async (path) => string),
//   writeTemp (async (slug, text) => tempPath),
//   sourceProjections (Map<slug, fn>),
//   projectionMaxBytes (number),
//   log (fn),
//   now (fn)
// }
export async function runGbrainCuratorOnce(deps = {}) {
  const {
    sources = KNOWN_CANONICAL_SOURCES,
    statFile = fs.stat,
    runCapture = runCaptureReal,
    stateFile = DEFAULT_STATE_FILE,
    readState = defaultReadState,
    writeState = defaultWriteState,
    readGbrainLockHolder: checkLock = readGbrainLockHolder,
    lockFile = GBRAIN_LOCK_FILE,
    readFileSync = defaultReadFileSync,
    isPidAlive = defaultIsPidAlive,
    readSource = defaultReadSource,
    writeTemp = defaultWriteTemp,
    sourceProjections = SOURCE_PROJECTIONS,
    projectionMaxBytes = PROJECTION_MAX_BYTES,
    log = (m) => console.log(m),
    now = Date.now,
  } = deps;

  const startedAt = now();
  log(`gbrain-curator --once START ${new Date(startedAt).toISOString()}`);

  const sr = await readState(stateFile);
  let state = {};
  let stateReadReset = false;
  if (sr.ok && sr.value && typeof sr.value === "object") {
    state = sr.value;
  } else if (!sr.ok && sr.code !== "ENOENT") {
    stateReadReset = true;
    log(`gbrain-curator: WARN state file read failed (code=${sr.code || "?"}, msg=${String(sr.message || "").slice(0, 120)}) — resetting freshness state; all sources will be re-evaluated`);
  }

  const nextState = { ...state };
  if (nextState.__failures && typeof nextState.__failures === "object") {
    nextState.__failures = { ...nextState.__failures };
  }
  const results = [];
  let failuresChanged = false;

  for (const [slug, relPath] of sources.entries()) {
    const sourceFile = resolveSourceFile(relPath);
    const displayPath = rootRel(relPath);

    let st;
    try {
      st = await statFile(sourceFile);
    } catch (err) {
      if (err && err.code === "ENOENT") {
        const reason = `source file not found: ${displayPath}`;
        log(`gbrain-curator: SKIP ${slug} — ${reason}`);
        results.push({ slug, sourceFile: displayPath, outcome: "skipped-missing", reason });
        continue;
      }
      const reason = `stat failed (${err && err.code || "?"}: ${err && err.message || err})`;
      log(`gbrain-curator: SKIP ${slug} — ${reason}`);
      results.push({ slug, sourceFile: displayPath, outcome: "skipped-missing", reason });
      continue;
    }

    const recorded = state[slug];
    const currentMtime = st.mtimeMs;
    if (Number.isFinite(recorded) && recorded >= currentMtime) {
      log(`gbrain-curator: SKIP ${slug} — up to date (mtimeMs=${currentMtime})`);
      results.push({ slug, sourceFile: displayPath, outcome: "up-to-date" });
      continue;
    }

    const failures = state.__failures && typeof state.__failures === "object" ? state.__failures : {};
    const failure = failures[slug];

    if (
      failure &&
      typeof failure === "object" &&
      failure.count >= 3 &&
      failure.mtimeMs === currentMtime &&
      startedAt - failure.lastAttemptMs < BACKOFF_MS
    ) {
      const retryAfter = new Date(failure.lastAttemptMs + BACKOFF_MS).toISOString();
      const reason = `backoff after ${failure.count} consecutive failures, retry after ${retryAfter}`;
      log(`gbrain-curator: SKIP ${slug} — ${reason}`);
      results.push({ slug, sourceFile: displayPath, outcome: "skipped-backoff", reason });
      continue;
    }

    if (failure && typeof failure === "object" && failure.mtimeMs !== currentMtime) {
      if (nextState.__failures && Object.prototype.hasOwnProperty.call(nextState.__failures, slug)) {
        delete nextState.__failures[slug];
        failuresChanged = true;
      }
    }

    const lockHolder = await checkLock(lockFile, { readFileSync, isPidAlive });
    if (lockHolder) {
      const reason = `gbrain lock held by pid ${lockHolder.pid}, deferring to next sweep`;
      log(`gbrain-curator: SKIP ${slug} — ${reason}`);
      results.push({ slug, sourceFile: displayPath, outcome: "skipped-locked", reason });
      continue;
    }

    const recordFailure = (reason) => {
      log(`gbrain-curator: FAIL ${slug} — ${reason}`);
      if (!nextState.__failures || typeof nextState.__failures !== "object") {
        nextState.__failures = {};
      }
      const priorCount = failure && typeof failure === "object" && failure.mtimeMs === currentMtime ? failure.count : 0;
      nextState.__failures[slug] = { count: priorCount + 1, lastAttemptMs: startedAt, mtimeMs: currentMtime };
      failuresChanged = true;
      results.push({ slug, sourceFile: displayPath, outcome: "failed", reason });
    };

    let captureSourceFile = sourceFile;
    const projectSource = sourceProjections && typeof sourceProjections.get === "function" ? sourceProjections.get(slug) : null;
    if (projectSource) {
      try {
        const rawText = await readSource(sourceFile);
        const projectedText = projectSource(rawText);
        const sourceBytes = Buffer.byteLength(rawText, "utf8");
        const projectedBytes = Buffer.byteLength(projectedText, "utf8");
        if (projectedBytes > projectionMaxBytes) {
          recordFailure(`projection still too large (${projectedBytes} bytes)`);
          continue;
        }
        captureSourceFile = await writeTemp(slug, projectedText);
        log(`gbrain-curator: PROJECT ${slug} — ${sourceBytes} bytes -> ${projectedBytes} bytes`);
      } catch (err) {
        const reason = String(err && err.message ? err.message : err);
        recordFailure(reason);
        continue;
      }
    }

    log(`gbrain-curator: CAPTURE ${slug} (${displayPath}) mtimeMs=${currentMtime} previous=${Number.isFinite(recorded) ? recorded : "none"}`);
    const capture = await runCapture(captureSourceFile, slug);
    if (!capture.ok) {
      const reason = capture.error || "capture failed";
      recordFailure(reason);
      continue;
    }

    log(`gbrain-curator: OK ${slug} — captured`);
    nextState[slug] = currentMtime;
    if (nextState.__failures && Object.prototype.hasOwnProperty.call(nextState.__failures, slug)) {
      delete nextState.__failures[slug];
      failuresChanged = true;
    }
    results.push({ slug, sourceFile: displayPath, outcome: "ingested" });
  }

  // Only write state if at least one source was successfully ingested, if a
  // failure counter changed, OR if the state file was reset on read (so a fresh
  // empty state is persisted). If nothing changed and the read was clean, skip
  // the write entirely.
  const shouldWrite = stateReadReset || results.some((r) => r.outcome === "ingested") || failuresChanged;
  let persistError = null;
  if (shouldWrite) {
    const wr = await writeState(stateFile, nextState);
    if (!wr.ok) {
      persistError = wr.code || wr.message || "write-failed";
      log(`gbrain-curator: ERROR persisting state FAILED (code=${wr.code || "?"}, msg=${String(wr.message || "").slice(0, 120)}) — next run may re-ingest unchanged files`);
    } else {
      log(`gbrain-curator: persisted state (${Object.keys(nextState).length} slugs)`);
    }
  }

  const finishedAt = now();
  const ingested = results.filter((r) => r.outcome === "ingested").length;
  const upToDate = results.filter((r) => r.outcome === "up-to-date").length;
  const skipped = results.filter((r) => r.outcome === "skipped-missing").length;
  const failed = results.filter((r) => r.outcome === "failed").length;
  const skippedLocked = results.filter((r) => r.outcome === "skipped-locked").length;
  const skippedBackoff = results.filter((r) => r.outcome === "skipped-backoff").length;
  log(`gbrain-curator --once DONE ${new Date(finishedAt).toISOString()} — ingested=${ingested} up-to-date=${upToDate} skipped=${skipped} failed=${failed} skipped-locked=${skippedLocked} skipped-backoff=${skippedBackoff}`);

  return { results, persistError };
}

// ---- CLI ----
function parseArgs(argv) {
  const out = { once: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--once") out.once = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.once) {
    console.error("usage: node ops-watcher/gbrain-curator.mjs --once");
    process.exit(2);
  }
  await runGbrainCuratorOnce({ log: (m) => console.log(m) });
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) {
  main().catch((err) => {
    console.error("gbrain-curator fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
