// ops-watcher/learning-os.regression.test.mjs
// Offline regression tests for the P4 Learning OS scaffold.
// Uses a temp state path only; never touches ops-watcher/learning-os-state.json.
//
//   node ops-watcher/learning-os.regression.test.mjs

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOPIC_ID,
  computeSm2Review,
  createDefaultLearningState,
  detectWeakArea,
  readLearningState,
  recordSession,
  runLearningOsOnce,
  scheduleBossAssessment,
  scheduleNextReview,
  writeLearningState,
} from "./learning-os.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_STATE = path.join(__dirname, "learning-os.regression.state.tmp.json");

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };
const cleanup = () => fs.unlink(TMP_STATE).catch(() => {});

const contextOk = async () => ({
  status: "ok",
  evidence: [],
  canonical_pointers: ["knowledge/p4-research/learning-os-algorithm-and-schema-options.md"],
  stale_warnings: [],
  conflicts: [],
  excluded_hits: [],
});

function deps(overrides = {}) {
  return {
    stateFile: TMP_STATE,
    retrieveDispatchContext: contextOk,
    contextTimeoutMs: 50,
    ...overrides,
  };
}

async function t1_recordSessionUpdatesStageMastery() {
  await cleanup();
  const r = await recordSession({
    topic: TOPIC_ID,
    stage: "understand",
    outcome: { session_id: "s-understand-1", mastery_delta: 0.2, evidence: "fixture quiz" },
    now: "2026-08-30T02:00:00.000Z",
  }, deps());
  assert.equal(r.mastery_before, 0);
  assert.equal(r.mastery_after, 0.2);

  const state = await readLearningState(deps());
  const topic = state.records[0];
  assert.equal(topic.mastery.understand, 0.2);
  assert.equal(topic.mastery.apply, 0);
  assert.equal(topic.session_log.length, 1);
  assert.equal(topic.session_log[0].id, "s-understand-1");
  assert.equal(topic.session_log[0].context_status, "ok");
  assert.deepEqual(topic.session_log[0].context_canonical_pointers, [
    "knowledge/p4-research/learning-os-algorithm-and-schema-options.md",
  ]);
  ok("T1: recordSession updates only the requested stage mastery and logs context");
}

async function t2_recordSessionClampsAbsoluteMastery() {
  await cleanup();
  await recordSession({
    topic: TOPIC_ID,
    stage: "produce",
    outcome: { mastery: 1.4 },
    now: "2026-08-30T03:00:00.000Z",
  }, deps({ skipContext: true }));
  const state = await readLearningState(deps());
  assert.equal(state.records[0].mastery.produce, 1);
  assert.equal(state.records[0].session_log[0].mastery_update_source, "outcome.mastery");
  assert.equal(state.records[0].session_log[0].context_status, "skipped");
  ok("T2: absolute mastery inputs are clamped to 0.0-1.0 without a rubric threshold");
}

async function t3_detectWeakAreaShape() {
  await cleanup();
  const weak = await detectWeakArea({
    topic: TOPIC_ID,
    skill: "apply",
    subTopic: "elements_of_obligation",
    evidence: "case_analysis_2026-08-30_perikatan_01",
    now: "2026-08-30T04:00:00.000Z",
  }, deps());
  assert.deepEqual(weak, {
    skill: "apply",
    sub_topic: "elements_of_obligation",
    detected_at: "2026-08-30T04:00:00.000Z",
    evidence: "case_analysis_2026-08-30_perikatan_01",
  });
  const state = await readLearningState(deps());
  assert.deepEqual(state.records[0].weak_areas, [weak]);
  ok("T3: detectWeakArea appends SJAHRIR Option 1 weak_areas shape exactly");
}

async function t4_detectWeakAreaPreservesSuppliedSkill() {
  await cleanup();
  const weak = await detectWeakArea({
    topic: TOPIC_ID,
    skill: "understand",
    subTopic: "sources_of_obligation",
    evidence: "understand_drill_2026-08-30_sources",
    now: "2026-08-30T04:30:00.000Z",
  }, deps());
  assert.equal(weak.skill, "understand");

  const state = await readLearningState(deps());
  assert.equal(state.records[0].weak_areas[0].skill, "understand");
  ok("T4: detectWeakArea records the actual supplied weak-area skill");
}

