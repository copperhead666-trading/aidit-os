// ops-watcher/specialists.regression.test.mjs
// Offline regression coverage for specialist routing, persona budget, and the
// injected filesystem seams. NO network, NO dispatcher, NO writes. Run with:
//   node ops-watcher/specialists.regression.test.mjs

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAX_SPECIALISTS,
  TASK_CLASS_SPECIALISTS,
  buildSpecialistSection,
  classifyTaskClass,
  loadSpecialist,
  readSkillMatrix,
  resolveSpecialistsForPacket,
  scoreTaskClasses,
} from "./specialists.mjs";

let passed = 0;
let failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(`  ${e && e.stack ? e.stack : e}`);
  failures.push(n);
  failed++;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SPECIALIST_DIR = path.join(ROOT, "agents", "specialists");
const MATRIX_FILE = path.join(ROOT, "config", "skill-matrix.json");

async function readMatrixEntry(taskClass) {
  const matrix = JSON.parse(await fs.readFile(MATRIX_FILE, "utf8"));
  const entry = matrix.find((e) => e && e.taskClass === taskClass);
  assert.ok(entry, `missing skill-matrix entry for ${taskClass}`);
  return entry;
}

async function t1_classificationScoresDistinctKeywordMatches() {
  assert.equal(
    classifyTaskClass("gua pengen bangun dashboard untuk trading os"),
    "frontend-design",
    "T1: the owner's literal dashboard/trading-os request classifies as frontend-design",
  );
  assert.equal(
    classifyTaskClass("tolong bikin dashboard ui layout, risk limit cuma konteks"),
    "frontend-design",
    "T1: multiple frontend keywords beat the earlier single trading-safety match",
  );
  ok("T1: classifyTaskClass scores by distinct keyword count, not first match");
}

async function t2_realSafetyConcernStillWins() {
  assert.equal(
    classifyTaskClass("tambahin risk limit sama max loss"),
    "trading-safety",
    "T2: an actual safety directive classifies as trading-safety",
  );
  ok("T2: trading-safety still wins when the task is really about risk");
}

async function t3_unmatchedAndBlankInputsReturnNull() {
  for (const text of ["hello there", "", "   ", undefined]) {
    assert.equal(classifyTaskClass(text), null, `T3: ${String(text)} classifies to null`);
  }
  ok("T3: classifyTaskClass returns null for unmatched, empty, whitespace, and undefined input");
}

async function t4_scoreTaskClassesListsSortedMatches() {
  const scores = scoreTaskClasses("dashboard ui layout plus api endpoint and risk limit");
  assert.deepEqual(
    scores.map((s) => s.taskClass),
    ["frontend-design", "backend-api", "trading-safety"],
    "T4: matching classes are sorted by match count descending",
  );
  assert.deepEqual(scores[0].matched, ["dashboard", "ui", "layout"], "T4: frontend matched keywords are exact");
  assert.deepEqual(scores[1].matched, ["api", "endpoint"], "T4: backend matched keywords are exact");
  assert.deepEqual(scores[2].matched, ["risk limit"], "T4: trading matched keywords are exact");
  ok("T4: scoreTaskClasses returns sorted matching classes with actual matched keywords");
}

async function t5_defaultMaxSpecialistsLimitsRenderedPersonas() {
  assert.equal(DEFAULT_MAX_SPECIALISTS, 2, "T5: test assumes the production default max is two");
  const slugs = TASK_CLASS_SPECIALISTS["frontend-design"];
  assert.equal(slugs.length, 3, "T5: frontend-design has three registered personas");
  const first = await loadSpecialist(slugs[0]);
  const second = await loadSpecialist(slugs[1]);
  const third = await loadSpecialist(slugs[2]);
  assert.ok(first, `T5: ${slugs[0]} loads`);
  assert.ok(second, `T5: ${slugs[1]} loads`);
  assert.ok(third, `T5: ${slugs[2]} loads`);

  const section = await buildSpecialistSection("frontend-design");
  assert.match(section, new RegExp(`## ${escapeRegExp(first.name)}`), "T5: first persona is rendered");
  assert.match(section, new RegExp(`## ${escapeRegExp(second.name)}`), "T5: second persona is rendered");
  assert.equal(section.includes(`## ${third.name}`), false, "T5: third persona is absent under DEFAULT_MAX_SPECIALISTS");
  ok("T5: buildSpecialistSection respects DEFAULT_MAX_SPECIALISTS");
}

async function t6_everyTaskClassStaysUnderPersonaBudget() {
  const taskClasses = Object.keys(TASK_CLASS_SPECIALISTS);
  assert.equal(taskClasses.length, 9, "T6: the registry contains all nine task classes");
  const budget = 3000;
  for (const taskClass of taskClasses) {
    const section = await buildSpecialistSection(taskClass);
    if (section.length >= budget) {
      assert.fail(`${taskClass} rendered ${section.length} chars, over the under-${budget} budget by ${section.length - (budget - 1)} chars`);
    }
  }
  ok("T6: every registered taskClass renders a specialist section under 3000 chars");
}

