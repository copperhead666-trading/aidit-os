// ops-watcher/decision-ledger.regression.test.mjs
// Regression guard for the 2026-09-01 legacy-ledger merge into the active
// decision ledger. Offline: node:assert/strict + a local pass/fail counter.
// No node:test, no external dependencies. Reads the REAL
// config/decision-ledger.json (resolved relative to the repo root) and
// asserts the merge contract:
//
//   node ops-watcher/decision-ledger.regression.test.mjs
//
// Covers:
//   (L1) config/decision-ledger.json parses and still holds all 39 merged
//        records; the count may grow but never shrink.
//   (L2) All 39 record ids are unique.
//   (L3) The 15 original ids are all still present.
//   (L4) All 24 migrated ids are present, and every one carries
//        migrated_from = "legacy owner/aidit-decision-ledger.json" and
//        migrated_at = "2026-09-01".
//   (L5) No record among the original 15 carries migrated_from.
//   (L6) Every record has a non-empty id, type and statement.
//   (L7) Top level has merged_legacy_ledger_at and does NOT have ratified_from.
//   (L8) Any record added after the merge carries full provenance and does
//        not claim to be migrated.

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = path.resolve(__dirname, "..", "config", "decision-ledger.json");

const ORIGINAL_15 = [
  "D3", "D10", "D11", "D12", "D13", "D14", "D16", "D17", "D18", "D20",
  "D24", "D25", "D26", "D27", "D28",
];
const MIGRATED_24 = [
  "D4", "D1", "D7", "D22", "D23", "GOV-006-hist", "CASH-30k-hist", "SUGAR-legacy-char",
  "INV-007", "FIN-003", "SAL-002-003", "CONFLICTS-8", "APPROVAL-0-64", "PIN-plaintext",
  "K-01", "CUS-004", "PIN-shorthand", "CASH-VARIANCE-NEW", "SJS-AUTH-DESIGN",
  "AIDIT-MEMORY-IMPL", "META-ORCH-IMPL", "SUGAR-REG", "RP13M-VERIFY", "LOKA-REVIEW",
];

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name); failed++;
}

let ledger = null;

// This guard used to assert `records.length === 39` — the exact size of the
// 2026-09-01 merge. That was right for a frozen ledger and wrong the moment the
// owner records another decision, which is a normal thing to do; a ledger that
// forbids new entries is not a ledger. What the guard is actually FOR is that
// the merge never loses anything, so it now asserts the merge is intact and the
// count only ever grows. L3/L4 still check all 39 by id, and L8 makes sure a new
// record cannot be added sloppily.
function L1_parsesAndMergeIsIntact() {
  const name = "L1 ledger parses and still holds all 39 merged records";
  try {
    const text = readFileSync(LEDGER_PATH, "utf8");
    ledger = JSON.parse(text);
    assert.ok(ledger && Array.isArray(ledger.records), "records array missing");
    assert.ok(
      ledger.records.length >= ORIGINAL_15.length + MIGRATED_24.length,
      `record count fell below the merged 39 (got ${ledger.records.length})`,
    );
    ok(name);
  } catch (err) { bad(name, err); }
}

// A record added after the merge must be as auditable as the ones that came
// through it. Without this, "the count may grow" would be a hole.
function L8_postMergeRecordsCarryProvenance() {
  const name = "L8 every record added after the merge carries full provenance";
  try {
    const known = new Set([...ORIGINAL_15, ...MIGRATED_24]);
    const added = ledger.records.filter((r) => !known.has(r.id));
    for (const r of added) {
      for (const field of ["id", "type", "statement", "source_kind", "owner_origin", "created_at"]) {
        assert.ok(
          typeof r[field] === "string" && r[field].trim() !== "",
          `${r.id}: ${field} must be a non-empty string`,
        );
      }
      assert.equal(typeof r.canonical, "boolean", `${r.id}: canonical must be a boolean`);
      assert.equal(r.migrated_from, undefined, `${r.id}: a post-merge record must not claim to be migrated`);
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

function L2_idsUnique() {
  const name = "L2 all record ids are unique";
  try {
    const ids = ledger.records.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate ids detected");
    ok(name);
  } catch (err) { bad(name, err); }
}

function L3_original15Present() {
  const name = "L3 all 15 original ids are still present";
  try {
    const ids = new Set(ledger.records.map((r) => r.id));
    for (const id of ORIGINAL_15) assert.ok(ids.has(id), `missing original id ${id}`);
    ok(name);
  } catch (err) { bad(name, err); }
}

function L4_migrated24PresentWithProvenance() {
  const name = "L4 all 24 migrated ids present with migrated_from + migrated_at 2026-09-01";
  try {
    const byId = new Map(ledger.records.map((r) => [r.id, r]));
    for (const id of MIGRATED_24) {
      const r = byId.get(id);
      assert.ok(r, `missing migrated id ${id}`);
      assert.equal(r.migrated_from, "legacy owner/aidit-decision-ledger.json", `migrated_from for ${id}`);
      assert.equal(r.migrated_at, "2026-09-01", `migrated_at for ${id}`);
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

function L5_original15NoMigratedFrom() {
  const name = "L5 none of the original 15 carries migrated_from";
  try {
    const original = ledger.records.filter((r) => ORIGINAL_15.includes(r.id));
    assert.equal(original.length, ORIGINAL_15.length, "all 15 originals found for check");
    for (const r of original) assert.equal(r.migrated_from, undefined, `${r.id} must not carry migrated_from`);
    ok(name);
  } catch (err) { bad(name, err); }
}

function L6_everyRecordHasIdTypeStatement() {
  const name = "L6 every record has non-empty id, type and statement";
  try {
    for (const r of ledger.records) {
      assert.ok(typeof r.id === "string" && r.id.length > 0, `empty id in record ${JSON.stringify(r.id)}`);
      assert.ok(typeof r.type === "string" && r.type.length > 0, `empty type in record ${r.id}`);
      assert.ok(typeof r.statement === "string" && r.statement.length > 0, `empty statement in record ${r.id}`);
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

function L7_topLevelMarkers() {
  const name = "L7 top level has merged_legacy_ledger_at and no ratified_from";
  try {
    assert.equal(ledger.merged_legacy_ledger_at, "2026-09-01", "merged_legacy_ledger_at");
    assert.equal(ledger.ratified_from, undefined, "ratified_from must be absent");
    ok(name);
  } catch (err) { bad(name, err); }
}

function main() {
  console.log("# ops-watcher decision-ledger merge regression tests");
  L1_parsesAndMergeIsIntact();
  L8_postMergeRecordsCarryProvenance();
  if (ledger) {
    L2_idsUnique();
    L3_original15Present();
    L4_migrated24PresentWithProvenance();
    L5_original15NoMigratedFrom();
    L6_everyRecordHasIdTypeStatement();
    L7_topLevelMarkers();
  }
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}
main();