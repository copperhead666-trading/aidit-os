// ops-watcher/learning-os.mjs
// P4 Learning OS / Civil Law Mastery v1 scaffold.
//
// Scope for this file is deliberately narrow:
// - one active topic: civillaw.perikatan.obligations
// - SJAHRIR Schema Option 1: flat topic records with stage percentages
// - SM-2 scheduling for v1 review dates
// - boss-assessment scheduling only, no assessment content/questions
// - no heartbeat wiring and no separate memory system
//
//   node ops-watcher/learning-os.mjs --once

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { retrieveDispatchContext as retrieveDispatchContextReal } from "./ahmad-context-retrieval.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const LEARNING_OS_SCHEMA_VERSION = "0.1.0";
export const TOPIC_ID = "civillaw.perikatan.obligations";
export const STATE_FILE = path.join(__dirname, "learning-os-state.json");
export const SOURCE_SPEC = "handoffs/ahmad/RECOVERED-SPECS-HEALTH-LEARNING-LAWYER-CIVILLAW-2026-08-29.md";
export const REVIEW_ALGORITHM = "sm2";

const VALID_SESSION_STAGES = new Set(["understand", "apply", "produce"]);
const MASTERY_STAGES = ["understand", "apply", "produce", "oral_reasoning", "full_matter_sim"];
const DEFAULT_CONTEXT_TIMEOUT_MS = 5000;
const MIN_EASE_FACTOR = 1.3;
const MAX_EASE_FACTOR = 3.0;
const MIN_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 365;
const DEFAULT_EASE_FACTOR = 2.5;
const BOSS_ASSESSMENT_INTERVAL_DAYS = 14;

function isoNow(now) {
  if (typeof now === "function") return isoNow(now());
  if (now instanceof Date) return now.toISOString();
  if (typeof now === "number") return new Date(now).toISOString();
  if (typeof now === "string" && now.trim()) return now;
  return new Date().toISOString();
}

function parseDateMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : NaN;
}

