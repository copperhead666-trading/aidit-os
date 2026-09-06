// ops-watcher/gbrain.mjs
// Local G-Brain engine for knowledge/store/notes/*.md.
//
// Conservative decisions:
// - Text before the first "##" is indexed as a preamble chunk so no note
//   content is silently discarded.
// - A corrupt or half-written index is treated as absent. Crashing here would
//   turn a recoverable store rebuild into an ops failure.
// - If embeddings are unavailable during query, results explicitly say
//   fallback=true and use markdown text search over the source notes.

import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const GBRAIN_SCHEMA_VERSION = 1;
export const DEFAULT_NOTES_DIR = path.join(ROOT, "knowledge", "store", "notes");
export const DEFAULT_GBRAIN_DIR = path.join(ROOT, "knowledge", "store", ".gbrain");
export const GBRAIN_INDEX_FILE = path.join(DEFAULT_GBRAIN_DIR, "index.json");
export const DEFAULT_EMBED_MODEL = "nomic-embed-text:latest";
export const DEFAULT_OLLAMA_EMBED_URL = "http://localhost:11434/api/embed";

function sha256(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function rootRelative(file, root = ROOT) {
  const rel = path.relative(root, path.resolve(file));
  return rel.startsWith("..") || path.isAbsolute(rel) ? path.resolve(file) : rel.split(path.sep).join("/");
}

function normalizeMarkdown(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function splitMarkdownSections(markdown) {
  const text = normalizeMarkdown(markdown);
  const matches = [...text.matchAll(/^##\s+(.+?)\s*$/gm)];
  const chunks = [];

  if (matches.length === 0) {
    const only = text.trim();
    return only ? [{ sectionTitle: "Document", text: only, ordinal: 0 }] : [];
  }

  const preamble = text.slice(0, matches[0].index).trim();
  if (preamble) {
    chunks.push({ sectionTitle: "Preamble", text: preamble, ordinal: 0 });
  }

  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const sectionText = text.slice(start, end).trim();
    if (!sectionText) continue;
    chunks.push({
      sectionTitle: matches[i][1].trim(),
      text: sectionText,
      ordinal: chunks.length,
    });
  }

  return chunks;
}

export async function listMarkdownNoteFiles(notesDir = DEFAULT_NOTES_DIR, deps = {}) {
  const readdir = deps.readdir || fs.readdir;
  let entries;
  try {
    entries = await readdir(notesDir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => path.join(notesDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

export async function embedTextWithOllama(text, opts = {}) {
  const {
    fetchFn = globalThis.fetch,
    url = DEFAULT_OLLAMA_EMBED_URL,
    model = DEFAULT_EMBED_MODEL,
  } = opts;
  if (typeof fetchFn !== "function") throw new Error("fetch is unavailable for Ollama embeddings");
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: text }),
  });
  if (!res.ok) throw new Error(`Ollama embed failed: HTTP ${res.status}`);
  const body = await res.json();
  const embedding = Array.isArray(body?.embeddings?.[0])
    ? body.embeddings[0]
    : (Array.isArray(body?.embedding) ? body.embedding : null);
  if (!embedding || embedding.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    throw new Error("Ollama embed response did not contain a numeric embedding");
  }
  return embedding;
}

export function validateGbrainIndex(value) {
  if (!value || typeof value !== "object") return false;
  if (value.schemaVersion !== GBRAIN_SCHEMA_VERSION) return false;
  if (!Array.isArray(value.chunks)) return false;
  return value.chunks.every((chunk) => (
    chunk &&
    typeof chunk === "object" &&
    typeof chunk.sourceFile === "string" &&
    typeof chunk.sectionTitle === "string" &&
    typeof chunk.text === "string" &&
    typeof chunk.hash === "string" &&
    Array.isArray(chunk.embedding) &&
    chunk.embedding.every((n) => typeof n === "number" && Number.isFinite(n))
  ));
}

export async function readGbrainIndex(indexFile = GBRAIN_INDEX_FILE, deps = {}) {
  const readFile = deps.readFile || fs.readFile;
  try {
    const parsed = JSON.parse(await readFile(indexFile, "utf8"));
    return validateGbrainIndex(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeIndexAtomic(indexFile, index, deps = {}) {
  const mkdir = deps.mkdir || fs.mkdir;
  const writeFile = deps.writeFile || fs.writeFile;
  const rename = deps.rename || fs.rename;
  await mkdir(path.dirname(indexFile), { recursive: true });
  const tmp = `${indexFile}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(index, null, 2), "utf8");
  await rename(tmp, indexFile);
}

export async function buildGbrainIndex(opts = {}) {
  const {
    notesDir = DEFAULT_NOTES_DIR,
    indexFile = GBRAIN_INDEX_FILE,
    model = DEFAULT_EMBED_MODEL,
    embedText = (text) => embedTextWithOllama(text, { model }),
    readFile = fs.readFile,
    noteFiles,
    now = () => new Date().toISOString(),
  } = opts;

  const prior = await readGbrainIndex(indexFile, { readFile });
  const reusableByHash = new Map();
  for (const chunk of prior?.chunks || []) {
    if (!reusableByHash.has(chunk.hash)) reusableByHash.set(chunk.hash, chunk.embedding);
  }

  const files = Array.isArray(noteFiles) ? [...noteFiles].sort((a, b) => a.localeCompare(b)) : await listMarkdownNoteFiles(notesDir, opts);
  const chunks = [];
  let embedded = 0;
  let reused = 0;

  for (const file of files) {
    const markdown = await readFile(file, "utf8");
    const sourceFile = rootRelative(file);
    const sections = splitMarkdownSections(markdown);
    for (const section of sections) {
      const hash = sha256(section.text);
      let embedding = reusableByHash.get(hash);
      if (embedding) {
        reused += 1;
      } else {
        embedding = await embedText(section.text);
        embedded += 1;
      }
      chunks.push({
        id: `${sourceFile}#${section.ordinal}-${sha256(`${section.sectionTitle}\n${section.text}`).slice(0, 12)}`,
        sourceFile,
        sourcePath: path.resolve(file),
        sectionTitle: section.sectionTitle,
        text: section.text,
        hash,
        embedding,
      });
    }
  }

  const index = {
    schemaVersion: GBRAIN_SCHEMA_VERSION,
    generatedAt: typeof now === "function" ? now() : new Date().toISOString(),
    model,
    notesDir: rootRelative(notesDir),
    chunks,
  };
  await writeIndexAtomic(indexFile, index, opts);
  return { index, embedded, reused, chunks: chunks.length, files: files.length, indexFile };
}

function tokenize(text) {
  return [...new Set(String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2))];
}

function keywordScore(query, chunk) {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;
  const hay = `${chunk.sectionTitle || ""}\n${chunk.sourceFile || ""}\n${chunk.text || ""}`.toLowerCase();
  let hits = 0;
  for (const term of terms) if (hay.includes(term)) hits += 1;
  const phrase = String(query || "").trim().toLowerCase();
  const phraseBoost = phrase.length >= 4 && hay.includes(phrase) ? 0.5 : 0;
  return Math.min(1, hits / terms.length + phraseBoost);
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let an = 0;
  let bn = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    an += a[i] * a[i];
    bn += b[i] * b[i];
  }
  if (an === 0 || bn === 0) return 0;
  return dot / (Math.sqrt(an) * Math.sqrt(bn));
}

