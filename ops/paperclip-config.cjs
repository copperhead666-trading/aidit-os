// Writes .paperclip/instances/default/config.json for the v5 board.
// Mirrors the structure of the previous instance config but with its own
// data dir, port 3120 and the paperclip_aidit_v5 Postgres role.
// Usage: node ops/paperclip-config.cjs   (idempotent; never prints the password)
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const home = path.join(root, ".paperclip", "instances", "default");
const pw = fs.readFileSync(path.join(root, "config", "paperclip-db-password.local.txt"), "utf8").trim();

const cfg = {
  $meta: { version: 1, updatedAt: new Date().toISOString(), source: "onboard" },
  database: {
    mode: "postgres",
    connectionString: `postgresql://paperclip_aidit_v5:${encodeURIComponent(pw)}@127.0.0.1:5433/paperclip_aidit_v5`,
    backup: { enabled: true, intervalMinutes: 60, retentionDays: 30, dir: path.join(home, "data", "backups") },
  },
  logging: { mode: "file", logDir: path.join(home, "logs") },
  server: {
    deploymentMode: "local_trusted",
    exposure: "private",
    bind: "loopback",
    host: "127.0.0.1",
    port: 3120,
    allowedHostnames: [],
    serveUi: true,
  },
  telemetry: { enabled: false },
  updates: { checkEnabled: false },
  auth: { baseUrlMode: "auto", disableSignUp: false },
  storage: {
    provider: "local_disk",
    localDisk: { baseDir: path.join(home, "data", "storage") },
    s3: { bucket: "paperclip", region: "us-east-1", prefix: "", forcePathStyle: false },
  },
  secrets: {
    provider: "local_encrypted",
    strictMode: false,
    localEncrypted: { keyFilePath: path.join(home, "secrets", "master.key") },
  },
};

for (const d of ["data/backups", "logs", "data/storage", "secrets"]) {
  fs.mkdirSync(path.join(home, d), { recursive: true });
}
fs.writeFileSync(path.join(home, "config.json"), JSON.stringify(cfg, null, 2));
console.log("paperclip config written:", path.join(home, "config.json"), "port", cfg.server.port);
