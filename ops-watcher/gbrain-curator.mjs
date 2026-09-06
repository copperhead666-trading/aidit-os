// ops-watcher/gbrain-curator.mjs
// Single-sweep G-Brain curator for knowledge/store/notes/*.md.
//
// It no longer calls a missing `gbrain` CLI. The local engine is
// ops-watcher/gbrain.mjs, which chunks markdown, embeds with Ollama, and writes
// knowledge/store/.gbrain/index.json.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGbrainIndex,
  DEFAULT_NOTES_DIR,
  GBRAIN_INDEX_FILE,
  listMarkdownNoteFiles,
} from "./gbrain.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DEFAULT_STATE_FILE = path.join(__dirname, "gbrain-curator-state.json");
export const BACKOFF_MS = 6 * 60 * 60 * 1000;

function rootRel(file) {
  const rel = path.relative(ROOT, path.resolve(file));
  return rel.startsWith("..") || path.isAbsolute(rel) ? path.resolve(file) : rel.split(path.sep).join("/");
}

function resolveFromRoot(file) {
  return path.isAbsolute(file) ? file : path.resolve(ROOT, file);
}

export async function defaultReadState(file) {
  try {
    return { ok: true, value: JSON.parse(await fs.readFile(file, "utf8")) };
  } catch (err) {
    return { ok: false, code: err && err.code, message: err && err.message };
  }
}

