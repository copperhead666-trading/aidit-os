// ops-watcher/sjahrir-dispatch.regression.test.mjs
// Offline regression coverage for the sjahrir-dispatch kimi stream-json
// surface: buildKimiArgs argv shape and the parseKimiStream parser that turns
// `kimi -p --output-format stream-json` stdout into { turns, cli, text }.
// NO network, NO real kimi spawn — every case exercises the exported pure
// helpers directly. Run with:
//   node ops-watcher/sjahrir-dispatch.regression.test.mjs

import assert from "node:assert/strict";
import { buildKimiArgs, dispatchSjahrir, parseKimiStream } from "./sjahrir-dispatch.mjs";
import { mergeRufloLaneEnv } from "./ruflo-lane-context.mjs";

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  console.log(`PASS: ${name}`);
  passed += 1;
}

function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(`       ${err && err.stack ? err.stack : err}`);
  failures.push(name);
  failed += 1;
}

function run(name, fn) {
  try {
    fn();
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

async function runAsync(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

function makeDispatchDeps(spawnResult, overrides = {}) {
  const calls = [];
  const usage = [];
  const outcomes = [];
  const worktrees = [];
  return {
    calls,
    usage,
    outcomes,
    worktrees,
    spawnSync: (file, args, options) => {
      calls.push({ file, args, options });
      return spawnResult;
    },
    log: () => {},
    guardLaneStart: async () => ({ skip: false }),
    recordLaneOutcome: async (lane, outcome) => { outcomes.push({ lane, outcome }); },
    logLaneUsage: async (record) => { usage.push(record); },
    sourceRepoForPrompt: async () => ({ sourceRepo: null, ventureId: null, reason: "not venture work" }),
    ensureLaneWorktree: (lane, options = {}) => {
      worktrees.push({ lane, options });
      return { path: `D:/tmp/lane-${lane}`, isolated: true, dirty: 0, reason: "test worktree" };
    },
    now: (() => {
      let t = 1000;
      return () => { t += 25; return t; };
    })(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T1: buildKimiArgs puts --output-format stream-json into the argv, and the
// prompt travels as ONE argument — a free-form prompt with spaces / quotes /
// % / & must never be word-split (shell:false passes the array verbatim, so a
// split prompt would reach kimi as broken args).
// ---------------------------------------------------------------------------
run("T1: buildKimiArgs — stream-json in argv, prompt passed as a single argument", () => {
  const prompt = 'Reply with exactly the text "OK & done" 100% sure';
  const argv = buildKimiArgs(prompt);

  assert.ok(Array.isArray(argv), "T1: argv is an array");
  assert.equal(argv.length, 4, `T1: exactly 4 argv elements (got ${argv.length}) — anything more means the prompt was split`);

  const pIdx = argv.indexOf("-p");
  assert.notEqual(pIdx, -1, "T1: '-p' present");
  assert.ok(argv[pIdx + 1].includes(prompt), "T1: original prompt is carried inside the single -p argument");
  assert.ok(argv[pIdx + 1].includes("[RUFLO LANE CONTEXT]"), "T1: SJAHRIR prompt includes compact Ruflo lane context");
  assert.match(argv[pIdx + 1], /must not assume native MCP/i, "T1: Ruflo prelude does not overclaim native MCP");

  const fmtIdx = argv.indexOf("--output-format");
  assert.notEqual(fmtIdx, -1, "T1: '--output-format' present");
  assert.equal(argv[fmtIdx + 1], "stream-json", "T1: '--output-format' is followed by 'stream-json'");

  assert.ok(argv.some((a) => a.includes(prompt)), "T1: the full prompt string is present inside argv");
  assert.ok(argv.every((a) => !a.includes(" ") || a === argv[pIdx + 1]), "T1: no other argv element contains spaces (prompt not fragmented)");
});

run("T1b: mergeRufloLaneEnv preserves explicit caller values", () => {
  const env = mergeRufloLaneEnv({
    CLAUDE_FLOW_MCP_TOOLS: "memory",
    EXISTING: "kept",
  });
  assert.equal(env.CLAUDE_FLOW_MCP_TOOLS, "memory", "explicit caller value wins");
  assert.equal(env.CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS, "1", "native bridge default added");
  assert.equal(env.EXISTING, "kept", "unrelated env is preserved");
});

// ---------------------------------------------------------------------------
// T2: the parser extracts a turn count from a realistic multi-line
// stream-json body. An explicit numeric turn counter on the stream wins over
// counting assistant messages.
// ---------------------------------------------------------------------------
run("T2: parseKimiStream — turn count from a realistic multi-line stream-json body", () => {
  const stream = [
    JSON.stringify({ type: "system", model: "kimi-k3-256k", session_id: "sess-abc-123" }),
    JSON.stringify({ type: "assistant", content: [{ type: "thinking", text: "hmm" }, { type: "text", text: "First answer." }], usage: { input_tokens: 1200, output_tokens: 80 } }),
    JSON.stringify({ type: "assistant", content: [{ type: "text", text: "Second answer." }], usage: { input_tokens: 1500, output_tokens: 120 } }),
    JSON.stringify({ type: "result", turns: 5, model: "kimi-k3-256k", usage: { total_tokens: 2900 } }),
  ].join("\n");

  const r = parseKimiStream(stream);
  assert.equal(r.turns, 5, `T2: explicit turn counter wins over assistant-message count (got ${r.turns})`);
  assert.ok(r.cli && typeof r.cli === "object", "T2: cli detail present");
  assert.equal(r.cli.model, "kimi-k3-256k", "T2: model captured");
  assert.equal(r.cli.session_id, "sess-abc-123", "T2: session_id captured");
  assert.equal(typeof r.cli.usage_input_tokens, "number", "T2: usage scalars flattened into cli");
  assert.equal(typeof r.cli.usage_total_tokens, "number", "T2: result-line usage captured");
  assert.ok(r.text.includes("First answer."), "T2: first assistant text recovered");
  assert.ok(r.text.includes("Second answer."), "T2: second assistant text recovered");
});

// Also: with NO explicit counter, turns falls back to counting assistant
// messages (one assistant message == one model turn).
run("T2b: parseKimiStream — assistant-message fallback when no explicit counter", () => {
  const stream = [
    JSON.stringify({ type: "assistant", content: "one" }),
    JSON.stringify({ type: "assistant", content: "two" }),
    JSON.stringify({ type: "assistant", content: "three" }),
  ].join("\n");
  const r = parseKimiStream(stream);
  assert.equal(r.turns, 3, `T2b: 3 assistant messages -> turns 3 (got ${r.turns})`);
});

// ---------------------------------------------------------------------------
// T3: a malformed or half-written line (truncated JSON, non-JSON noise,
// valid JSON that is not an object) is SKIPPED, never fatal — and the
// surrounding good lines still parse. This is the property that decides
// whether a partially-flushed stream on a 480s-timeout failure still yields
// usable numbers.
// ---------------------------------------------------------------------------
run("T3: parseKimiStream — malformed/half-written lines skipped, good lines still parsed", () => {
  const stream = [
    JSON.stringify({ type: "assistant", content: "before the break" }),
    '{"type":"assistant","content":"truncated half-writ',   // half-written line
    "not json at all",                                       // pure noise
    "[1,2,3]",                                               // valid JSON, not an object
    '"just a string"',                                       // valid JSON, not an object
    "   ",                                                   // blank/whitespace
    JSON.stringify({ type: "assistant", content: "after the break" }),
  ].join("\n");

  let r;
  assert.doesNotThrow(() => { r = parseKimiStream(stream); }, "T3: mixed garbage stream must not throw");
  assert.equal(r.turns, 2, `T3: two good assistant lines parsed around the garbage (got ${r.turns})`);
  assert.equal(r.text, "before the break\nafter the break", "T3: text from both good lines survives");
});

// ---------------------------------------------------------------------------
// T4: a stream with nothing usable returns a COMPLETE record full of nulls —
// { turns: null, cli: null, text: "" } — never a missing/partial one, and a
// gap (null) stays distinguishable from a real zero.
// ---------------------------------------------------------------------------
run("T4: parseKimiStream — unusable stream -> complete null record, gap vs zero distinguishable", () => {
  const expectNulls = { turns: null, cli: null, text: "" };

  assert.deepEqual(parseKimiStream(""), expectNulls, "T4: empty string -> complete null record");
  assert.deepEqual(parseKimiStream("   \n  \n "), expectNulls, "T4: whitespace-only -> complete null record");
  assert.deepEqual(
    parseKimiStream(["garbage", '{"broken', "[1,2,3]", "42"].join("\n")),
    expectNulls,
    "T4: all-garbage stream -> complete null record (never throws, never invents numbers)",
  );
  assert.deepEqual(parseKimiStream(null), expectNulls, "T4: non-string input -> complete null record");

  // Gap vs zero: an explicit counter of 0 is a REPORTED zero, not a gap.
  const zeroTurns = parseKimiStream(JSON.stringify({ type: "result", turns: 0 }));
  assert.equal(zeroTurns.turns, 0, "T4: an explicit turns:0 reports 0, not null");
  assert.notEqual(zeroTurns.turns, null, "T4: zero stays distinguishable from a null gap");

  // cli detail existing must not fabricate turns, and vice versa.
  const usageOnly = parseKimiStream(JSON.stringify({ type: "result", usage: { total_tokens: 10 } }));
  assert.equal(usageOnly.turns, null, "T4: usage without turns still reports turns:null (gap, not zero)");
  assert.ok(usageOnly.cli && usageOnly.cli.usage_total_tokens === 10, "T4: cli detail still captured alongside a turns gap");
});

// ---------------------------------------------------------------------------
// T5: the assistant text is recovered so the wrapper relays something a human
// can read — from BOTH content shapes (plain string, array of typed blocks),
// ignoring non-text blocks, joined with newlines. Nobody should have to read
// raw JSONL out of this lane.
// ---------------------------------------------------------------------------
run("T5: parseKimiStream — assistant text recovered from string and block-array content", () => {
  const stream = [
    JSON.stringify({ role: "assistant", content: "plain-string reply" }),
    JSON.stringify({ type: "assistant", content: [{ type: "thinking", text: "internal monologue must NOT leak as the answer" }, { type: "text", text: "block-array reply" }, { type: "text" }] }),
  ].join("\n");

  const r = parseKimiStream(stream);
  assert.equal(r.text, "plain-string reply\nblock-array reply", `T5: text recovered and joined (got ${JSON.stringify(r.text)})`);
  assert.ok(!r.text.includes("internal monologue"), "T5: non-text blocks are not surfaced as the reply");
});

// ---------------------------------------------------------------------------
// T6: cli detail carries SCALARS only — no nested objects or arrays, because
// lane-usage drops those anyway and a nested blob would make the log
// unreadable. Long strings are dropped too.
// ---------------------------------------------------------------------------
run("T6: parseKimiStream — cli detail is scalars only (no nested objects/arrays)", () => {
  const longString = "x".repeat(600);
  const stream = [
    JSON.stringify({
      type: "result",
      model: "kimi-k2.7",
      sessionId: "sess-alias-1",
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        nested: { deep: "blob" },
        tags: ["a", "b"],
        label: "dropped-because-string",
        ok_flag: true,
      },
    }),
    JSON.stringify({ type: "system", model: longString }),
  ].join("\n");

  const r = parseKimiStream(stream);
  assert.ok(r.cli && typeof r.cli === "object", "T6: cli present");

  for (const [k, v] of Object.entries(r.cli)) {
    const t = typeof v;
    assert.ok(t === "number" || t === "boolean" || t === "string", `T6: cli.${k} is a scalar (${t})`);
    assert.ok(!Array.isArray(v), `T6: cli.${k} is not an array`);
  }

  assert.equal(r.cli.usage_input_tokens, 10, "T6: numeric usage scalar kept");
  assert.equal(r.cli.usage_output_tokens, 20, "T6: numeric usage scalar kept");
  assert.equal(r.cli.usage_ok_flag, true, "T6: boolean usage scalar kept");
  assert.equal(r.cli.usage_nested, undefined, "T6: nested object dropped from usage");
  assert.equal(r.cli.usage_tags, undefined, "T6: array dropped from usage");
  assert.equal(r.cli.usage_label, undefined, "T6: string inside usage dropped (usage is numbers/booleans only)");
  assert.equal(r.cli.session_id, "sess-alias-1", "T6: sessionId alias normalised to session_id");
  assert.equal(r.cli.model, "kimi-k2.7", "T6: short model string kept");
  assert.notEqual(r.cli.model, longString, "T6: >500-char string dropped from cli detail");
});

// ---------------------------------------------------------------------------
// T7: the parser never throws, no matter what shape the stream arrives in —
// a parse failure must not break the dispatch or the usage log.
// ---------------------------------------------------------------------------
run("T7: parseKimiStream — never throws on hostile input", () => {
  for (const hostile of [undefined, 42, {}, ["a"], "{", "\r\n\r\n", '{"type":"assistant","content":'.repeat(500)]) {
    let r;
    assert.doesNotThrow(() => { r = parseKimiStream(hostile); }, `T7: ${String(hostile).slice(0, 30)}... must not throw`);
    assert.ok(r && "turns" in r && "cli" in r && "text" in r, "T7: always returns a complete { turns, cli, text } record");
  }
});

await runAsync("T8: venture prompts pass sourceRepo into ensureLaneWorktree", async () => {
  const sourceRepo = "D:/ventures/caveman-trading-os";
  const deps = makeDispatchDeps({ status: 0, stdout: JSON.stringify({ type: "assistant", content: "ok" }), stderr: "" }, {
    sourceRepoForPrompt: async () => ({
      sourceRepo,
      ventureId: "caveman-trading-os",
      reason: "venture caveman-trading-os repository selected",
    }),
  });
  await dispatchSjahrir("VENTURE_ID: caveman-trading-os\nwork", deps);

  assert.equal(deps.worktrees.length, 1, "one worktree request");
  assert.deepEqual(deps.worktrees[0].options, { sourceRepo });
});

await runAsync("T9: plain prompts do not add a sourceRepo key to worktree options", async () => {
  const deps = makeDispatchDeps({ status: 0, stdout: JSON.stringify({ type: "assistant", content: "ok" }), stderr: "" });
  await dispatchSjahrir("plain Aidit OS work", deps);

  assert.equal(deps.worktrees.length, 1, "one worktree request");
  assert.equal(Object.prototype.hasOwnProperty.call(deps.worktrees[0].options, "sourceRepo"), false);
});

await runAsync("T10: source resolver failure falls back to Aidit OS and still spawns", async () => {
  const deps = makeDispatchDeps({ status: 0, stdout: JSON.stringify({ type: "assistant", content: "ok" }), stderr: "" }, {
    sourceRepoForPrompt: async () => { throw new Error("resolver down"); },
  });
  const result = await dispatchSjahrir("VENTURE_ID: caveman-trading-os\nwork", deps);

  assert.equal(result.ok, true);
  assert.equal(deps.calls.length, 1, "Kimi still spawns");
  assert.equal(deps.calls[0].options.cwd, "D:/tmp/lane-sjahrir");
  assert.equal(Object.prototype.hasOwnProperty.call(deps.worktrees[0].options, "sourceRepo"), false);
});

// ---------------------------------------------------------------------------
console.log("");
if (failed > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  console.log(`sjahrir-dispatch.regression.test.mjs: ${passed} passed, ${failed} FAILED`);
  process.exit(1);
}
console.log(`sjahrir-dispatch.regression.test.mjs: ${passed} passed, 0 failed`);
