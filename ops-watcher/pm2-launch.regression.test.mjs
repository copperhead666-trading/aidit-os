// ops-watcher/pm2-launch.regression.test.mjs
//
// THE DEFECT THIS EXISTS TO CLOSE (reproduced 2026-09-04, and the reason Aidit
// OS had never actually run under PM2 on the Lenovo):
//
// heartbeat-daemon.mjs and telegram-listener-daemon.mjs each start their loop
// only when they believe they ARE the entry point:
//
//     isEntry = path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
//
// The guard exists so a test can import a daemon without starting it. The PM2
// CJS shims exist because PM2 v7's ecosystem loader cannot fork-spawn a .mjs
// directly. The two cancelled each other out: under PM2 the SHIM was argv[1],
// so isEntry was false, main() was never called, the dynamic import resolved,
// and the process exited 0 in silence — empty error log, climbing restart
// count, no clue. Four apps launched; one stayed up.
//
// pm2-launch-cockpit.cjs had already learned this and re-aims process.argv
// before handing control to Next. The lesson was written in one shim and never
// applied to the two beside it.
//
// HOW THIS TESTS IT, AND WHY NOT BY READING THE SOURCE. Asserting that the file
// CONTAINS "process.argv[1] =" would pass on a line that assigns the wrong
// path, in the wrong order, or after the import. So each shim is copied into a
// temp directory next to a STUB daemon of the name it imports, and actually
// run. The stub reports what argv[1] was when it loaded. That is the property
// the daemons' isEntry guard actually reads.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SHIMS = [
  ["pm2-launch-heartbeat.cjs", "heartbeat-daemon.mjs"],
  ["pm2-launch-telegram-listener.cjs", "telegram-listener-daemon.mjs"],
];

// The stub stands in for the real daemon. It prints the same comparison
// isEntry makes, so a pass here means the real guard would have fired.
const STUB = [
  'import path from "node:path";',
  'import { fileURLToPath } from "node:url";',
  'const isEntry = path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);',
  'console.log("STUB_IS_ENTRY=" + isEntry);',
  "",
].join("\n");

// load-env-local.cjs is required by both shims before anything else. Stubbing
// it keeps the test off the machine's real .env.local.
const ENV_STUB = 'module.exports = () => ({ loaded: [], path: null });\n';

async function runShimInSandbox(shim, daemon) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pm2-launch-"));
  try {
    await fs.copyFile(path.join(__dirname, shim), path.join(dir, shim));
    await fs.writeFile(path.join(dir, daemon), STUB, "utf8");
    await fs.writeFile(path.join(dir, "load-env-local.cjs"), ENV_STUB, "utf8");
    const { stdout } = await execFileAsync(process.execPath, [path.join(dir, shim)], {
      cwd: dir,
      encoding: "utf8",
      timeout: 30_000,
    });
    return stdout;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

for (const [shim, daemon] of SHIMS) {
  test(`${shim} makes its daemon the entry point`, async () => {
    const stdout = await runShimInSandbox(shim, daemon);
    assert.match(
      stdout,
      /STUB_IS_ENTRY=true/,
      `${shim} left argv[1] pointing at itself, so ${daemon} would import without ever starting. `
      + `That failure is SILENT: exit code 0, empty stderr, and PM2 reporting only a restart count.`,
    );
  });
}

test("the shim aims argv[1] at the daemon, not merely at something", async () => {
  // Guards the mutation that assigns a path which is not the daemon's: the
  // stub only reports true when argv[1] resolves to its own file.
  const stdout = await runShimInSandbox(SHIMS[0][0], SHIMS[0][1]);
  assert.equal(stdout.includes("STUB_IS_ENTRY=false"), false, "argv[1] resolved to some other file");
});
