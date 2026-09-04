// ops-watcher/autonomy-policy.regression.test.mjs
// Offline regression coverage for the autonomy gate. NO cockpit, NO real
// registry reads: venture lookups are served by injected fs.
// Run with:
//   node ops-watcher/autonomy-policy.regression.test.mjs

import assert from "node:assert/strict";
import {
  DEFAULT_VERIFY_ALLOWLIST,
  NEVER_AUTONOMOUS_PATHS,
  decideAutonomy,
  underPrefix,
  verifyIsPreApproved,
} from "./autonomy-policy.mjs";

let passed = 0;
let failed = 0;
const failures = [];
const decisions = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(`  ${e && e.stack ? e.stack : e}`);
  failures.push(n);
  failed++;
};

const MEM_FILE = "mem:/config/ventures.json";
const TRUSTED_VERIFY = "node ops-watcher/run-all-tests.mjs";
const SAFE_FILE = "ventures/safe/src/change.mjs";
const SAFE_VENTURE_ID = "safe-venture";

function registry(ventures) {
  return JSON.stringify({ schema_version: "test", ventures });
}

function fakeFs(raw = registry([
  {
    id: SAFE_VENTURE_ID,
    status: "active",
    repoPath: "ventures/safe",
    hardStops: ["owner-contract"],
    owner_decision_required: [],
  },
])) {
  const calls = [];
  return {
    calls,
    async readFile(file, encoding) {
      calls.push({ op: "readFile", file, encoding });
      if (file !== MEM_FILE) throw new Error(`unexpected registry read: ${file}`);
      return raw;
    },
  };
}

function deps(over = {}) {
  return {
    _fs: fakeFs(over.raw),
    file: MEM_FILE,
    ...over,
  };
}

function proposal(over = {}) {
  return {
    files: [SAFE_FILE],
    verify: TRUSTED_VERIFY,
    reversible: true,
    ventureId: SAFE_VENTURE_ID,
    ...over,
  };
}

async function decideCase(name, p, d = deps()) {
  const result = await decideAutonomy(p, d);
  decisions.push({ name, result });
  return result;
}

function assertRejected(result, reasonPattern, message) {
  assert.equal(result.autonomous, false, `${message}: autonomous is false`);
  assert.ok(result.reasons.some((r) => reasonPattern.test(r)), `${message}: reason matches ${reasonPattern}`);
}

async function t1_selfCertificationHoleRejectsAgentWrittenVerifyCommands() {
  assert.equal(
    verifyIsPreApproved(TRUSTED_VERIFY, DEFAULT_VERIFY_ALLOWLIST).ok,
    true,
    "T1 self-certification hole: the whole pre-approved suite is accepted",
  );
  assert.deepEqual(
    await decideCase("T1 allowed whole-suite verify", proposal()),
    { autonomous: true, reasons: [], ventureId: SAFE_VENTURE_ID },
    "T1 self-certification hole: choosing the trusted whole suite is green",
  );

  const rejected = [
    ["trailing || true", `${TRUSTED_VERIFY} || true`, /chains or redirects/],
    ["trailing && echo ok", `${TRUSTED_VERIFY} && echo ok`, /chains or redirects/],
    ["semicolon command", `${TRUSTED_VERIFY}; true`, /chains or redirects/],
    ["backtick command", `${TRUSTED_VERIFY} ` + "`echo ok`", /chains or redirects/],
    ["subshell command", `${TRUSTED_VERIFY} $(echo ok)`, /chains or redirects/],
    ["newline second command", `${TRUSTED_VERIFY}\ntrue`, /chains or redirects/],
    ["agent-written narrow verify", "node ops-watcher/foo.test.mjs", /not on the pre-approved list/],
  ];

  for (const [label, command, reason] of rejected) {
    const direct = verifyIsPreApproved(command, DEFAULT_VERIFY_ALLOWLIST);
    assert.equal(direct.ok, false, `T1 self-certification hole: ${label} is rejected directly`);
    assert.match(direct.reason, reason, `T1 self-certification hole: ${label} reason is specific`);

    const result = await decideCase(`T1 self-certification hole: ${label}`, proposal({ verify: command }));
    assertRejected(result, reason, `T1 self-certification hole: ${label}`);
  }

  ok("T1: self-certification hole rejects chained and agent-written verify commands by name");
}

async function t2_verifyAllowlistUsesExactCommandsNotStartsWith() {
  const allowlist = [TRUSTED_VERIFY];
  const startsWithAllowed = `${TRUSTED_VERIFY} --only autonomy-policy`;

  const direct = verifyIsPreApproved(startsWithAllowed, allowlist);
  assert.equal(direct.ok, false, "T2: command that only starts with an allowed command is rejected directly");
  assert.match(direct.reason, /not on the pre-approved list/, "T2: starts-with rejection is not a chain rejection");

  const result = await decideCase(
    "T2 starts-with verify command",
    proposal({ verify: startsWithAllowed }),
    deps({ verifyAllowlist: allowlist }),
  );
  assertRejected(result, /not on the pre-approved list/, "T2: decideAutonomy rejects starts-with verify commands");

  ok("T2: verify allow-list matching is exact, not starts-with");
}

