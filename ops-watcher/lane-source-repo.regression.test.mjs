// Offline regression coverage for ops-watcher/lane-source-repo.mjs.
// No real venture registry reads and no real repository stats.

import assert from "node:assert/strict";
import path from "node:path";
import { sourceRepoForPrompt, ventureIdFromPrompt } from "./lane-source-repo.mjs";

let passed = 0;
let failed = 0;
const failures = [];

const ok = (name) => { console.log(`PASS: ${name}`); passed += 1; };
const bad = (name, err) => {
  console.log(`FAIL: ${name}`);
  if (err) console.log(`       ${err && err.stack ? err.stack : err}`);
  failures.push(name);
  failed += 1;
};

async function t(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

const repoRoot = path.resolve("D:/repo/aidit-os");
const dirStat = { isDirectory: () => true, isFile: () => false };
const fileStat = { isDirectory: () => false, isFile: () => true };

function insideRoot(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function registry(entries) {
  return async (id) => entries[id] || null;
}

function statOk() {
  return { stat: async (p) => p.endsWith(`${path.sep}.git`) ? fileStat : dirStat };
}

console.log("# lane-source-repo regression tests");

await t("L1 no VENTURE_ID is not venture work", async () => {
  const result = await sourceRepoForPrompt("plain work item", {
    repoRoot,
    ventureById: async () => { throw new Error("must not read registry"); },
    _fs: { stat: async () => { throw new Error("must not stat"); } },
  });
  assert.deepEqual(result, { sourceRepo: null, ventureId: null, reason: "not venture work" });
});

await t("L2 active venture resolves to an absolute repo path", async () => {
  const result = await sourceRepoForPrompt("VENTURE_ID: caveman-trading-os\nship it", {
    repoRoot,
    ventureById: registry({
      "caveman-trading-os": { id: "caveman-trading-os", status: "active", repoPath: "ventures/caveman-trading-os" },
    }),
    _fs: statOk(),
  });
  assert.equal(result.sourceRepo, path.resolve(repoRoot, "ventures/caveman-trading-os"));
  assert.equal(result.ventureId, "caveman-trading-os");
  assert.equal(result.reason, "venture caveman-trading-os repository selected");
});

await t("L3 unknown venture id returns null and names the id", async () => {
  const result = await sourceRepoForPrompt("VENTURE_ID: missing-one", {
    repoRoot,
    ventureById: registry({}),
    _fs: statOk(),
  });
  assert.equal(result.sourceRepo, null);
  assert.equal(result.ventureId, "missing-one");
  assert.match(result.reason, /missing-one/);
});

await t("L4 non-active registry status blocks the repo by status", async () => {
  for (const status of ["paused", "archived"]) {
    const result = await sourceRepoForPrompt(`VENTURE_ID: venture-${status}`, {
      repoRoot,
      ventureById: registry({
        [`venture-${status}`]: { id: `venture-${status}`, status, repoPath: `ventures/venture-${status}` },
      }),
      _fs: statOk(),
    });
    assert.equal(result.sourceRepo, null, `${status} must not select a repo`);
    assert.match(result.reason, /not active/);
    assert.equal(result.reason, `venture venture-${status} is not active`);
  }
});

await t("L5 missing repository or missing .git reports repository missing", async () => {
  const ventureById = registry({
    caveman: { id: "caveman", status: "active", repoPath: "ventures/caveman" },
  });
  const repo = path.resolve(repoRoot, "ventures/caveman");

  const missingRepo = await sourceRepoForPrompt("VENTURE_ID: caveman", {
    repoRoot,
    ventureById,
    _fs: { stat: async () => { throw new Error("ENOENT"); } },
  });
  assert.equal(missingRepo.sourceRepo, null);
  assert.match(missingRepo.reason, /repository is missing/);

  const missingGit = await sourceRepoForPrompt("VENTURE_ID: caveman", {
    repoRoot,
    ventureById,
    _fs: {
      stat: async (p) => {
        if (path.resolve(p) === repo) return dirStat;
        throw new Error("ENOENT");
      },
    },
  });
  assert.equal(missingGit.sourceRepo, null);
  assert.match(missingGit.reason, /repository is missing/);
});

await t("L6 repoPath outside REPO_ROOT is refused", async () => {
  const result = await sourceRepoForPrompt("VENTURE_ID: outside", {
    repoRoot,
    ventureById: registry({
      outside: { id: "outside", status: "active", repoPath: "../outside" },
    }),
    _fs: statOk(),
  });
  assert.equal(result.sourceRepo, null);
  assert.match(result.reason, /repository is missing/);
});

await t("L7 several VENTURE_ID lines use the first one", async () => {
  const seen = [];
  const result = await sourceRepoForPrompt("VENTURE_ID: first\nVENTURE_ID: second", {
    repoRoot,
    ventureById: async (id) => {
      seen.push(id);
      return { id, status: "active", repoPath: `ventures/${id}` };
    },
    _fs: statOk(),
  });
  assert.deepEqual(seen, ["first"]);
  assert.equal(result.ventureId, "first");
  assert.equal(result.sourceRepo, path.resolve(repoRoot, "ventures/first"));
});

await t("L8 hostile input never throws and never escapes REPO_ROOT", async () => {
  const hostile = [
    "",
    null,
    undefined,
    42,
    "x".repeat(100_000),
    "VENTURE_ID: ..\\evil/../../outside",
  ];
  for (const prompt of hostile) {
    let result;
    assert.doesNotThrow(() => { ventureIdFromPrompt(prompt); });
    await assert.doesNotReject(async () => {
      result = await sourceRepoForPrompt(prompt, {
        repoRoot,
        ventureById: async (id) => ({ id, status: "active", repoPath: `ventures/${id}` }),
        _fs: statOk(),
      });
    }, `hostile prompt ${String(prompt).slice(0, 40)} must not throw`);
    if (result.sourceRepo) {
      assert.ok(insideRoot(repoRoot, result.sourceRepo), `${result.sourceRepo} must stay inside ${repoRoot}`);
    }
  }
});

await t("L9 registry read failure is reported without propagation", async () => {
  const result = await sourceRepoForPrompt("VENTURE_ID: caveman", {
    repoRoot,
    ventureById: async () => { throw new Error("registry offline"); },
    _fs: statOk(),
  });
  assert.equal(result.sourceRepo, null);
  assert.equal(result.ventureId, "caveman");
  assert.match(result.reason, /could not be read from the registry/);
});

console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
