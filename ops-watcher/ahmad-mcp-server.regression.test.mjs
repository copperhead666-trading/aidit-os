// ops-watcher/ahmad-mcp-server.regression.test.mjs
// Offline regression coverage for the AHMAD MCP allowlist server. NO real MCP
// protocol handshake over real stdio, NO real child process spawn — run is
// injected everywhere a real spawn would happen. Run with:
//   node ops-watcher/ahmad-mcp-server.regression.test.mjs

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateRunCommand,
  handleRunCommand,
  makeServer,
  ALLOWED_SCRIPTS,
} from "./ahmad-mcp-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };

async function t1_allowsRealAllowedScript() {
  const v = await validateRunCommand({ exe: "node", args: ["ops-watcher/review-runner.mjs", "--once"] });
  assert.equal(v.ok, true, "T1: real allowlisted script + --once must validate");
  ok("T1: allows node ops-watcher/review-runner.mjs --once");
}

async function t2_deniesNonNodeExe() {
  const v = await validateRunCommand({ exe: "bash", args: ["ops-watcher/review-runner.mjs"] });
  assert.equal(v.ok, false, "T2: exe other than node must be denied");
  ok("T2: denies exe=bash");
}

async function t3_deniesUnlistedScript() {
  const v = await validateRunCommand({ exe: "node", args: ["ops-watcher/watcher.mjs", "--once"] });
  assert.equal(v.ok, false, "T3: script not in ALLOWED_SCRIPTS must be denied");
  assert.ok(!ALLOWED_SCRIPTS.includes("ops-watcher/watcher.mjs"), "T3 precondition: watcher.mjs not on the AHMAD allowlist");
  ok("T3: denies non-allowlisted script ops-watcher/watcher.mjs");
}

async function t4_deniesEvalFlagAsFirstArg() {
  const v = await validateRunCommand({ exe: "node", args: ["-e", "require('fs').rmSync('/', {recursive:true})"] });
  assert.equal(v.ok, false, "T4: -e as the first arg (no real script) must be denied");
  ok("T4: denies node -e ... (no script path)");
}

async function t5_deniesUnknownFlagAfterScript() {
  const v = await validateRunCommand({ exe: "node", args: ["hatta/harness.mjs", "--eval", "evil"] });
  assert.equal(v.ok, false, "T5: an unlisted -flag after the script must be denied even though the script itself is allowed");
  ok("T5: denies node hatta/harness.mjs --eval ... (unlisted flag)");
}

async function t6_allowsFreeformPromptTextAfterScript() {
  const v = await validateRunCommand({ exe: "node", args: ["hatta/harness.mjs", "List the files in ops-watcher/ and summarize them."] });
  assert.equal(v.ok, true, "T6: free-form prompt text (not starting with '-') after an allowed script must be allowed");
  ok("T6: allows node hatta/harness.mjs \"<free-form prompt>\"");
}

async function t7_deniesPathEscape() {
  const v = await validateRunCommand({ exe: "node", args: ["../../evil.mjs"] });
  assert.equal(v.ok, false, "T7: a script path outside ALLOWED_SCRIPTS (and escaping the root) must be denied");
  ok("T7: denies ../../evil.mjs");
}

async function t8_deniesMissingScriptOnDisk() {
  // hatta/harness.mjs is on the allowlist AND exists; construct a case where
  // the allowlist string itself doesn't correspond to a real file by using a
  // path that isn't literally in ALLOWED_SCRIPTS (covered by T3) — this test
  // instead confirms the exists-on-disk check runs (defense in depth) by
  // asserting the real ALLOWED_SCRIPTS entries all resolve to real files.
  for (const rel of ALLOWED_SCRIPTS) {
    const v = await validateRunCommand({ exe: "node", args: [rel] });
    assert.equal(v.ok, true, `T8: allowlisted script ${rel} must exist on disk and validate`);
  }
  ok("T8: every ALLOWED_SCRIPTS entry exists on disk and validates");
}

async function t9_handleRunCommandDeniedNeverInvokesRun() {
  let invoked = false;
  const res = await handleRunCommand({ args: ["ops-watcher/watcher.mjs"] }, { run: async () => { invoked = true; return { code: 0, stdout: "", stderr: "" }; } });
  assert.equal(invoked, false, "T9: run() must never be called for a denied command");
  assert.equal(res.isError, true, "T9: denied result must set isError");
  assert.ok(/DENIED/.test(res.content[0].text), "T9: denied result text starts with DENIED");
  ok("T9: handleRunCommand short-circuits before spawning on a denied command");
}