async function t7_everyRegisteredSlugResolvesToAFile() {
  for (const [taskClass, slugs] of Object.entries(TASK_CLASS_SPECIALISTS)) {
    for (const slug of slugs) {
      await fs.access(path.join(SPECIALIST_DIR, `${slug}.md`));
      assert.ok(await loadSpecialist(slug), `T7: ${taskClass}/${slug} loads as a specialist`);
    }
  }
  ok("T7: every TASK_CLASS_SPECIALISTS slug resolves to agents/specialists");
}

async function t8_missingAndUnknownSpecialistsAreEmpty() {
  assert.equal(await loadSpecialist("no-such-specialist-for-regression"), null, "T8: missing slug returns null");
  assert.equal(await buildSpecialistSection("no-such-task-class"), "", "T8: unknown taskClass renders an empty string");
  assert.equal(await buildSpecialistSection(null), "", "T8: null taskClass renders an empty string");
  ok("T8: missing slugs and unknown task classes fail closed");
}

async function t9_resolveCarriesSkillMatrixFields() {
  const expected = await readMatrixEntry("frontend-design");
  const resolved = await resolveSpecialistsForPacket("dashboard ui layout");

  assert.equal(resolved.taskClass, "frontend-design", "T9: frontend fixture classifies as frontend-design");
  assert.deepEqual(resolved.hardStops, expected.hardStops, "T9: hardStops come from skill-matrix");
  assert.deepEqual(resolved.requiredStandards, expected.requiredStandards, "T9: requiredStandards come from skill-matrix");
  assert.deepEqual(resolved.requiredSkills, expected.requiredSkills, "T9: requiredSkills come from skill-matrix");

  const unclassified = await resolveSpecialistsForPacket("hello there");
  assert.equal(unclassified.taskClass, null, "T9: unmatched task remains unclassified");
  assert.deepEqual(unclassified.hardStops, [], "T9: unclassified hardStops are empty");
  assert.deepEqual(unclassified.requiredStandards, [], "T9: unclassified requiredStandards are empty");
  assert.deepEqual(unclassified.requiredSkills, [], "T9: unclassified requiredSkills are empty");
  ok("T9: resolveSpecialistsForPacket carries matrix constraints and leaves unclassified tasks empty");
}

async function t10_injectedFsRunsOffline() {
  const fakeMatrix = [
    {
      taskClass: "frontend-design",
      requiredSkills: ["fake-ui-skill"],
      requiredStandards: ["fake-standard.md"],
      hardStops: ["fake hard stop"],
    },
  ];
  const reads = [];
  const fakeFs = {
    async readFile(file) {
      reads.push(String(file));
      if (String(file).endsWith("skill-matrix.json")) return JSON.stringify(fakeMatrix);
      const slug = path.basename(String(file), ".md");
      if (TASK_CLASS_SPECIALISTS["frontend-design"].includes(slug)) {
        return [
          "---",
          `name: Fake ${slug}`,
          "description: fake offline persona",
          "---",
          "",
          "## Critical Rules",
          `Only ${slug} may appear in this fake filesystem.`,
        ].join("\n");
      }
      throw new Error(`fake fs has no file for ${file}`);
    },
  };

  const directMatrix = await readSkillMatrix({ _fs: fakeFs, matrixFile: "offline/skill-matrix.json" });
  assert.deepEqual(directMatrix, fakeMatrix, "T10: readSkillMatrix uses injected _fs and matrixFile");

  const directSpecialist = await loadSpecialist("design-ui-designer", {
    _fs: fakeFs,
    dir: "offline/specialists",
  });
  assert.equal(directSpecialist.name, "Fake design-ui-designer", "T10: loadSpecialist uses injected _fs and dir");

  const resolved = await resolveSpecialistsForPacket("dashboard ui layout", {
    _fs: fakeFs,
    dir: "offline/specialists",
    matrixFile: "offline/skill-matrix.json",
  });
  assert.equal(resolved.taskClass, "frontend-design", "T10: fake offline packet still classifies");
  assert.deepEqual(resolved.requiredSkills, ["fake-ui-skill"], "T10: fake matrix values flow through resolve");
  assert.match(resolved.section, /Fake design-ui-designer/, "T10: fake specialist file renders through resolve");
  assert.ok(reads.every((file) => file.includes("offline")), "T10: every read was served from the offline override paths");
  ok("T10: loadSpecialist and readSkillMatrix seams run fully offline through fake fs");
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const tests = [
    t1_classificationScoresDistinctKeywordMatches,
    t2_realSafetyConcernStillWins,
    t3_unmatchedAndBlankInputsReturnNull,
    t4_scoreTaskClassesListsSortedMatches,
    t5_defaultMaxSpecialistsLimitsRenderedPersonas,
    t6_everyTaskClassStaysUnderPersonaBudget,
    t7_everyRegisteredSlugResolvesToAFile,
    t8_missingAndUnknownSpecialistsAreEmpty,
    t9_resolveCarriesSkillMatrixFields,
    t10_injectedFsRunsOffline,
  ];
  for (const t of tests) {
    try {
      await t();
    } catch (e) {
      bad(t.name, e);
    }
  }
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("regression runner crashed:", e);
  process.exit(1);
});
