// ops-watcher/standards.regression.test.mjs
// Regression guard for project layer and skill routing standards.
// Offline: node:assert/strict + a local pass/fail counter.
// No node:test, no external dependencies. Reads the REAL
// config/project-layers.json and config/skill-matrix.json (resolved relative
// to the repo root) and asserts the standards contract:
//
//   node ops-watcher/standards.regression.test.mjs
//
// Covers:
//   (S1) Both config files parse as JSON.
//   (S2) project-layers.json has exactly 13 entries with unique ids.
//   (S3) Every layer status is implemented / partial / not-started / deferred.
//   (S4) Every layer has non-empty evidence, including deferred layers.
//   (S5) skill-matrix.json has entries, each with required skills, standards,
//        and hard stops.
//   (S6) Retired worker ids do not appear anywhere in either file.
//   (S7) GIBRAN is never a preferredMaker.
//   (S8) Every requiredStandards path exists on disk.

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT_LAYERS_PATH = path.resolve(ROOT, "config", "project-layers.json");
const SKILL_MATRIX_PATH = path.resolve(ROOT, "config", "skill-matrix.json");

const ALLOWED_STATUSES = new Set(["implemented", "partial", "not-started", "deferred"]);
const RETIRED_WORKER_IDS = ["soedirman", "glm52", "thomas", "soeharto"];

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  console.log(`PASS: ${name}`);
  passed++;
}

function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name);
  failed++;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

let projectLayersText = "";
let skillMatrixText = "";
let projectLayers = null;
let skillMatrix = null;

function S1_configsParseAsJson() {
  const name = "S1 project-layers and skill-matrix parse as JSON";
  try {
    projectLayersText = readFileSync(PROJECT_LAYERS_PATH, "utf8");
    skillMatrixText = readFileSync(SKILL_MATRIX_PATH, "utf8");
    projectLayers = JSON.parse(projectLayersText);
    skillMatrix = JSON.parse(skillMatrixText);
    assert.ok(Array.isArray(projectLayers), "project-layers.json must be a JSON array");
    assert.ok(Array.isArray(skillMatrix), "skill-matrix.json must be a JSON array");
    ok(name);
  } catch (err) { bad(name, err); }
}

function S2_projectLayersHave13UniqueIds() {
  const name = "S2 project-layers has exactly 13 entries with unique ids";
  try {
    assert.equal(projectLayers.length, 13, "project layer count");
    const ids = projectLayers.map((layer) => layer && layer.id);
    for (const id of ids) assert.ok(nonEmptyString(id), `empty layer id ${JSON.stringify(id)}`);
    assert.equal(new Set(ids).size, ids.length, "duplicate project layer ids detected");
    ok(name);
  } catch (err) { bad(name, err); }
}

function S3_projectLayerStatusesAllowed() {
  const name = "S3 every layer status is an allowed value";
  try {
    for (const layer of projectLayers) {
      assert.ok(ALLOWED_STATUSES.has(layer.status), `${layer.id} has invalid status ${JSON.stringify(layer.status)}`);
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

function S4_projectLayerEvidenceNonEmpty() {
  const name = "S4 every layer evidence is non-empty, including deferred layers";
  try {
    for (const layer of projectLayers) {
      assert.ok(nonEmptyString(layer.evidence), `${layer.id} has empty evidence`);
      if (layer.status === "deferred") {
        assert.ok(nonEmptyString(layer.evidence), `${layer.id} is deferred with empty evidence`);
      }
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

function S5_skillMatrixEntriesHaveRequiredFields() {
  const name = "S5 skill-matrix entries require skills, standards and hard stops";
  try {
    assert.ok(skillMatrix.length > 0, "skill-matrix.json must have at least one entry");
    for (const entry of skillMatrix) {
      const label = entry && entry.taskClass ? entry.taskClass : JSON.stringify(entry);
      assert.ok(Array.isArray(entry.requiredSkills) && entry.requiredSkills.length > 0, `${label} missing requiredSkills`);
      assert.ok(Array.isArray(entry.requiredStandards) && entry.requiredStandards.length > 0, `${label} missing requiredStandards`);
      assert.ok(Array.isArray(entry.hardStops) && entry.hardStops.length > 0, `${label} missing hardStops`);
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

function S6_retiredWorkerIdsAbsent() {
  const name = "S6 retired worker ids are absent from standards config files";
  try {
    const haystacks = [
      ["project-layers.json", projectLayersText.toLowerCase()],
      ["skill-matrix.json", skillMatrixText.toLowerCase()],
    ];
    for (const retiredId of RETIRED_WORKER_IDS) {
      for (const [file, text] of haystacks) {
        assert.equal(text.includes(retiredId), false, `${retiredId} appears in ${file}`);
      }
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

function S7_gibranIsNeverPreferredMaker() {
  const name = "S7 GIBRAN is never a preferredMaker";
  try {
    for (const entry of skillMatrix) {
      assert.notEqual(String(entry.preferredMaker || "").toUpperCase(), "GIBRAN", `${entry.taskClass} has GIBRAN as preferredMaker`);
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

function S8_requiredStandardsPathsExist() {
  const name = "S8 every requiredStandards path exists on disk";
  try {
    for (const entry of skillMatrix) {
      for (const standardPath of entry.requiredStandards) {
        assert.ok(nonEmptyString(standardPath), `${entry.taskClass} has an empty requiredStandards path`);
        const resolved = path.resolve(ROOT, standardPath);
        assert.ok(existsSync(resolved), `${entry.taskClass} required standard is missing: ${standardPath}`);
      }
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

function main() {
  console.log("# ops-watcher standards regression tests");
  S1_configsParseAsJson();
  if (projectLayers && skillMatrix) {
    S2_projectLayersHave13UniqueIds();
    S3_projectLayerStatusesAllowed();
    S4_projectLayerEvidenceNonEmpty();
    S5_skillMatrixEntriesHaveRequiredFields();
    S6_retiredWorkerIdsAbsent();
    S7_gibranIsNeverPreferredMaker();
    S8_requiredStandardsPathsExist();
  }
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
