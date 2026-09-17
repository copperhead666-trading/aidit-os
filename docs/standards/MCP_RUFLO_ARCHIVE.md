# Arsip konfigurasi MCP claude-flow/ruflo (dinonaktifkan Tahap 3, 2026-09-17)

Alasan nonaktif (prompt otonom, keputusan owner):
- Daemon ruflo tidak berjalan di mesin ini.
- Versi `@latest` tidak di-pin (melanggar garis merah 11: skill/plugin/MCP tanpa versi pin).
- `npx -y ruflo@latest` tiap spawn berisiko mengunduh versi baru & membakar kuota.

Konfigurasi dipindah dari `mcpServers` ke `_disabledMcpServers` di `.mcp.json`
(masih terbaca di file). Untuk mengembalikan: pindahkan blok `claude-flow`
dari `_disabledMcpServers` kembali ke `mcpServers`, dan PIN versinya
(mis. `ruflo@<versi>` alih-alih `ruflo@latest`).

Blok asli:

```json
"claude-flow": {
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "npx", "-y", "ruflo@latest", "mcp", "start"],
  "env": {
    "npm_config_update_notifier": "false",
    "CLAUDE_FLOW_MODE": "v3",
    "CLAUDE_FLOW_HOOKS_ENABLED": "true",
    "CLAUDE_FLOW_TOPOLOGY": "hierarchical-mesh",
    "CLAUDE_FLOW_MAX_AGENTS": "5",
    "CLAUDE_FLOW_MEMORY_BACKEND": "hybrid",
    "CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS": "1"
  }
}
```

Skill terkait: `ruflo` & `ruflo-doctor` tetap terpasang di Hermes (tidak
dihapus — hanya diusulkan dievaluasi di laporan).