async function t10_handleRunCommandAllowedInvokesRunWithExactArgv() {
  let seenArgv = null;
  const res = await handleRunCommand(
    { args: ["ops-watcher/review-runner.mjs", "--once"] },
    { run: async (exe, argv) => { seenArgv = { exe, argv }; return { code: 0, stdout: "did the thing", stderr: "" }; } },
  );
  assert.deepEqual(seenArgv, { exe: "node", argv: ["ops-watcher/review-runner.mjs", "--once"] }, "T10: run() invoked with exact node argv, unmodified");
  assert.equal(res.isError, false, "T10: exit 0 -> isError false");
  assert.ok(/did the thing/.test(res.content[0].text), "T10: stdout surfaced in tool result text");
  ok("T10: handleRunCommand spawns exactly the validated argv on an allowed command");
}

async function t11_mcpProtocolRoundTrip() {
  const sent = [];
  const server = makeServer({
    run: async () => ({ code: 0, stdout: "ok", stderr: "" }),
    write: (s) => sent.push(JSON.parse(s)),
  });
  await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  await server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
  await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  await server.handleMessage({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "run_command", arguments: { args: ["ops-watcher/review-runner.mjs", "--once"] } },
  });
  await server.handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "not_a_real_tool", arguments: {} } });

  assert.equal(sent.length, 4, "T11: initialize + tools/list + tools/call x2 => 4 responses (notification gets none)");
  assert.equal(sent[0].result.serverInfo.name, "ahmad-mcp-server", "T11: initialize response names the server");
  assert.equal(sent[1].result.tools[0].name, "run_command", "T11: tools/list exposes exactly run_command");
  assert.equal(sent[2].result.isError, false, "T11: allowed tools/call succeeds");
  assert.equal(sent[3].result.isError, true, "T11: unknown tool name is rejected, not crashed");
  ok("T11: MCP JSON-RPC round trip (initialize, tools/list, tools/call x2) via injected write()");
}

async function t12_malformedLineNeverCrashesServer() {
  // main()'s readline handler ignores JSON.parse failures; here we exercise
  // handleMessage directly with a non-object to prove it never throws.
  const server = makeServer({ write: () => {} });
  await assert.doesNotReject(() => server.handleMessage(null), "T12a: null message must not throw");
  await assert.doesNotReject(() => server.handleMessage({ method: "totally/unknown" }), "T12b: unknown method with no id must not throw");
  ok("T12: malformed/unknown messages never crash the server");
}

async function t13_allowsSjahrirDispatchWrapper() {
  // The node-wrapper-around-kimi relay. A bare `kimi` binary can never be
  // invoked directly through run_command (exe must be "node"); this wrapper is
  // the sanctioned path. Validates with a free-form prompt after the script,
  // mirroring T6's pattern for hatta/harness.mjs.
  assert.ok(ALLOWED_SCRIPTS.includes("ops-watcher/sjahrir-dispatch.mjs"), "T13 precondition: sjahrir-dispatch.mjs on the allowlist");
  const v = await validateRunCommand({ exe: "node", args: ["ops-watcher/sjahrir-dispatch.mjs", "Summarize the latest research on X."] });
  assert.equal(v.ok, true, "T13: sjahrir-dispatch.mjs + free-form prompt must validate");
  ok("T13: allows node ops-watcher/sjahrir-dispatch.mjs \"<prompt>\"");
}

async function t14_allowsCorleoneDispatchWrapper() {
  // The node-wrapper-around-codex relay. Same boundary reason as T13.
  assert.ok(ALLOWED_SCRIPTS.includes("ops-watcher/corleone-dispatch.mjs"), "T14 precondition: corleone-dispatch.mjs on the allowlist");
  const v = await validateRunCommand({ exe: "node", args: ["ops-watcher/corleone-dispatch.mjs", "Implement feature Y."] });
  assert.equal(v.ok, true, "T14: corleone-dispatch.mjs + free-form prompt must validate");
  ok("T14: allows node ops-watcher/corleone-dispatch.mjs \"<prompt>\"");
}

async function t15_allowsAhmadEscalateWrapper() {
  // Headless AHMAD's only way to escalate an issue to the OWNER — adds the
  // OWNER_REQUIRED label + posts an AHMAD ESCALATION comment. Validates with an
  // issue identifier + free-form reason, mirroring T13/T14's pattern.
  assert.ok(ALLOWED_SCRIPTS.includes("ops-watcher/ahmad-escalate.mjs"), "T15 precondition: ahmad-escalate.mjs on the allowlist");
  const v = await validateRunCommand({ exe: "node", args: ["ops-watcher/ahmad-escalate.mjs", "KOL-1", "reason text"] });
  assert.equal(v.ok, true, "T15: ahmad-escalate.mjs + identifier + reason must validate");
  ok("T15: allows node ops-watcher/ahmad-escalate.mjs \"KOL-1\" \"reason text\"");
}