async function t3_underPrefixRespectsDirectoryBoundaries() {
  assert.equal(underPrefix("state/ledger.jsonl", "state/ledger.jsonl"), true, "T3: exact file matches itself");
  assert.equal(underPrefix("ops-watcher/x.mjs", "ops-watcher/"), true, "T3: file sits under directory prefix");
  assert.equal(underPrefix("state/ledger.jsonl.bak", "state/ledger.jsonl"), false, "T3: sibling filename is not under file prefix");
  assert.equal(
    underPrefix("ventures/caveman-trading-os-old/x", "ventures/caveman-trading-os"),
    false,
    "T3: partial directory-name prefix is not under the venture directory",
  );
  ok("T3: underPrefix respects file and directory boundaries");
}

async function t4_neverAutonomousPathsAreRefusedOneByOne() {
  for (const never of NEVER_AUTONOMOUS_PATHS) {
    const file = never.endsWith("/") ? `${never}owned.txt` : never;
    const result = await decideCase(`T4 never autonomous path ${never}`, proposal({ files: [file] }));
    assertRejected(result, new RegExp(escapeRegExp(file)), `T4: ${file} is refused`);
  }
  ok("T4: every NEVER_AUTONOMOUS_PATHS entry is refused and named");
}

async function t5_pathsLeavingTheRepositoryAreRefused() {
  for (const file of ["../x", "/tmp/x", "C:/tmp/x"]) {
    const result = await decideCase(`T5 leaving repo ${file}`, proposal({ files: [file] }));
    assertRejected(result, /file leaves the repository/, `T5: ${file} is refused`);
    assert.ok(result.reasons.some((r) => r.includes(file)), `T5: ${file} reason names the file`);
  }
  ok("T5: proposals that leave the repository are refused");
}

async function t6_noFilesIsNotSafe() {
  const result = await decideCase("T6 no files", proposal({ files: [] }));
  assertRejected(result, /names no files/, "T6: proposal naming no files is refused");
  ok("T6: a proposal that names no files is refused");
}

async function t7_reversibleMustBeBooleanTrue() {
  for (const [label, value, p] of [
    ["omitted", undefined, (() => {
      const copy = proposal();
      delete copy.reversible;
      return copy;
    })()],
    ["false", false, proposal({ reversible: false })],
    ["string true", "true", proposal({ reversible: "true" })],
  ]) {
    const result = await decideCase(`T7 reversible ${label}`, p);
    assertRejected(result, /does not declare itself reversible/, `T7: reversible ${String(value)} is refused`);
  }
  ok("T7: reversible must be the boolean true");
}

async function t8_unknownVentureIsNeverPermissive() {
  const result = await decideCase(
    "T8 unknown venture",
    proposal({ ventureId: "mystery-venture" }),
    deps({ raw: registry([]) }),
  );
  assertRejected(result, /nothing is known to be safe in it/, "T8: unknown venture is refused");
  ok("T8: unknown ventureId is refused as not known safe");
}

async function t9_happyPathHasNoReasons() {
  const result = await decideCase("T9 happy path", proposal());
  assert.deepEqual(result, { autonomous: true, reasons: [], ventureId: SAFE_VENTURE_ID }, "T9: happy path is exactly green");
  ok("T9: proposal satisfying every gate is autonomous with no reasons");
}

async function t10_reasonsInvariantForEveryDecisionCase() {
  assert.ok(decisions.length > 0, "T10: prior tests collected decision cases");
  for (const { name, result } of decisions) {
    if (result.autonomous) {
      assert.deepEqual(result.reasons, [], `${name}: autonomous true has empty reasons`);
    } else {
      assert.ok(Array.isArray(result.reasons) && result.reasons.length > 0, `${name}: autonomous false has non-empty reasons`);
    }
  }
  ok("T10: reasons is empty when true and non-empty when false for every decision case");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  assert.ok(Array.isArray(DEFAULT_VERIFY_ALLOWLIST), "exported DEFAULT_VERIFY_ALLOWLIST exists");
  assert.ok(Array.isArray(NEVER_AUTONOMOUS_PATHS), "exported NEVER_AUTONOMOUS_PATHS exists");

  const tests = [
    t1_selfCertificationHoleRejectsAgentWrittenVerifyCommands,
    t2_verifyAllowlistUsesExactCommandsNotStartsWith,
    t3_underPrefixRespectsDirectoryBoundaries,
    t4_neverAutonomousPathsAreRefusedOneByOne,
    t5_pathsLeavingTheRepositoryAreRefused,
    t6_noFilesIsNotSafe,
    t7_reversibleMustBeBooleanTrue,
    t8_unknownVentureIsNeverPermissive,
    t9_happyPathHasNoReasons,
    t10_reasonsInvariantForEveryDecisionCase,
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