export async function defaultWriteState(file, obj) {
  try {
    await fs.writeFile(file, JSON.stringify(obj, null, 2), "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err && err.code, message: err && err.message };
  }
}

async function resolveNoteFiles(deps) {
  if (Array.isArray(deps.noteFiles)) return deps.noteFiles.map(resolveFromRoot);
  if (deps.sources && typeof deps.sources.values === "function") {
    return [...deps.sources.values()].map(resolveFromRoot);
  }
  return listMarkdownNoteFiles(deps.notesDir || DEFAULT_NOTES_DIR, deps);
}

function priorMtime(state, rel) {
  const noteMtimes = state && typeof state.noteMtimes === "object" ? state.noteMtimes : {};
  const value = noteMtimes[rel] ?? state?.[rel];
  return Number.isFinite(value) ? value : null;
}

function buildSignature(files) {
  return files
    .map((file) => `${file.rel}:${file.mtimeMs}`)
    .sort()
    .join("|");
}

function failureActive(state, signature, startedAt) {
  const failure = state && typeof state.__indexFailure === "object" ? state.__indexFailure : null;
  return Boolean(
    failure &&
    failure.count >= 3 &&
    failure.signature === signature &&
    startedAt - failure.lastAttemptMs < BACKOFF_MS
  );
}

export async function runGbrainCuratorOnce(deps = {}) {
  const {
    notesDir = DEFAULT_NOTES_DIR,
    indexFile = GBRAIN_INDEX_FILE,
    statFile = fs.stat,
    buildIndex = buildGbrainIndex,
    stateFile = DEFAULT_STATE_FILE,
    readState = defaultReadState,
    writeState = defaultWriteState,
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
    log(`gbrain-curator: WARN state file read failed (code=${sr.code || "?"}, msg=${String(sr.message || "").slice(0, 120)}) - resetting freshness state; all notes will be re-evaluated`);
  }

  const noteFiles = await resolveNoteFiles({ ...deps, notesDir });
  const existing = [];
  const results = [];

  for (const file of noteFiles) {
    const rel = rootRel(file);
    let st;
    try {
      st = await statFile(file);
    } catch (err) {
      const reason = err && err.code === "ENOENT"
        ? `note file not found: ${rel}`
        : `stat failed (${err && err.code || "?"}: ${err && err.message || err})`;
      log(`gbrain-curator: SKIP ${rel} - ${reason}`);
      results.push({ sourceFile: rel, outcome: "skipped-missing", reason });
      continue;
    }
    existing.push({ file, rel, mtimeMs: st.mtimeMs });
  }

  const stale = existing.filter((file) => {
    const recorded = priorMtime(state, file.rel);
    return !Number.isFinite(recorded) || recorded < file.mtimeMs;
  });

  if (existing.length === 0) {
    results.push({ outcome: "skipped-empty", reason: "no markdown notes found" });
  }

  for (const file of existing) {
    if (stale.includes(file)) continue;
    log(`gbrain-curator: SKIP ${file.rel} - up to date (mtimeMs=${file.mtimeMs})`);
    results.push({ sourceFile: file.rel, outcome: "up-to-date" });
  }

  const nextState = {
    ...state,
    noteMtimes: {
      ...(state && typeof state.noteMtimes === "object" ? state.noteMtimes : {}),
    },
  };
  let failuresChanged = false;

  const signature = buildSignature(stale);
  if (stale.length > 0 && failureActive(state, signature, startedAt)) {
    const failure = state.__indexFailure;
    const retryAfter = new Date(failure.lastAttemptMs + BACKOFF_MS).toISOString();
    const reason = `backoff after ${failure.count} consecutive failures, retry after ${retryAfter}`;
    for (const file of stale) {
      log(`gbrain-curator: SKIP ${file.rel} - ${reason}`);
      results.push({ sourceFile: file.rel, outcome: "skipped-backoff", reason });
    }
  } else if (stale.length > 0) {
    try {
      log(`gbrain-curator: INDEX ${stale.length} stale note(s) -> ${rootRel(indexFile)}`);
      const built = await buildIndex({
        notesDir,
        indexFile,
        noteFiles: existing.map((file) => file.file),
      });
      for (const file of existing) nextState.noteMtimes[file.rel] = file.mtimeMs;
      delete nextState.__indexFailure;
      failuresChanged = Boolean(state.__indexFailure);
      for (const file of stale) {
        results.push({
          sourceFile: file.rel,
          outcome: "indexed",
          chunks: built.chunks,
          embedded: built.embedded,
          reused: built.reused,
        });
      }
      log(`gbrain-curator: OK indexed ${built.files} file(s), chunks=${built.chunks}, embedded=${built.embedded}, reused=${built.reused}`);
    } catch (err) {
      const reason = String(err && err.message ? err.message : err);
      const prior = state && typeof state.__indexFailure === "object" && state.__indexFailure.signature === signature
        ? state.__indexFailure.count
        : 0;
      nextState.__indexFailure = { count: prior + 1, lastAttemptMs: startedAt, signature };
      failuresChanged = true;
      for (const file of stale) {
        log(`gbrain-curator: FAIL ${file.rel} - ${reason}`);
        results.push({ sourceFile: file.rel, outcome: "failed", reason });
      }
    }
  }

  const shouldWrite = stateReadReset || stale.length > 0 || failuresChanged;
  let persistError = null;
  if (shouldWrite) {
    const wr = await writeState(stateFile, nextState);
    if (!wr.ok) {
      persistError = wr.code || wr.message || "write-failed";
      log(`gbrain-curator: ERROR persisting state FAILED (code=${wr.code || "?"}, msg=${String(wr.message || "").slice(0, 120)}) - next run may re-index unchanged notes`);
    } else {
      log(`gbrain-curator: persisted state (${Object.keys(nextState.noteMtimes || {}).length} notes)`);
    }
  }

  const finishedAt = now();
  const indexed = results.filter((r) => r.outcome === "indexed").length;
  const upToDate = results.filter((r) => r.outcome === "up-to-date").length;
  const skipped = results.filter((r) => r.outcome && r.outcome.startsWith("skipped")).length;
  const failed = results.filter((r) => r.outcome === "failed").length;
  log(`gbrain-curator --once DONE ${new Date(finishedAt).toISOString()} - indexed=${indexed} up-to-date=${upToDate} skipped=${skipped} failed=${failed}`);

  return { results, persistError };
}

function parseArgs(argv) {
  const out = { once: false };
  for (let i = 2; i < argv.length; i += 1) {
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