function addDaysIso(now, days) {
  const ms = parseDateMs(now);
  const base = Number.isFinite(ms) ? ms : Date.now();
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function masteryZero() {
  return {
    understand: 0.0,
    apply: 0.0,
    produce: 0.0,
    oral_reasoning: 0.0,
    full_matter_sim: 0.0,
  };
}

function defaultTopicRecord(now) {
  const at = isoNow(now);
  return {
    id: TOPIC_ID,
    topic: "Perikatan / Obligations",
    domain: "civil_law",
    status: "active",
    mastery: masteryZero(),
    weak_areas: [],
    reviews: {
      algorithm: REVIEW_ALGORITHM,
      last_reviewed_at: null,
      next_review_at: null,
      interval_days: 0,
      ease_factor: DEFAULT_EASE_FACTOR,
      review_count: 0,
    },
    canonical_pointers: [],
    source_material_placeholder: {
      status: "human_required",
      note: "KUHPerdata is in scope. Named textbooks, doctrine authors, cases, and corpus versioning are not decided here.",
    },
    session_log: [],
    provenance: {
      created_by: "learning_os_scheduler",
      created_at: at,
      updated_by: "learning_os_scheduler",
      updated_at: at,
    },
  };
}

export function createDefaultLearningState({ now = "2026-08-30T01:06:00+07:00" } = {}) {
  const at = isoNow(now);
  return {
    schema_version: LEARNING_OS_SCHEMA_VERSION,
    scope: "FounderOS-Aidit Learning OS progress snapshot",
    last_updated_at: at,
    source_spec: SOURCE_SPEC,
    records: [defaultTopicRecord(at)],
    boss_assessment: {
      type: "biweekly_comprehensive_assessment",
      status: "scheduled",
      cadence: "approximately_every_two_weeks",
      interval_days: BOSS_ASSESSMENT_INTERVAL_DAYS,
      scheduled_at: at,
      due_at: addDaysIso(at, BOSS_ASSESSMENT_INTERVAL_DAYS),
      content_status: "not_built_scheduling_only",
    },
  };
}

function normalizeState(raw, now) {
  const base = createDefaultLearningState({ now });
  const state = raw && typeof raw === "object" ? { ...base, ...raw } : base;
  state.records = Array.isArray(state.records) ? state.records : [];
  let topic = state.records.find((r) => r && r.id === TOPIC_ID);
  if (!topic) {
    topic = defaultTopicRecord(now);
    state.records.push(topic);
  }
  topic.mastery = { ...masteryZero(), ...(topic.mastery || {}) };
  for (const stage of MASTERY_STAGES) {
    topic.mastery[stage] = clampNumber(topic.mastery[stage], 0, 1);
  }
  topic.weak_areas = Array.isArray(topic.weak_areas) ? topic.weak_areas : [];
  topic.session_log = Array.isArray(topic.session_log) ? topic.session_log : [];
  topic.reviews = {
    algorithm: REVIEW_ALGORITHM,
    last_reviewed_at: null,
    next_review_at: null,
    interval_days: 0,
    ease_factor: DEFAULT_EASE_FACTOR,
    review_count: 0,
    ...(topic.reviews || {}),
  };
  topic.reviews.ease_factor = clampNumber(topic.reviews.ease_factor, MIN_EASE_FACTOR, MAX_EASE_FACTOR);
  topic.reviews.interval_days = clampNumber(topic.reviews.interval_days, 0, MAX_INTERVAL_DAYS);
  topic.reviews.review_count = Math.max(0, Math.trunc(Number(topic.reviews.review_count) || 0));
  topic.provenance = {
    created_by: "learning_os_scheduler",
    created_at: state.last_updated_at || isoNow(now),
    updated_by: "learning_os_scheduler",
    updated_at: state.last_updated_at || isoNow(now),
    ...(topic.provenance || {}),
  };
  state.boss_assessment = {
    type: "biweekly_comprehensive_assessment",
    status: "unscheduled",
    cadence: "approximately_every_two_weeks",
    interval_days: BOSS_ASSESSMENT_INTERVAL_DAYS,
    scheduled_at: null,
    due_at: null,
    content_status: "not_built_scheduling_only",
    ...(state.boss_assessment || {}),
  };
  return state;
}

export async function readLearningState(deps = {}) {
  const file = deps.stateFile || STATE_FILE;
  const _fs = deps.fs || fs;
  try {
    const raw = await _fs.readFile(file, "utf8");
    return normalizeState(JSON.parse(raw), deps.now);
  } catch (err) {
    if (err && err.code === "ENOENT") return createDefaultLearningState({ now: deps.now });
    const fallback = createDefaultLearningState({ now: deps.now });
    fallback.state_warnings = [{
      source: path.basename(file),
      reason: `state read/parse failed: ${err && err.message ? err.message : err}`,
    }];
    return fallback;
  }
}

export async function writeLearningState(state, deps = {}) {
  const file = deps.stateFile || STATE_FILE;
  const _fs = deps.fs || fs;
  const normalized = normalizeState(state, deps.now);
  await _fs.writeFile(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function findTopic(state, topicId) {
  return state.records.find((r) => r && r.id === topicId);
}

function requireTopic(topic) {
  if (topic !== TOPIC_ID) {
    throw new Error(`Learning OS v1 only supports topic ${TOPIC_ID}`);
  }
}

function resolveMasteryUpdate(current, outcome) {
  const o = outcome && typeof outcome === "object" ? outcome : {};
  const absolute = o.mastery ?? o.mastery_after ?? o.masteryAfter;
  if (Number.isFinite(Number(absolute))) {
    return {
      next: clampNumber(absolute, 0, 1),
      source: "outcome.mastery",
    };
  }
  const delta = o.mastery_delta ?? o.masteryDelta ?? o.delta;
  if (Number.isFinite(Number(delta))) {
    return {
      next: clampNumber(current + Number(delta), 0, 1),
      source: "outcome.mastery_delta",
    };
  }
  return { next: current, source: "none_supplied" };
}

function makeSessionId({ topic, stage, at, count, outcome }) {
  const supplied = outcome && typeof outcome === "object" ? outcome.session_id || outcome.sessionId : null;
  if (supplied) return String(supplied);
  const compactTime = String(at).replace(/[^0-9A-Za-z]/g, "");
  return `${topic}.${stage}.${compactTime}.${count + 1}`;
}

async function boundedRetrieveContext(input, deps) {
  const retrieveContext = deps.retrieveDispatchContext || retrieveDispatchContextReal;
  const timeoutMs = Number.isFinite(deps.contextTimeoutMs) ? deps.contextTimeoutMs : DEFAULT_CONTEXT_TIMEOUT_MS;
  let timer;
  try {
    const retrieval = Promise.resolve().then(() => retrieveContext(input, {
      gbrainHome: deps.gbrainHome || process.env.GBRAIN_HOME || "",
      timeoutMs,
      maxEvidenceUnits: 5,
      maxContextChars: 3500,
    }));
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({
        status: "degraded",
        evidence: [],
        canonical_pointers: [],
        stale_warnings: [],
        conflicts: [],
        excluded_hits: [{
          source: "learning-os-context",
          reason: `context retrieval timed out after ${timeoutMs}ms`,
        }],
      }), timeoutMs);
    });
    return await Promise.race([retrieval, timeout]);
  } catch (err) {
    return {
      status: "degraded",
      evidence: [],
      canonical_pointers: [],
      stale_warnings: [],
      conflicts: [],
      excluded_hits: [{
        source: "learning-os-context",
        reason: err && err.message ? err.message : String(err),
      }],
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function retrieveTopicEvidence({ topic = TOPIC_ID, now } = {}, deps = {}) {
  requireTopic(topic);
  return boundedRetrieveContext({
    issue: {
      identifier: "LEARNING-OS",
      title: "Learning OS topic context",
      description: `Retrieve prior learning evidence for ${topic}`,
      labels: [{ name: "LEARNING_OS" }],
    },
    targetRole: "AHMAD",
    taskKind: "learning-os-topic-context",
    mentionedPaths: [
      "ops-watcher/learning-os.mjs",
      SOURCE_SPEC,
      "knowledge/p4-research/learning-os-algorithm-and-schema-options.md",
    ],
    now,
  }, deps);
}

export async function recordSession({ stage, topic = TOPIC_ID, outcome = {}, now } = {}, deps = {}) {
  requireTopic(topic);
  if (!VALID_SESSION_STAGES.has(stage)) {
    throw new Error(`invalid Learning OS session stage: ${stage}`);
  }
  const at = isoNow(now);
  const state = await readLearningState({ ...deps, now: at });
  const rec = findTopic(state, topic);
  const before = rec.mastery[stage];
  const update = resolveMasteryUpdate(before, outcome);
  rec.mastery[stage] = update.next;
  const context = deps.skipContext ? null : await retrieveTopicEvidence({ topic, now: at }, deps);
  rec.session_log.push({
    id: makeSessionId({ topic, stage, at, count: rec.session_log.length, outcome }),
    topic,
    stage,
    recorded_at: at,
    outcome,
    mastery_before: before,
    mastery_after: update.next,
    mastery_update_source: update.source,
    context_status: context ? context.status || "unknown" : "skipped",
    context_canonical_pointers: Array.isArray(context?.canonical_pointers)
      ? context.canonical_pointers.slice(0, 5)
      : [],
  });
  rec.provenance.updated_by = "learning_os_scheduler";
  rec.provenance.updated_at = at;
  state.last_updated_at = at;
  await writeLearningState(state, { ...deps, now: at });
  return {
    topic,
    stage,
    mastery_before: before,
    mastery_after: update.next,
    mastery_update_source: update.source,
  };
}

export async function detectWeakArea({ topic = TOPIC_ID, skill, subTopic, evidence, now } = {}, deps = {}) {
  requireTopic(topic);
  if (!MASTERY_STAGES.includes(skill)) {
    throw new Error(`invalid Learning OS weak-area skill: ${skill}`);
  }
  if (!subTopic) throw new Error("subTopic is required");
  if (!evidence) throw new Error("evidence is required");
  const at = isoNow(now);
  const state = await readLearningState({ ...deps, now: at });
  const rec = findTopic(state, topic);
  const weakArea = {
    skill,
    sub_topic: String(subTopic),
    detected_at: at,
    evidence: String(evidence),
  };
  rec.weak_areas.push(weakArea);
  rec.provenance.updated_by = "learning_os_scheduler";
  rec.provenance.updated_at = at;
  state.last_updated_at = at;
  await writeLearningState(state, { ...deps, now: at });
  return weakArea;
}

function qualityFromOutcome(lastOutcome) {
  const hasQuality = lastOutcome && Object.hasOwn(lastOutcome, "quality");
  if (hasQuality) {
    if (Number.isFinite(Number(lastOutcome.quality))) {
      return clampNumber(lastOutcome.quality, 0, 5);
    }
    throw new Error("lastOutcome.quality must be a finite number");
  }

  const hasRating = lastOutcome && (
    Object.hasOwn(lastOutcome, "rating") || Object.hasOwn(lastOutcome, "result")
  );
  const rating = String(lastOutcome?.rating || lastOutcome?.result || "").toLowerCase();
  if (rating === "easy") return 5;
  if (rating === "good" || rating === "pass") return 4;
  if (rating === "hard" || rating === "weak") return 3;
  if (rating === "again" || rating === "fail") return 1;
  if (hasRating) throw new Error(`unrecognized Learning OS review rating: ${rating}`);
  throw new Error("lastOutcome.quality or lastOutcome.rating is required");
}

export function computeSm2Review({ previous = {}, quality }) {
  const q = clampNumber(quality, 0, 5);
  const prevEase = clampNumber(previous.ease_factor ?? DEFAULT_EASE_FACTOR, MIN_EASE_FACTOR, MAX_EASE_FACTOR);
  const prevInterval = clampNumber(previous.interval_days ?? 0, 0, MAX_INTERVAL_DAYS);
  const prevCount = Math.max(0, Math.trunc(Number(previous.review_count) || 0));
  const easeDelta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  const easeFactor = clampNumber(prevEase + easeDelta, MIN_EASE_FACTOR, MAX_EASE_FACTOR);
  let intervalDays;
  let reviewCount;

  if (q < 3) {
    intervalDays = MIN_INTERVAL_DAYS;
    reviewCount = 0;
  } else if (prevCount === 0) {
    intervalDays = MIN_INTERVAL_DAYS;
    reviewCount = 1;
  } else if (prevCount === 1) {
    intervalDays = 6;
    reviewCount = 2;
  } else {
    intervalDays = Math.round(Math.max(MIN_INTERVAL_DAYS, prevInterval) * easeFactor);
    reviewCount = prevCount + 1;
  }

  return {
    algorithm: REVIEW_ALGORITHM,
    quality: q,
    interval_days: Math.trunc(clampNumber(intervalDays, MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS)),
    ease_factor: Number(easeFactor.toFixed(2)),
    review_count: reviewCount,
  };
}

export async function scheduleNextReview({ topic = TOPIC_ID, lastOutcome = {}, now } = {}, deps = {}) {
  requireTopic(topic);
  const at = isoNow(now);
  const quality = qualityFromOutcome(lastOutcome);
  const state = await readLearningState({ ...deps, now: at });
  const rec = findTopic(state, topic);
  const next = computeSm2Review({
    previous: rec.reviews,
    quality,
  });
  rec.reviews = {
    ...rec.reviews,
    algorithm: REVIEW_ALGORITHM,
    last_reviewed_at: at,
    next_review_at: addDaysIso(at, next.interval_days),
    interval_days: next.interval_days,
    ease_factor: next.ease_factor,
    review_count: next.review_count,
    last_quality: next.quality,
  };
  rec.provenance.updated_by = "learning_os_scheduler";
  rec.provenance.updated_at = at;
  state.last_updated_at = at;
  await writeLearningState(state, { ...deps, now: at });
  return rec.reviews;
}

export async function scheduleBossAssessment({ now } = {}, deps = {}) {
  const at = isoNow(now);
  const state = await readLearningState({ ...deps, now: at });
  const dueMs = parseDateMs(state.boss_assessment?.due_at);
  const nowMs = parseDateMs(at);
  if (!Number.isFinite(dueMs) || (Number.isFinite(nowMs) && dueMs <= nowMs)) {
    state.boss_assessment = {
      ...state.boss_assessment,
      type: "biweekly_comprehensive_assessment",
      status: "scheduled",
      cadence: "approximately_every_two_weeks",
      interval_days: BOSS_ASSESSMENT_INTERVAL_DAYS,
      scheduled_at: at,
      due_at: addDaysIso(at, BOSS_ASSESSMENT_INTERVAL_DAYS),
      content_status: "not_built_scheduling_only",
    };
    state.last_updated_at = at;
    await writeLearningState(state, { ...deps, now: at });
  }
  return state.boss_assessment;
}

function formatMastery(mastery) {
  return MASTERY_STAGES
    .map((stage) => `${stage}=${Number(mastery[stage] || 0).toFixed(2)}`)
    .join(" ");
}

export async function runLearningOsOnce(deps = {}) {
  const state = await readLearningState(deps);
  const topic = findTopic(state, TOPIC_ID);
  return {
    schema_version: state.schema_version,
    last_updated_at: state.last_updated_at,
    topic: {
      id: topic.id,
      label: topic.topic,
      mastery: topic.mastery,
      weak_area_count: topic.weak_areas.length,
      next_review_at: topic.reviews.next_review_at,
      review_algorithm: topic.reviews.algorithm,
      interval_days: topic.reviews.interval_days,
      ease_factor: topic.reviews.ease_factor,
    },
    boss_assessment: state.boss_assessment,
  };
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
    console.error("usage: node ops-watcher/learning-os.mjs --once");
    process.exit(2);
  }
  const report = await runLearningOsOnce();
  console.log("learning-os --once: state report");
  console.log(`schema=${report.schema_version} last_updated_at=${report.last_updated_at}`);
  console.log(`topic=${report.topic.id} (${report.topic.label})`);
  console.log(`mastery ${formatMastery(report.topic.mastery)}`);
  console.log(`weak_areas=${report.topic.weak_area_count}`);
  console.log(`review algorithm=${report.topic.review_algorithm} interval_days=${report.topic.interval_days} ease_factor=${report.topic.ease_factor} next_review_at=${report.topic.next_review_at || "unscheduled"}`);
  console.log(`boss_assessment status=${report.boss_assessment.status} due_at=${report.boss_assessment.due_at || "unscheduled"} content=${report.boss_assessment.content_status}`);
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
    console.error("learning-os fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
