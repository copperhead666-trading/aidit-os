// ops-watcher/merge-steward.mjs
// Read-only lane diff steward. It reports verification results and never
// integrates work.
//
//   node ops-watcher/merge-steward.mjs --once
//   node ops-watcher/merge-steward.mjs --once --json
//   node ops-watcher/merge-steward.mjs --once --no-suite

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPO_ROOT,
  dirtyEntryCount as defaultDirtyEntryCount,
  listLaneWorktrees as defaultListLaneWorktrees,
} from "./lane-worktree.mjs";

const PINNED_NODE = "D:\\aidit-node\\node-v22.14.0-win-x64\\node.exe";
const MAX_BUFFER = 64 * 1024 * 1024;

function result(name, ok, detail) {
  return { name, ok: Boolean(ok), detail: String(detail || "") };
}

function values(input, key) {
  if (input && typeof input === "object" && Array.isArray(input[key])) return input[key];
  if (Array.isArray(input)) return input;
  return [];
}

function slash(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function fileName(p) {
  const parts = slash(p).split("/");
  return parts[parts.length - 1] || "";
}

function isTestFile(p) {
  return slash(p).endsWith(".test.mjs");
}

function unique(items) {
  return [...new Set(items.map((item) => slash(item).trim()).filter(Boolean))];
}

function gitOutput(gitArgs, cwd, _exec) {
  const safeCwd = path.resolve(String(cwd || "."));
  return String(_exec("git", ["-c", `safe.directory=${safeCwd}`, ...gitArgs], {
    cwd: safeCwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  })).trim();
}

function parseCount(text) {
  const n = Number.parseInt(String(text || "").trim(), 10);
  if (!Number.isFinite(n) || n < 0) throw new Error("git returned an invalid count");
  return n;
}

function statusPath(line) {
  const raw = String(line || "").slice(3).trim();
  const renamed = raw.includes(" -> ") ? raw.split(" -> ").pop() : raw;
  return renamed.replace(/^"|"$/g, "");
}

function parseAddedLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
}

function untrackedFilesFromStatus(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("?? "))
    .map(statusPath)
    .filter(Boolean);
}

function readUntrackedAddedLines(files, cwd, readFileSync) {
  const lines = [];
  for (const file of files) {
    try {
      const body = readFileSync(path.join(cwd, file), "utf8");
      for (const line of String(body).split(/\r?\n/)) lines.push(`+${line}`);
    } catch {
      // If the file disappeared between status and read, the worktree will be
      // reported by the other checks. This helper must never throw.
    }
  }
  return lines;
}

function runDefaultSuite(worktreePath, deps = {}) {
  const _exec = deps.execFileSync || execFileSync;
  try {
    return String(_exec(PINNED_NODE, ["ops-watcher/run-all-tests.mjs"], {
      cwd: worktreePath,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    }));
  } catch (err) {
    return [
      err && err.stdout ? String(err.stdout) : "",
      err && err.stderr ? String(err.stderr) : "",
      err && err.message ? String(err.message) : "",
    ].filter(Boolean).join("\n");
  }
}

export function checkSyntax(input, deps = {}) {
  try {
    const changedFiles = unique(values(input, "changedFiles"));
    const worktreePath = input && typeof input === "object" ? input.path : null;
    const _exec = deps.execFileSync || execFileSync;
    const existsSync = deps.existsSync || fs.existsSync;
    const nodeBin = deps.nodeBin || process.execPath || "node";
    const failures = [];

    for (const file of changedFiles.filter((p) => slash(p).endsWith(".mjs"))) {
      const fullPath = worktreePath ? path.join(worktreePath, file) : file;
      if (worktreePath && !existsSync(fullPath)) continue;
      try {
        _exec(nodeBin, ["--check", fullPath], {
          cwd: worktreePath || process.cwd(),
          encoding: "utf8",
          maxBuffer: MAX_BUFFER,
          windowsHide: true,
        });
      } catch (err) {
        failures.push(`${file}: ${err && err.message ? err.message : String(err)}`);
      }
    }

    return failures.length
      ? result("syntax", false, failures.join("; "))
      : result("syntax", true, "changed mjs files passed node --check");
  } catch (err) {
    return result("syntax", false, err && err.message ? err.message : String(err));
  }
}

