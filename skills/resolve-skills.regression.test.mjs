// skills/resolve-skills.regression.test.mjs
// Offline regression tests for skills/resolve-skills.mjs.
// Pure: reads the real handoffs/sjahrir/skill-index.json + a tiny in-memory
// fixture index; NO network, NO Paperclip, NO Telegram, NO filesystem writes.
// Uses node:assert/strict only — the same convention as every other
// *.regression.test.mjs in this repo (there is no package.json / npm here;
// run directly: `node skills/resolve-skills.regression.test.mjs`).
//
// Covers:
//   (R1) a role with only core skills and a taskKind that matches NO trigger
//        returns just its core array, taskSpecific empty.
//   (R2) a taskKind matching a real trigger returns that task-specific entry
//        ONLY for applicable roles and NOT for a role not in applicableRoles.
//   (R3) an unknown role returns an empty core array without throwing.
//   (R4) formatSkillsSection produces the documented Section-5 block shape.
//   (R5) substring trigger matching: "telegram-bot-integration" matches the
//        trigger token "telegram-bot" (coarse label still resolves).
//   (R6) matchedTrigger is reported and is one of the entry's actual triggers.
//   (R7) verifySkillFilesExist finds a content file for every resolved core
//        skill against the real skills/ directory (every core skill has a .md).
//   (R8) the real on-disk index resolves HATTA + "telegram-bot-integration" the
//        same way the fixture does, and a non-applicable role gets only its core.

import assert from "node:assert/strict";
import {
  resolveSkillsForPacket,
  formatSkillsSection,
  verifySkillFilesExist,
  loadSkillIndex,
} from "./resolve-skills.mjs";

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(String(e && e.stack ? e.stack : e).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(n); failed++;
};

// A tiny in-memory fixture mirroring the real schema shape (used by R1/R2/R5/R6
// so the role-membership + matching logic is proven independently of the live
// index contents). Hyphenated role ids are quoted (they are not valid bare keys).
const FIXTURE = {
  mandatoryCore: {
    HATTA: [
      { name: "debugging", description: "d1" },
      { name: "TDD", description: "d2" },
      { name: "verification", description: "d3" },
    ],
    "STEWARD-CAVEMAN": [
      { name: "caveman-watch", description: "caveman" },
    ],
    "AUDIT-CLERK": [
      { name: "consistency-audit", description: "audit" },
    ],
  },
  taskSpecific: [
    {
      name: "telegram-bot-integration",
      description: "tg hint",
      triggers: ["telegram-bot", "telegram-gateway", "telegram-integration"],
      applicableRoles: ["AHMAD", "HATTA", "GIBRAN"],
    },
    {
      name: "trading-quant-analysis",
      description: "quant hint",
      triggers: ["trading-quant", "quant-analysis"],
      applicableRoles: ["TRADING-QUANT", "AHMAD"],
    },
  ],
};

// (R1) role with only core skills, no matching trigger -> just core.
function testR1CoreOnlyNoTrigger() {
  const name = "R1 role w/ only core + no matching trigger returns just core";
  try {
    // AUDIT-CLERK has one core skill; "some-unrelated-task" matches no trigger.
    const r = resolveSkillsForPacket("AUDIT-CLERK", "some-unrelated-task", { index: FIXTURE });
    assert.ok(Array.isArray(r.core), "core is an array");
    assert.equal(r.core.length, 1, "AUDIT-CLERK has exactly one core skill");
    assert.equal(r.core[0].name, "consistency-audit");
    assert.equal(r.core[0].description, "audit");
    assert.ok(Array.isArray(r.taskSpecific), "taskSpecific is an array");
    assert.equal(r.taskSpecific.length, 0, "no task-specific match for unrelated task");
    // Returned objects are copies, not the index's own references.
    r.core[0].name = "MUTATED";
    const r2 = resolveSkillsForPacket("AUDIT-CLERK", "some-unrelated-task", { index: FIXTURE });
    assert.equal(r2.core[0].name, "consistency-audit", "mutation of a returned copy did not leak into the index");
    ok(name);
  } catch (e) { bad(name, e); }
}