function rankTextFallback(question, chunks, topK) {
  const ranked = chunks
    .map((chunk) => ({ chunk, score: keywordScore(question, chunk) }))
    .sort((a, b) => b.score - a.score || a.chunk.sourceFile.localeCompare(b.chunk.sourceFile));
  const picked = ranked.some((r) => r.score > 0) ? ranked.filter((r) => r.score > 0) : ranked;
  return picked.slice(0, topK).map(({ chunk, score }) => ({
    sourceFile: chunk.sourceFile,
    sectionTitle: chunk.sectionTitle,
    text: chunk.text,
    score,
    keywordScore: score,
  }));
}

async function readLiveMarkdownChunks(notesDir, deps = {}) {
  const readFile = deps.readFile || fs.readFile;
  const files = await listMarkdownNoteFiles(notesDir, deps);
  const chunks = [];
  for (const file of files) {
    const sourceFile = rootRelative(file);
    const markdown = await readFile(file, "utf8");
    for (const section of splitMarkdownSections(markdown)) {
      chunks.push({ sourceFile, sectionTitle: section.sectionTitle, text: section.text });
    }
  }
  return chunks;
}

export async function queryGbrain(question, opts = {}) {
  const {
    indexFile = GBRAIN_INDEX_FILE,
    notesDir = DEFAULT_NOTES_DIR,
    topK = 5,
    model = DEFAULT_EMBED_MODEL,
    embedText = (text) => embedTextWithOllama(text, { model }),
  } = opts;

  const index = await readGbrainIndex(indexFile, opts);
  if (!index) {
    const chunks = await readLiveMarkdownChunks(notesDir, opts);
    return {
      fallback: true,
      mode: "text-fallback",
      reason: "gbrain index is missing or unreadable",
      results: rankTextFallback(question, chunks, topK),
    };
  }

  let queryEmbedding;
  try {
    queryEmbedding = await embedText(question);
  } catch (err) {
    const chunks = await readLiveMarkdownChunks(notesDir, opts);
    return {
      fallback: true,
      mode: "text-fallback",
      reason: `embedding unavailable: ${err && err.message ? err.message : err}`,
      results: rankTextFallback(question, chunks, topK),
    };
  }

  const results = index.chunks
    .map((chunk) => {
      const semanticScore = cosine(queryEmbedding, chunk.embedding);
      const kw = keywordScore(question, chunk);
      const normalizedSemantic = (semanticScore + 1) / 2;
      return {
        sourceFile: chunk.sourceFile,
        sectionTitle: chunk.sectionTitle,
        text: chunk.text,
        score: (normalizedSemantic * 0.75) + (kw * 0.25),
        semanticScore,
        keywordScore: kw,
      };
    })
    .sort((a, b) => b.score - a.score || b.keywordScore - a.keywordScore || a.sourceFile.localeCompare(b.sourceFile))
    .slice(0, topK);

  return { fallback: false, mode: "hybrid", model: index.model || model, results };
}

function parseCliArgs(argv) {
  const out = { command: argv[2] || "", question: argv.slice(3).join(" ") };
  return out;
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (args.command === "index") {
    const result = await buildGbrainIndex();
    console.log(JSON.stringify({
      ok: true,
      files: result.files,
      chunks: result.chunks,
      embedded: result.embedded,
      reused: result.reused,
      indexFile: result.indexFile,
    }, null, 2));
    return;
  }
  if (args.command === "query" && args.question) {
    console.log(JSON.stringify(await queryGbrain(args.question), null, 2));
    return;
  }
  console.error("usage: node ops-watcher/gbrain.mjs index | query <question>");
  process.exitCode = 2;
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
    console.error("gbrain fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