export function checkForbiddenPaths(input) {
  try {
    const changedFiles = unique(values(input, "changedFiles"));
    const blocked = changedFiles.filter((file) => {
      const p = slash(file);
      const base = fileName(p);
      if (p === ".claude/settings.json") return true;
      if (p.startsWith(".claude/") && /(^|\/)(hooks?|permissions?)(\/|\.|$)/i.test(p)) return true;
      if (base.startsWith(".env")) return true;
      if (p === "ventures" || p.startsWith("ventures/")) return true;
      return false;
    });
    return blocked.length
      ? result("forbidden-paths", false, `forbidden paths changed: ${blocked.join(", ")}`)
      : result("forbidden-paths", true, "no forbidden paths changed");
  } catch (err) {
    return result("forbidden-paths", false, err && err.message ? err.message : String(err));
  }
}

export function checkTestsAccompanyBehaviour(input) {
  try {
    const changedFiles = unique(values(input, "changedFiles"));
    const hasTest = changedFiles.some(isTestFile);
    const behaviour = changedFiles.filter((file) => {
      const p = slash(file);
      if (!(p.startsWith("ops-watcher/") || p.startsWith("hatta/"))) return false;
      if (!p.endsWith(".mjs")) return false;
      return !isTestFile(p);
    });

    return behaviour.length && !hasTest
      ? result("tests-accompany-behaviour", false, `behaviour files changed without a test: ${behaviour.join(", ")}`)
      : result("tests-accompany-behaviour", true, "behaviour changes are accompanied by tests or none were found");
  } catch (err) {
    return result("tests-accompany-behaviour", false, err && err.message ? err.message : String(err));
  }
}

export function checkSecretShapedLiterals(input) {
  try {
    const addedLines = values(input, "addedLines").map((line) => String(line || ""));
    // An identifier is segmented by "_", "-", "." and by camelCase
    // transitions (a lowercase letter directly followed by an uppercase
    // one). A credential keyword counts only as a whole segment or as the
    // whole identifier, never as a substring: "apiKey" and "db_password"
    // match, "monkey", "keystone" and "tokenisation" do not.
    const identifierRun = /[A-Za-z0-9][A-Za-z0-9_.\-]*/g;
    const segmentSplit = /[_\-.]+|(?<=[a-z])(?=[A-Z])/;
    const keywordSegment = /^(?:token|secret|key|password)$/i;
    // ghp_/sk-/pcp_ prefixes mark a credential wherever they appear.
    const prefixed = /(?<![A-Za-z0-9])(ghp_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|pcp_[A-Za-z0-9_]{20,})/;
    // A long value: 32+ chars of the literal classes the check always used.
    // Hex is a subset of [A-Za-z0-9+/=], so a hex run is consumed by the
    // first alternative and never reaches the second.
    const longValue = /[A-Za-z0-9+/=]{32,}|[a-fA-F0-9]{32,}/;
    const longRuns = /[A-Za-z0-9+/=]{32,}/g;
    // A git object id is exactly 40 (sha-1) or 64 (sha-256) hex chars, or
    // an abbreviation of 7 to 12. Length-anchored, not "roughly that long":
    // a 41- or 48-char run is not a revision.
    const gitRevision = /^[a-fA-F0-9]{7,12}$|^[a-fA-F0-9]{40}$|^[a-fA-F0-9]{64}$/;
    const isHexRun = (run) => /^[a-fA-F0-9]+$/.test(run);
    const findings = [];

    const hasSecretSegmentName = (text) => {
      for (const match of text.matchAll(identifierRun)) {
        const run = match[0];
        if (!/[A-Za-z]/.test(run)) continue;
        if (run.split(segmentSplit).some((seg) => keywordSegment.test(seg))) return true;
      }
      return false;
    };

    for (const line of addedLines) {
      if (!line.startsWith("+")) continue;
      const body = line.slice(1);
      const trimmed = body.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("#")) continue;
      const named = hasSecretSegmentName(body);
      const runs = body.match(longRuns) || [];
      // Rule 1 beats rule 2: a secret-shaped name with a long value is a
      // credential even when the value is exactly a git revision length.
      const flagged = prefixed.test(body)
        || (named && longValue.test(body))
        || (!named && runs.some((run) => !isHexRun(run) && !gitRevision.test(run)));
      if (flagged) {
        findings.push(trimmed.slice(0, 120));
      }
    }

    return findings.length
      ? result("secret-shaped-literals", false, `possible credential literal in added lines: ${findings.join("; ")}`)
      : result("secret-shaped-literals", true, "no secret shaped literals found");
  } catch (err) {
    return result("secret-shaped-literals", false, err && err.message ? err.message : String(err));
  }
}

