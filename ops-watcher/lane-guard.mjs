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
  // SOEKARNO is Claude Code on the Lenovo, reached over SSH. It gets its own
  // probe key rather than sharing one: a lane on another machine can be down
  // for reasons that have nothing to do with any lane on this one.
  soekarno: "claude",
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

    // A run that hit the wrapper TIMEOUT (result.timedOut === true) must NEVER
    // be classified as quota-exhausted, even when its captured output happens to
    // contain a quota-shaped phrase. The reasoning is structural: a genuine
    // quota rejection returns immediately — a provider that is out of quota does
    // not think for eight minutes first. So a timed-out run is, by construction,
    // not evidence of exhausted quota. The quota phrase in the transcript is
    // usually the CLI echoing the prompt back (which may itself mention
    // quota-handling code or its test fixtures); stripPromptText only removes
    // the prompt we know about, not the CLI's echoed copy. Treating a timeout as
    // a quota event would park a perfectly good lane for the full quota cooldown
    // — six hours lost per false flag. Instead record it as an ordinary failure
    // (short exponential backoff) so the lane retries quickly.
    const timedOut = result && result.timedOut === true;
    if (!timedOut && isQuotaFailureText(textForClassification)) {
      const recordQuotaExhausted = deps.recordQuotaExhausted || defaultRecordQuotaExhausted;
      // Pass the FULL text, not first200(). The provider states its reset time
      // at the end of the transcript ("...or try again at 9:03 AM."), and
      // recordQuotaExhausted parses that to size the cooldown before it stores a
      // bounded excerpt. Truncating here threw the hint away and parked the lane
      // for the flat 6h quota cooldown instead of the ~45 minutes it needed.
      await recordQuotaExhausted(laneKey, text, deps);
      return { recorded: true, kind: "quota", laneKey };
    }

    const recordFailure = deps.recordFailure || defaultRecordFailure;
    await recordFailure(laneKey, first200(text), deps);
    return { recorded: true, kind: "failure", laneKey };
  } catch {
    return { recorded: false, kind: "error", laneKey };
  }
}