async function t5_reviewSchedulingHappyPathAndEdges() {
  await cleanup();
  let review = await scheduleNextReview({
    topic: TOPIC_ID,
    lastOutcome: { quality: 4 },
    now: "2026-08-30T05:00:00.000Z",
  }, deps());
  assert.equal(review.algorithm, "sm2");
  assert.equal(review.interval_days, 1);
  assert.equal(review.ease_factor, 2.5);
  assert.equal(review.review_count, 1);
  assert.equal(review.next_review_at, "2026-08-31T05:00:00.000Z");

  review = await scheduleNextReview({
    topic: TOPIC_ID,
    lastOutcome: { rating: "easy" },
    now: "2026-08-31T05:00:00.000Z",
  }, deps());
  assert.equal(review.interval_days, 6);
  assert.equal(review.ease_factor, 2.6);
  assert.equal(review.review_count, 2);

  const minimum = computeSm2Review({
    previous: { interval_days: 90, ease_factor: 3.9, review_count: 6 },
    quality: 1,
  });
  assert.equal(minimum.interval_days, 1);
  assert.equal(minimum.ease_factor, 2.46);
  assert.equal(minimum.review_count, 0);

  const capped = computeSm2Review({
    previous: { interval_days: 200, ease_factor: 3, review_count: 8 },
    quality: 5,
  });
  assert.equal(capped.ease_factor, 3);
  assert.equal(capped.interval_days, 365);
  ok("T5: SM-2 scheduler gives sane dates, minimum reset, and max interval/ease caps");
}

async function t6_scheduleNextReviewRefusesMissingOutcomeQuality() {
  await cleanup();
  const before = await readLearningState(deps());
  await assert.rejects(
    () => scheduleNextReview({
      topic: TOPIC_ID,
      lastOutcome: {},
      now: "2026-08-30T05:30:00.000Z",
    }, deps()),
    /lastOutcome.quality or lastOutcome.rating is required/,
  );

  const after = await readLearningState(deps());
  assert.deepEqual(after.records[0].reviews, before.records[0].reviews);
  assert.equal(after.records[0].reviews.last_quality, undefined);
  ok("T6: scheduleNextReview refuses to invent review quality from an empty outcome");
}

async function t7_bossAssessmentScheduling() {
  await cleanup();
  const scheduled = await scheduleBossAssessment({
    now: "2026-08-30T06:00:00.000Z",
  }, deps());
  assert.equal(scheduled.status, "scheduled");
  assert.equal(scheduled.interval_days, 14);
  assert.equal(scheduled.due_at, "2026-09-13T06:00:00.000Z");

  const state = await readLearningState(deps());
  state.boss_assessment.due_at = "2026-08-29T06:00:00.000Z";
  await writeLearningState(state, deps());
  const rescheduled = await scheduleBossAssessment({
    now: "2026-08-30T06:00:00.000Z",
  }, deps());
  assert.equal(rescheduled.due_at, "2026-09-13T06:00:00.000Z");
  assert.equal(rescheduled.content_status, "not_built_scheduling_only");
  ok("T7: boss assessment tracks a biweekly due_at and only reschedules when due/missing");
}

async function t8_stateRoundTripAndCliReport() {
  await cleanup();
  const state = createDefaultLearningState({ now: "2026-08-30T07:00:00.000Z" });
  state.records[0].mastery.apply = 0.33;
  await writeLearningState(state, deps());
  const readBack = await readLearningState(deps());
  assert.deepEqual(readBack, state);

  const report = await runLearningOsOnce(deps());
  assert.equal(report.topic.id, TOPIC_ID);
  assert.equal(report.topic.mastery.apply, 0.33);
  assert.equal(report.boss_assessment.content_status, "not_built_scheduling_only");
  ok("T8: state file round-trips and --once report is read-only over the injected state");
}

async function main() {
  const tests = [
    t1_recordSessionUpdatesStageMastery,
    t2_recordSessionClampsAbsoluteMastery,
    t3_detectWeakAreaShape,
    t4_detectWeakAreaPreservesSuppliedSkill,
    t5_reviewSchedulingHappyPathAndEdges,
    t6_scheduleNextReviewRefusesMissingOutcomeQuality,
    t7_bossAssessmentScheduling,
    t8_stateRoundTripAndCliReport,
  ];
  try {
    for (const t of tests) await t();
    console.log(`\nlearning-os.regression.test.mjs: ${pass}/${tests.length} passed`);
    if (pass !== tests.length) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async (err) => {
  await cleanup();
  console.error("learning-os regression runner crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