// (R2) a matching taskKind returns the entry only for applicable roles, not for
//      a role absent from applicableRoles. Same taskKind, two roles.
function testR2ApplicableRolesGate() {
  const name = "R2 matching taskKind returns task-specific entry for applicable roles only";
  try {
    const taskKind = "telegram-bot-integration"; // contains trigger "telegram-bot"
    const hatta = resolveSkillsForPacket("HATTA", taskKind, { index: FIXTURE });
    const caveman = resolveSkillsForPacket("STEWARD-CAVEMAN", taskKind, { index: FIXTURE });
    // HATTA is in applicableRoles -> gets the entry.
    assert.equal(hatta.core.length, 3, "HATTA core = 3");
    assert.equal(hatta.taskSpecific.length, 1, "HATTA gets the telegram hint");
    assert.equal(hatta.taskSpecific[0].name, "telegram-bot-integration");
    // STEWARD-CAVEMAN is NOT in applicableRoles -> does NOT get it (core only).
    assert.equal(caveman.core.length, 1, "STEWARD-CAVEMAN core = 1");
    assert.equal(caveman.core[0].name, "caveman-watch");
    assert.equal(caveman.taskSpecific.length, 0, "STEWARD-CAVEMAN does NOT get the telegram hint (not in applicableRoles)");
    ok(name);
  } catch (e) { bad(name, e); }
}

// (R3) unknown role -> empty core, no throw.
function testR3UnknownRole() {
  const name = "R3 unknown role returns empty core without throwing";
  try {
    const r = resolveSkillsForPacket("NOBODY-HERE", "telegram-bot-integration", { index: FIXTURE });
    assert.ok(Array.isArray(r.core));
    assert.equal(r.core.length, 0, "unknown role -> empty core");
    assert.ok(Array.isArray(r.taskSpecific));
    assert.equal(r.taskSpecific.length, 0, "unknown role -> no task-specific either (not in any applicableRoles)");
    // Also confirm no throw on nullish index pieces.
    const r2 = resolveSkillsForPacket("X", "", { index: { mandatoryCore: {}, taskSpecific: [] } });
    assert.equal(r2.core.length, 0);
    assert.equal(r2.taskSpecific.length, 0);
    ok(name);
  } catch (e) { bad(name, e); }
}

// (R4) formatSkillsSection produces the documented Section-5 shape.
function testR4FormatShape() {
  const name = "R4 formatSkillsSection produces the documented section shape";
  try {
    const r = resolveSkillsForPacket("HATTA", "telegram-bot-integration", { index: FIXTURE });
    const block = formatSkillsSection(r);
    const lines = block.split("\n");
    assert.equal(lines[0], "### Loaded skills", "first line is the section header");
    assert.equal(lines[1], "", "blank line after header");
    assert.equal(lines[2], "Core (always active for this role):", "core subsection header");
    // Bullet lines: 3 core + 1 task-specific = 4 "- " lines.
    const coreLines = lines.filter((l) => l.startsWith("- "));
    assert.equal(coreLines.length, 4, "3 core + 1 task-specific bullet");
    // Each core bullet matches "- <name>: <description>".
    for (const cl of coreLines.slice(0, 3)) {
      assert.match(cl, /^- [a-zA-Z0-9_-]+: .+/, "core bullet is '- name: description'");
    }
    // The task-specific header is present and its bullet carries the trigger.
    assert.ok(block.includes("Task-specific (available if needed — load if the task touches the trigger area):"), "task-specific subsection header present");
    assert.ok(block.includes("— trigger: "), "task-specific bullet carries '— trigger:'");
    assert.ok(block.includes("telegram-bot-integration: tg hint"), "task-specific bullet names the entry");
    // Empty-core shape: "(no mandatory core skills for this role)".
    const empty = formatSkillsSection({ core: [], taskSpecific: [] });
    assert.ok(empty.includes("- (no mandatory core skills for this role)"), "empty core renders a placeholder bullet");
    assert.ok(empty.includes("- (none matched for this task)"), "empty task-specific renders a placeholder bullet");
    ok(name);
  } catch (e) { bad(name, e); }
}