async function t16_allowsHattaFlashDispatchWrapper() {
  // The node-wrapper-around-HATTA-harness relay that forces the cheap/fast
  // Flash-tier model (glm-5.3-flash:cloud) via an env override. Headless AHMAD
  // cannot set env vars when calling `node hatta/harness.mjs` directly, so this
  // wrapper is the sanctioned path to reach the Flash tier. Validates with a
  // free-form prompt after the script, mirroring T13/T14/T15's pattern.
  assert.ok(ALLOWED_SCRIPTS.includes("ops-watcher/hatta-flash-dispatch.mjs"), "T16 precondition: hatta-flash-dispatch.mjs on the allowlist");
  const v = await validateRunCommand({ exe: "node", args: ["ops-watcher/hatta-flash-dispatch.mjs", "Reply with exactly the text OK and do nothing else."] });
  assert.equal(v.ok, true, "T16: hatta-flash-dispatch.mjs + free-form prompt must validate");
  ok("T16: allows node ops-watcher/hatta-flash-dispatch.mjs \"<prompt>\"");
}

async function t17_allowsHattaDispatchWrapper() {
  // The node-wrapper-around-HATTA-harness relay for the DEFAULT HATTA lane
  // (glm-5.2:cloud) — the one headless AHMAD's cold-start prompt now points at
  // instead of calling hatta/harness.mjs directly, so the default lane is also
  // usage-tracked by logLaneUsage (previously only Flash/SJAHRIR/CORLEONE were
  // tracked). NO env override here (unlike the Flash wrapper) — the child is
  // spawned with a plain process.env passthrough so the harness uses its
  // built-in default model. Validates with a free-form prompt after the script,
  // mirroring T13/T14/T15/T16's pattern.
  assert.ok(ALLOWED_SCRIPTS.includes("ops-watcher/hatta-dispatch.mjs"), "T17 precondition: hatta-dispatch.mjs on the allowlist");
  const v = await validateRunCommand({ exe: "node", args: ["ops-watcher/hatta-dispatch.mjs", "Reply with exactly the text OK and do nothing else."] });
  assert.equal(v.ok, true, "T17: hatta-dispatch.mjs + free-form prompt must validate");
  ok("T17: allows node ops-watcher/hatta-dispatch.mjs \"<prompt>\"");
}

async function t18_allowsGraphifyAnalystWrapper() {
  // The ON-DEMAND query wrapper for the GRAPHIFY-ANALYST Bennett-roster role —
  // a structural/multi-hop code-relationship query tool (NOT an implementation
  // lane). Headless AHMAD invokes it via run_command when it needs a
  // structural answer beyond what plain file reading gives it, the same way it
  // invokes HATTA/SJAHRIR/CORLEONE for implementation work. Spawns `kimi -p`
  // (SJAHRIR's lane) with the graph data + staleness disclosure. Validates with
  // a free-form structural question after the script, mirroring T13/T14/T15/
  // T16/T17's pattern.
  assert.ok(ALLOWED_SCRIPTS.includes("ops-watcher/graphify-analyst.mjs"), "T18 precondition: graphify-analyst.mjs on the allowlist");
  const v = await validateRunCommand({ exe: "node", args: ["ops-watcher/graphify-analyst.mjs", "What calls runCommandTool in hatta/harness.mjs?"] });
  assert.equal(v.ok, true, "T18: graphify-analyst.mjs + free-form structural question must validate");
  ok("T18: allows node ops-watcher/graphify-analyst.mjs \"<structural question>\"");
}

async function main() {
  const tests = [
    t1_allowsRealAllowedScript, t2_deniesNonNodeExe, t3_deniesUnlistedScript,
    t4_deniesEvalFlagAsFirstArg, t5_deniesUnknownFlagAfterScript,
    t6_allowsFreeformPromptTextAfterScript, t7_deniesPathEscape,
    t8_deniesMissingScriptOnDisk, t9_handleRunCommandDeniedNeverInvokesRun,
    t10_handleRunCommandAllowedInvokesRunWithExactArgv, t11_mcpProtocolRoundTrip,
    t12_malformedLineNeverCrashesServer, t13_allowsSjahrirDispatchWrapper,
    t14_allowsCorleoneDispatchWrapper, t15_allowsAhmadEscalateWrapper,
    t16_allowsHattaFlashDispatchWrapper, t17_allowsHattaDispatchWrapper,
    t18_allowsGraphifyAnalystWrapper,
  ];
  for (const t of tests) await t();
  console.log(`\nahmad-mcp-server.regression.test.mjs: ${pass}/${tests.length} passed`);
  if (pass !== tests.length) process.exitCode = 1;
}

main();