export function checkSuite(input, deps = {}) {
  try {
    const worktreePath = input && typeof input === "object" ? input.path : process.cwd();
    const runner = deps.suiteRunner || ((cwd) => runDefaultSuite(cwd, deps));
    let output;
    try {
      output = String(runner(worktreePath));
    } catch (err) {
      output = [
        err && err.stdout ? String(err.stdout) : "",
        err && err.stderr ? String(err.stderr) : "",
        err && err.message ? String(err.message) : String(err),
      ].filter(Boolean).join("\n");
    }

    const matches = [...output.matchAll(/SUITES:\s*(\d+)\/(\d+)\s+passed/g)];
    if (matches.length === 0) return result("suite", false, "suite produced no verdict");
    const last = matches[matches.length - 1];
    const passed = Number.parseInt(last[1], 10);
    const total = Number.parseInt(last[2], 10);
    return passed === total
      ? result("suite", true, `suite passed: ${passed}/${total}`)
      : result("suite", false, `suite failed: ${passed}/${total} passed`);
  } catch (err) {
    return result("suite", false, err && err.message ? err.message : String(err));
  }
}

function gatherFacts(tree, deps) {
  const cwd = path.resolve(String(tree.path || ""));
  const _exec = deps.execFileSync || execFileSync;
  const existsSync = deps.existsSync || fs.existsSync;
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const dirt = deps.dirtyEntryCount || defaultDirtyEntryCount;

  if (!tree.path || !existsSync(cwd)) return { verdict: "unknown", reason: "worktree path is gone" };

  const uncommitted = dirt(cwd, { _exec });
  if (uncommitted === null) {
    return { verdict: "unknown", reason: "uncommitted entries could not be inspected", uncommitted };
  }

  try {
    const aheadOfMain = parseCount(gitOutput(["rev-list", "--count", "origin/main..HEAD"], cwd, _exec));
    if (aheadOfMain === 0 && uncommitted === 0) {
      return {
        path: cwd,
        branch: tree.branch || null,
        uncommitted,
        aheadOfMain,
        changedFiles: [],
        addedLines: [],
        verdict: "idle",
        checks: [],
      };
    }

    // What this worktree contributed: its uncommitted files plus the files
    // its own commits ahead of origin/main introduced. Three dots diff from
    // the merge base, so a stale checkout is not charged for files main
    // moved underneath it. Only untracked entries are read from porcelain
    // status: gitOutput trims the output, which corrupts a leading " M" on
    // the first line, and diff against HEAD already names the rest.
    const uncommittedNames = uncommitted > 0
      ? gitOutput(["diff", "--name-only", "HEAD", "--"], cwd, _exec)
      : "";
    const statusText = uncommitted > 0 ? gitOutput(["status", "--porcelain"], cwd, _exec) : "";
    const untracked = untrackedFilesFromStatus(statusText);
    const aheadNames = gitOutput(["diff", "--name-only", "origin/main...HEAD", "--"], cwd, _exec);
    // Sorted, because this list is printed in a report a person compares between
    // sweeps. Three git calls contribute to it and their natural order is an
    // accident of which command ran first; a stable order makes two runs of the
    // same worktree diffable, and lets a test assert the list rather than only
    // its membership.
    const changedFiles = unique([
      ...uncommittedNames.split(/\r?\n/),
      ...untracked,
      ...aheadNames.split(/\r?\n/),
    ]).sort();
    const diffPatch = gitOutput(["diff", "--unified=0", "origin/main", "--"], cwd, _exec);
    const addedLines = [
      ...parseAddedLines(diffPatch),
      ...readUntrackedAddedLines(untracked, cwd, readFileSync),
    ];

    return { path: cwd, branch: tree.branch || null, uncommitted, aheadOfMain, changedFiles, addedLines };
  } catch (err) {
    return {
      path: cwd,
      branch: tree.branch || null,
      uncommitted,
      verdict: "unknown",
      reason: `git could not inspect worktree: ${err && err.message ? err.message : String(err)}`,
    };
  }
}

