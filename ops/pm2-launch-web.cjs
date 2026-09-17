// PM2 shim: runs `next start -p 4200` under the pinned Node 22 binary.
// PM2 itself may run on the system Node; this file only spawns the app.
const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const node = process.env.AIDIT_NODE || "D:/aidit-node/node-v22.14.0-win-x64/node.exe";
const next = path.join(root, "node_modules", "next", "dist", "bin", "next");

const child = spawn(node, [next, "start", "-p", "4200"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
  windowsHide: true,
});
child.on("exit", (code) => process.exit(code ?? 1));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
