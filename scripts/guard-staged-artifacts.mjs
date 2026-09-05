#!/usr/bin/env node
// scripts/guard-staged-artifacts.mjs
// Refuses a commit that stages a zero-byte file.
//
//   node scripts/guard-staged-artifacts.mjs        # exits 1 and explains, or 0
//
// Wired as .git/hooks/pre-commit by scripts/install-git-hooks.mjs.
//
// === WHY ===
// Zero-byte files with names that are plainly shell fragments — "0", "{",
// "a.name).sort()", "CLI_FIELD_MAX", "r.timedOut" — reached origin/main SEVEN
// times in one day, across FIVE separate "remove the artifact" commits. The
// eighth appeared in the same commit that added the seventh to .gitignore.
//
// They come from a shell REDIRECT. A command like
//     node -e "const f = xs.map(x => x.name)"
// reaching a shell that treats the `>` in the arrow as a redirection operator
// creates an empty file named after the token that followed it.
//
// Listing names in .gitignore cannot work, because every occurrence has a new
// name. The invariant is what holds: a zero-byte file is never something this
// repository means to commit.
//
// ops-watcher/repo-hygiene.regression.test.mjs asserts the same rule over the
// whole tree, so the guard survives even where hooks are not installed. This
// script is the earlier, cheaper stop.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Kept in step with ALLOWED_EMPTY_FILES in the regression test. Duplicated on
// purpose: the hook must not import from ops-watcher/ (it has to run in a bare
// checkout with no install), and the test asserts the real tree anyway.
const ALLOWED_EMPTY = new Set(["hatta/.harness-empty-gitconfig"]);

function stagedFiles() {
  try {
    // --diff-filter=ACMR, NOT ACM. This guard's first real commit leaked an
    // artifact precisely because R was missing: git noticed that the deleted
    // "0" and the newly added "x.source_file" had identical (empty) content and
    // recorded the pair as a RENAME, which "ACM" filters out. Two zero-byte
    // artifacts in the same commit therefore hide each other. Any status that
    // can put a file into the tree has to be inspected.
    //
    // --no-renames would also fix it, but keeping R and listing the destination
    // is the safer shape: it still reports the file by the name it will have.
    return execFileSync("git", ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    })
      .split("\0")
      .filter(Boolean);
  } catch {
    // No git, no index, or a bare checkout. A guard that cannot read the index
    // must not block the commit — failing open here is right, because the
    // regression test still holds the line.
    return [];
  }
}

function sizeOf(rel) {
  try {
    const st = fs.statSync(path.join(REPO_ROOT, rel));
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

const offenders = stagedFiles().filter((rel) => !ALLOWED_EMPTY.has(rel) && sizeOf(rel) === 0);

if (offenders.length) {
  process.stderr.write(
    "\nCOMMIT REFUSED: zero-byte file(s) staged\n\n" +
      offenders.map((f) => `  ${f}`).join("\n") +
      "\n\nThese are almost always shell-redirect artifacts, not source: a `>` in a\n" +
      "command (an arrow function, a comparison) was read as a redirection and\n" +
      "created an empty file named after the next token.\n\n" +
      "To clear them:\n" +
      offenders.map((f) => `  git rm --cached -- ${JSON.stringify(f)} && rm -- ${JSON.stringify(f)}`).join("\n") +
      "\n\nIf a file is DELIBERATELY empty, add it to ALLOWED_EMPTY here and to\n" +
      "ALLOWED_EMPTY_FILES in ops-watcher/repo-hygiene.regression.test.mjs, with a\n" +
      "reason in both places.\n\n",
  );
  process.exit(1);
}

process.exit(0);
