// ops-watcher/lane-guard.mjs
// Small dispatch-wrapper guard around routing.mjs lane health state.
// Dependency-injected for offline tests; failures never block real work.

import {
  shouldSkipLane as defaultShouldSkipLane,
  recordFailure as defaultRecordFailure,
  recordQuotaExhausted as defaultRecordQuotaExhausted,
  clearFailure as defaultClearFailure,
  isQuotaFailureText as defaultIsQuotaFailureText,
} from "./routing.mjs";

export const LANE_KEYS = {
  corleone: "codex",
  sjahrir: "kimi",
  hatta: "ollama",
  "hatta-flash": "ollama",
};

function resolveLaneKey(laneName) {
  return LANE_KEYS[laneName] || laneName;
}

function first200(value) {
  return String(value || "").slice(0, 200);
}

function stripPromptText(text, promptText) {
  if (promptText == null) return text;
  const prompt = String(promptText);
  if (prompt === "") return text;
  return String(text).split(prompt).join("");
}

// audit-clerk.mjs#classifyDriftOutput and
// review-runner.mjs#isUnusableReviewerReply are older, task-specific variants
// of this same idea and are deliberately left alone for now.
export function isUnusableModelOutput(text) {
  let trimmed = "";
  try {
    trimmed = text == null ? "" : String(text).trim();
  } catch {
    trimmed = "";
  }
  if (!trimmed) return { unusable: true, reason: "empty output" };
  if (/response truncated due to output length limit/i.test(trimmed)) return { unusable: true, reason: "output truncated" };
  if (/provider\.auth_error|usage limit|insufficient_quota|rate limit exceeded/i.test(trimmed)) return { unusable: true, reason: "lane quota/auth error" };
  if (trimmed.length < 20) return { unusable: true, reason: "output too short" };
  return { unusable: false };
}

export async function guardLaneStart(laneName, deps = {}) {
  const laneKey = resolveLaneKey(laneName);
  try {
    const shouldSkipLane = deps.shouldSkipLane || defaultShouldSkipLane;
    const result = await shouldSkipLane(laneKey, deps);
    return {
      skip: result && result.skip === true,
      reason: result && result.reason != null ? result.reason : null,
      remainingMs: result && Number.isFinite(result.remainingMs) ? result.remainingMs : 0,
      laneKey,
    };
  } catch {
    return { skip: false, reason: null, remainingMs: 0, laneKey };
  }
}

export async function recordLaneOutcome(laneName, result = {}, deps = {}) {
  const laneKey = resolveLaneKey(laneName);
  try {
    // A quota classification is only valid for failed runs. Successful runs may
    // legitimately discuss quota-handling code and must still clear the lane.
    if (result && result.ok === true) {
      const clearFailure = deps.clearFailure || defaultClearFailure;
      await clearFailure(laneKey, deps);
      return { recorded: true, kind: "success", laneKey };
    }

    const stdout = result && result.stdout != null ? String(result.stdout) : "";
    const stderr = result && result.stderr != null ? String(result.stderr) : "";
    const text = `${stdout}\n${stderr}`;
    const textForClassification = stripPromptText(text, result && result.promptText);
    const isQuotaFailureText = deps.isQuotaFailureText || defaultIsQuotaFailureText;
    if (isQuotaFailureText(textForClassification)) {
      const recordQuotaExhausted = deps.recordQuotaExhausted || defaultRecordQuotaExhausted;
      await recordQuotaExhausted(laneKey, first200(text), deps);
      return { recorded: true, kind: "quota", laneKey };
    }

    const recordFailure = deps.recordFailure || defaultRecordFailure;
    await recordFailure(laneKey, first200(text), deps);
    return { recorded: true, kind: "failure", laneKey };
  } catch {
    return { recorded: false, kind: "error", laneKey };
  }
}