// (R5) substring matching: coarse taskKind "telegram-bot-integration" matches
//      trigger token "telegram-bot" (not just exact equality).
function testR5SubstringMatch() {
  const name = "R5 coarse taskKind matches a trigger token via substring";
  try {
    // Exact trigger keyword also resolves.
    const exact = resolveSkillsForPacket("HATTA", "telegram-bot", { index: FIXTURE });
    assert.equal(exact.taskSpecific.length, 1, "exact trigger keyword matches");
    // Coarse taskKind containing the trigger token also resolves.
    const coarse = resolveSkillsForPacket("HATTA", "telegram-bot-integration", { index: FIXTURE });
    assert.equal(coarse.taskSpecific.length, 1, "coarse taskKind containing the trigger matches");
    assert.equal(coarse.taskSpecific[0].name, "telegram-bot-integration");
    // A taskKind that merely shares a prefix word but no trigger substring does NOT match.
    const nope = resolveSkillsForPacket("HATTA", "telegram-channel-cleanup", { index: FIXTURE });
    assert.equal(nope.taskSpecific.length, 0, "taskKind with no trigger substring does NOT match");
    ok(name);
  } catch (e) { bad(name, e); }
}

// (R6) matchedTrigger is reported and is one of the entry's actual triggers.
function testR6MatchedTriggerIsReal() {
  const name = "R6 matchedTrigger is one of the entry's real triggers";
  try {
    const r = resolveSkillsForPacket("HATTA", "telegram-bot-integration", { index: FIXTURE });
    const ts = r.taskSpecific[0];
    assert.ok(ts.matchedTrigger, "matchedTrigger is set");
    assert.ok(ts.triggers.includes(ts.matchedTrigger), "matchedTrigger is a member of triggers");
    // For "telegram-bot-integration" the first matching trigger is "telegram-bot".
    assert.equal(ts.matchedTrigger, "telegram-bot", "first matching trigger wins");
    ok(name);
  } catch (e) { bad(name, e); }
}

// (R7) against the REAL skills/ dir + REAL index: every resolved core skill has
//      a content file. (Proves the bootstrap content was actually written.)
function testR7RealSkillFilesExist() {
  const name = "R7 every real-index resolved core skill has a skills/*.md content file";
  try {
    const realIndex = loadSkillIndex();
    const allRoles = Object.keys(realIndex.mandatoryCore);
    assert.ok(allRoles.length >= 16, "real index covers all canonical roles");
    let totalCore = 0;
    for (const role of allRoles) {
      const r = resolveSkillsForPacket(role, "no-trigger", { index: realIndex });
      const { missingCore } = verifySkillFilesExist(r);
      assert.equal(missingCore.length, 0, `${role}: all core skills have a .md file (missing: ${missingCore.join(",")})`);
      totalCore += r.core.length;
    }
    assert.ok(totalCore >= 16, `at least 16 core skills total across roles (got ${totalCore})`);
    ok(name);
  } catch (e) { bad(name, e); }
}

// (R8) the real on-disk index resolves HATTA + "telegram-bot-integration" the
//      same way the fixture does (3 core + 1 task-specific), and STEWARD-CAVEMAN
//      on the SAME taskKind gets only its single core skill (no injected library).
function testR8RealIndexEndToEnd() {
  const name = "R8 real index: HATTA+telegram -> 3 core + hint; STEWARD-CAVEMAN+same task -> 1 core only";
  try {
    const realIndex = loadSkillIndex();
    const hatta = resolveSkillsForPacket("HATTA", "telegram-bot-integration", { index: realIndex });
    assert.equal(hatta.core.length, 3, "HATTA has 3 core skills in the real index");
    const coreNames = hatta.core.map((s) => s.name).sort();
    assert.deepEqual(coreNames, ["TDD", "debugging", "verification"].sort(), "HATTA core names match the design");
    assert.equal(hatta.taskSpecific.length, 1, "HATTA gets the telegram-bot-integration hint");
    assert.equal(hatta.taskSpecific[0].name, "telegram-bot-integration");

    const caveman = resolveSkillsForPacket("STEWARD-CAVEMAN", "telegram-bot-integration", { index: realIndex });
    assert.equal(caveman.core.length, 1, "STEWARD-CAVEMAN has 1 core skill");
    assert.equal(caveman.core[0].name, "caveman-watch");
    assert.equal(caveman.taskSpecific.length, 0, "STEWARD-CAVEMAN gets NO task-specific hint for the same task (not in applicableRoles)");
    ok(name);
  } catch (e) { bad(name, e); }
}

function main() {
  console.log("# skills/resolve-skills.mjs regression tests");
  testR1CoreOnlyNoTrigger();
  testR2ApplicableRolesGate();
  testR3UnknownRole();
  testR4FormatShape();
  testR5SubstringMatch();
  testR6MatchedTriggerIsReal();
  testR7RealSkillFilesExist();
  testR8RealIndexEndToEnd();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}
main();