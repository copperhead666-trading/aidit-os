// ops-watcher/ruflo-lane-context.mjs
// Tiny Ruflo support helpers for lane wrappers. This does not start Ruflo and
// does not assume every lane is an MCP client; it only carries compact context.

export const RUFLO_LANE_ENV = Object.freeze({
  CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS: "1",
  CLAUDE_FLOW_MCP_TOOLS: "memory,hooks,swarm,agent",
});

const PRELUDES = Object.freeze({
  hatta: [
    "Ruflo context: HATTA has no native MCP client in this Ollama harness.",
    "Use only supplied Ruflo context and allowed workspace tools; do not start daemons, install packages, or widen tool access.",
  ],
  sjahrir: [
    "Ruflo context: SJAHRIR must not assume native MCP unless the wrapper proves it.",
    "Use supplied Ruflo context as routing/memory hints only; do not start daemons, install packages, or write outside the assigned worktree.",
  ],
  gibran: [
    "Ruflo context: GIBRAN is review-only.",
    "Use supplied Ruflo context only as review background; never coordinate writes, mutate files, start daemons, or self-approve implementation.",
  ],
});

export function rufloLaneEnv() {
  return { ...RUFLO_LANE_ENV };
}

export function mergeRufloLaneEnv(baseEnv = {}) {
  const env = { ...baseEnv };
  for (const [key, value] of Object.entries(RUFLO_LANE_ENV)) {
    if (env[key] === undefined) env[key] = value;
  }
  return env;
}

export function buildRufloLanePrelude(lane) {
  const key = String(lane || "").trim().toLowerCase();
  const lines = PRELUDES[key] || [
    "Ruflo context: use supplied routing/memory hints only.",
    "Do not start daemons, install packages, or widen tool access unless the packet explicitly permits it.",
  ];
  return ["[RUFLO LANE CONTEXT]", ...lines, "[/RUFLO LANE CONTEXT]"].join("\n");
}

export function withRufloLanePrelude(lane, prompt) {
  const body = String(prompt ?? "");
  if (body.includes("[RUFLO LANE CONTEXT]")) return body;
  return `${buildRufloLanePrelude(lane)}\n\n${body}`;
}
