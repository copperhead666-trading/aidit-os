// PM2 shim: runs the Paperclip board (paperclipai needs Node >= 24, so this
// one process uses the system Node, unlike everything else in this repo).
const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const node = process.env.PAPERCLIP_NODE || "C:/Program Files/nodejs/node.exe";
const entry = process.env.PAPERCLIP_ENTRY || "D:/Development/npm-global/node_modules/paperclipai/dist/index.js";
const dataDir = path.join(root, ".paperclip");

const child = spawn(node, [entry, "run", "--data-dir", dataDir, "--instance", "default", "--no-repair", "--force"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env },
  windowsHide: true,
});
child.on("exit", (code) => process.exit(code ?? 1));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
