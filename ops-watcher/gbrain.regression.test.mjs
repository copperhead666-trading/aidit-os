// ops-watcher/gbrain.regression.test.mjs
// Offline regression tests for the local G-Brain markdown index/query engine.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildGbrainIndex,
  queryGbrain,
  readGbrainIndex,
  splitMarkdownSections,
} from "./gbrain.mjs";
import { detectConnectorDegradation } from "./watcher.mjs";

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed += 1; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name);
  failed += 1;
}

async function withTempStore(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gbrain-regression-"));
  const notesDir = path.join(dir, "notes");
  const gbrainDir = path.join(dir, ".gbrain");
  await fs.mkdir(notesDir, { recursive: true });
  await fs.mkdir(gbrainDir, { recursive: true });
  try {
    return await fn({ dir, notesDir, indexFile: path.join(gbrainDir, "index.json") });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function fakeEmbedding(text) {
  const s = String(text).toLowerCase();
  if (s.includes("venture") || s.includes("market")) return [1, 0, 0];
  if (s.includes("runtime") || s.includes("ollama")) return [0, 1, 0];
  if (s.includes("source") || s.includes("sumber")) return [0, 0, 1];
  return [0.2, 0.2, 0.2];
}

async function writeNote(notesDir, name, text) {
  const file = path.join(notesDir, name);
  await fs.writeFile(file, text, "utf8");
  return file;
}

async function testSplitIndexesMarkdownSectionsAndReusesHashes() {
  const name = "index -> chunks per markdown section and unchanged chunks are reused";
  try {
    await withTempStore(async ({ notesDir, indexFile }) => {
      await writeNote(notesDir, "alpha.md", [
        "# Alpha",
        "",
        "Intro retained.",
        "",
        "## Market",
        "Venture registry facts live here.",
        "",
        "## Sumber",
        "source: owner note",
        "",
      ].join("\n"));

      const calls = [];
      const embedText = async (text) => {
        calls.push(text);
        return fakeEmbedding(text);
      };
      const first = await buildGbrainIndex({ notesDir, indexFile, embedText });
      assert.equal(first.chunks, 3, "preamble plus two ## sections are indexed");
      assert.equal(first.embedded, 3, "first build embeds every chunk");
      assert.equal(first.reused, 0);
      assert.equal(calls.length, 3);
      assert.deepEqual(
        first.index.chunks.map((c) => c.sectionTitle),
        ["Preamble", "Market", "Sumber"],
        "section titles preserved",
      );

      calls.length = 0;
      const second = await buildGbrainIndex({ notesDir, indexFile, embedText });
      assert.equal(second.chunks, 3);
      assert.equal(second.embedded, 0, "unchanged hashes are not embedded again");
      assert.equal(second.reused, 3, "all prior embeddings reused");
      assert.equal(calls.length, 0, "embedText seam not called on unchanged second index");
    });
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testHybridQueryReturnsCorrectChunkWithSourceFile() {
  const name = "query -> returns relevant chunk with source filename";
  try {
    await withTempStore(async ({ notesDir, indexFile }) => {
      await writeNote(notesDir, "venture.md", [
        "# Venture",
        "## Facts",
        "The venture registry records market facts and owner-approved venture scope.",
        "## Sumber",
        "source: local markdown",
      ].join("\n"));
      await writeNote(notesDir, "runtime.md", [
        "# Runtime",
        "## Machine",
        "The runtime note records Ollama and Node details.",
      ].join("\n"));
      await buildGbrainIndex({ notesDir, indexFile, embedText: async (text) => fakeEmbedding(text) });
      const result = await queryGbrain("Which note has venture market facts?", {
        notesDir,
        indexFile,
        embedText: async (text) => fakeEmbedding(text),
        topK: 1,
      });
      assert.equal(result.fallback, false);
      assert.equal(result.mode, "hybrid");
      assert.equal(result.results.length, 1);
      assert.equal(path.basename(result.results[0].sourceFile), "venture.md", "source file travels with result");
      assert.equal(result.results[0].sectionTitle, "Facts");
    });
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testEmbeddingDownFallsBackToTextSearch() {
  const name = "query with embedder down -> marked fallback text results, no throw";
  try {
    await withTempStore(async ({ notesDir, indexFile }) => {
      await writeNote(notesDir, "runtime.md", [
        "# Runtime",
        "## Ollama",
        "Ollama provides local embeddings for G-Brain.",
      ].join("\n"));
      await buildGbrainIndex({ notesDir, indexFile, embedText: async (text) => fakeEmbedding(text) });
      const result = await queryGbrain("Ollama embeddings", {
        notesDir,
        indexFile,
        embedText: async () => { throw new Error("daemon refused connection"); },
      });
      assert.equal(result.fallback, true);
      assert.equal(result.mode, "text-fallback");
      assert.match(result.reason, /embedding unavailable/);
      assert.equal(path.basename(result.results[0].sourceFile), "runtime.md");
    });
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testCorruptIndexReadsAsMissingNotCrash() {
  const name = "corrupt index -> treated as missing and query falls back";
  try {
    await withTempStore(async ({ notesDir, indexFile }) => {
      await writeNote(notesDir, "truth.md", [
        "# Truth",
        "## Layers",
        "Truth layers define source precedence.",
      ].join("\n"));
      await fs.writeFile(indexFile, "{\"schemaVersion\":", "utf8");
      assert.equal(await readGbrainIndex(indexFile), null, "corrupt JSON index reads as absent");
      const result = await queryGbrain("truth layers", {
        notesDir,
        indexFile,
        embedText: async () => { throw new Error("should not need embeddings without an index"); },
      });
      assert.equal(result.fallback, true);
      assert.equal(path.basename(result.results[0].sourceFile), "truth.md");
    });
    ok(name);
  } catch (err) { bad(name, err); }
}

function testWatcherDetectorUsesGbrainIndexPresence() {
  const name = "watcher detector -> index present clears finding, missing index keeps finding";
  try {
    const base = { graphify: { active: true, legacy: true } };
    const present = detectConnectorDegradation({ ...base, gbrain: { exists: true, mtimeMs: 1 } });
    assert.equal(present.some((event) => event.detector === "gbrain-store-missing"), false);

    const missing = detectConnectorDegradation({ ...base, gbrain: { exists: false, mtimeMs: null } });
    const event = missing.find((candidate) => candidate.detector === "gbrain-store-missing");
    assert.ok(event, "missing index still emits detector");
    assert.match(event.payload.path, /knowledge[\\/]store[\\/]\.gbrain[\\/]index\.json$/);
    ok(name);
  } catch (err) { bad(name, err); }
}

function testSplitMarkdownSectionsNoDataLoss() {
  const name = "splitMarkdownSections -> keeps preamble plus ## sections";
  try {
    const sections = splitMarkdownSections("# Title\n\nLead.\n\n## A\nBody A\n\n## B\nBody B");
    assert.deepEqual(sections.map((s) => s.sectionTitle), ["Preamble", "A", "B"]);
    assert.ok(sections[0].text.includes("Lead."));
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher gbrain regression tests");
  testSplitMarkdownSectionsNoDataLoss();
  await testSplitIndexesMarkdownSectionsAndReusesHashes();
  await testHybridQueryReturnsCorrectChunkWithSourceFile();
  await testEmbeddingDownFallsBackToTextSearch();
  await testCorruptIndexReadsAsMissingNotCrash();
  testWatcherDetectorUsesGbrainIndexPresence();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("gbrain regression runner crashed:", err);
  process.exit(1);
});