export function reviewWorktree(tree, deps = {}) {
  try {
    const facts = gatherFacts(tree || {}, deps);
    if (facts.verdict === "unknown" || facts.verdict === "idle") return facts;

    const checks = [
      checkSyntax(facts, deps),
      checkForbiddenPaths(facts, deps),
      checkTestsAccompanyBehaviour(facts, deps),
      checkSecretShapedLiterals(facts, deps),
    ];

    if (checks.every((check) => check.ok)) {
      if (deps.noSuite) {
        // The suite was never run: mark it skipped and refuse "clean" so a
        // cheaply-checked worktree can never masquerade as fully verified.
        checks.push({ name: "suite", ok: null, skipped: true, detail: "suite not run (--no-suite)" });
        return { ...facts, checks, verdict: "unverified" };
      }
      checks.push(checkSuite(facts, deps));
    }

    return {
      ...facts,
      checks,
      verdict: checks.every((check) => check.ok) ? "clean" : "blocked",
    };
  } catch (err) {
    return {
      path: tree && tree.path ? String(tree.path) : null,
      branch: tree && tree.branch ? String(tree.branch) : null,
      verdict: "unknown",
      reason: err && err.message ? err.message : String(err),
    };
  }
}

export function reviewLanes(deps = {}) {
  const repoRoot = path.resolve(deps.repoRoot || REPO_ROOT);
  const listLaneWorktrees = deps.listLaneWorktrees || defaultListLaneWorktrees;
  let trees = [];
  try {
    trees = listLaneWorktrees({ _exec: deps.execFileSync || execFileSync, repoRoot });
  } catch {
    trees = [];
  }

  const worktrees = trees
    .filter((tree) => tree && path.resolve(String(tree.path || "")) !== repoRoot)
    .filter((tree) => tree.branch !== "main")
    .map((tree) => reviewWorktree(tree, deps));

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    worktrees,
  };
}

export function formatHumanReport(report) {
  const worktrees = report && Array.isArray(report.worktrees) ? report.worktrees : [];
  const lines = ["merge-steward report"];
  if (worktrees.length === 0) {
    lines.push("No lane worktrees found.");
    return lines.join("\n");
  }

  for (const tree of worktrees) {
    const branch = tree.branch || "(unknown branch)";
    const fileCount = Array.isArray(tree.changedFiles) ? tree.changedFiles.length : 0;
    lines.push(`${branch}: ${tree.verdict}${tree.reason ? ` - ${tree.reason}` : ""}`);
    if (tree.verdict !== "unknown") {
      lines.push(`  aheadOfMain: ${tree.aheadOfMain ?? "unknown"}, uncommitted: ${tree.uncommitted ?? "unknown"}, changedFiles: ${fileCount}`);
    }
    for (const check of Array.isArray(tree.checks) ? tree.checks : []) {
      const mark = check.skipped ? "SKIP" : check.ok ? "PASS" : "FAIL";
      lines.push(`  ${mark} ${check.name}: ${check.detail}`);
    }
  }
  return lines.join("\n");
}

export function parseArgs(argv) {
  return {
    once: argv.includes("--once"),
    json: argv.includes("--json"),
    noSuite: argv.includes("--no-suite"),
  };
}

function isEntry() {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntry()) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.once) {
    console.error("usage: node ops-watcher/merge-steward.mjs --once [--json] [--no-suite]");
    process.exit(1);
  }
  const report = reviewLanes({ noSuite: args.noSuite });
  if (args.json) console.log(JSON.stringify(report));
  else console.log(formatHumanReport(report));
  process.exit(0);
}
