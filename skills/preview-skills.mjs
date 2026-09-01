#!/usr/bin/env node
// skills/preview-skills.mjs
// Tiny dispatcher helper: resolve + render the "Loaded skills" section for a
// (role, taskKind) pair against the real skill-index.json. Pure + offline.
//
//   node skills/preview-skills.mjs <role> <taskKind>
//   node skills/preview-skills.mjs HATTA telegram-bot-integration
//
// Prints the resolved object (JSON) followed by the formatted section block.
// No network, no Paperclip, no writes. Useful for AHMAD to preview what a task
// packet's skills section will contain before sealing the packet.

import { resolveSkillsForPacket, formatSkillsSection } from "./resolve-skills.mjs";

const [role, taskKind] = process.argv.slice(2);

if (!role || !taskKind) {
  console.error("usage: node skills/preview-skills.mjs <role> <taskKind>");
  console.error('example: node skills/preview-skills.mjs HATTA telegram-bot-integration');
  process.exit(2);
}

const resolved = resolveSkillsForPacket(role, taskKind);

console.log(`===== resolveSkillsForPacket(${JSON.stringify(role)}, ${JSON.stringify(taskKind)}) =====`);
console.log(JSON.stringify(resolved, null, 2));
console.log("");
console.log("----- formatted skills section -----");
console.log(formatSkillsSection(resolved));