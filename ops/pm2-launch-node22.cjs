// Generic PM2 shim: run a repo script under the pinned Node 22.
// Usage in ecosystem: script: "ops/pm2-launch-node22.cjs", args: "conductor/run.mjs"
const { spawn } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const node = process.env.AIDIT_NODE || "D:/aidit-node/node-v22.14.0-win-x64/node.exe";
const child = spawn(node, process.argv.slice(2), { cwd: root, stdio: "inherit", env: { ...process.env } });
child.on("exit", (code) => process.exit(code ?? 1));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
