// conductor/guard.mjs — PreToolUse hook that confines a headless lane (Claude
// or Kimi CLI) to its task workspace. Carried from Aidit OS v4
// dispatch/claude-guard.mjs (probe 2026-09-12: --allowedTools grants, it does
// not confine; --restricted confines file tools; Bash is judged here).
// Bash may run exactly one `node <script.mjs> [args]` or `node --test <files>`
// with every path inside the workspace or the read-only design roots. No
// pipes, chains or redirects. Exit 2 = deny with the reason on stderr.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const READ_ONLY_ROOTS = ['scripts/design', 'docs/brand', 'config/persona'].map((p) => path.join(GATE_ROOT, p));
const SHELL_META = /[|&;<>`$]|\r|\n/;

const inside = (root, target) => {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const under = (roots, target) => roots.some((r) => inside(r, target));

function tokens(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// A token is treated as a path when it looks like one; flags and words pass.
const looksLikePath = (t) => /[\\/]/.test(t) || /\.(mjs|cjs|js|json|md|png|jpg|jpeg|svg|html|webm|txt|css|woff|ttf)$/i.test(t);

export function judgeBash(command, cwd) {
  const line = String(command || '').trim();
  if (!line) return 'empty command';
  if (SHELL_META.test(line)) return 'shell operators (| & ; < > ` $) are not allowed; run one node script per call';
  const argv = tokens(line);
  if (argv[0] !== 'node') return `only "node <script.mjs> [args]" may run here (got "${argv[0]}")`;
  // `node --test <files...>` runs the workspace's own regression suites — the
  // brief this hook exists to allow, not just deny. Every file argument is
  // still judged exactly like the single-script case below: it must be a
  // .mjs file inside the workspace or the read-only scripts/design root.
  if (argv[1] === '--test') {
    const files = argv.slice(2);
    if (!files.length) return 'node --test requires at least one .mjs file';
    for (const f of files) {
      if (f.startsWith('-')) return `node --test does not accept flags here: ${f}`;
      if (f.split(/[\\/]/).includes('..')) return `".." is not allowed in arguments: ${f}`;
      const target = path.resolve(cwd, f);
      if (!/\.mjs$/i.test(target)) return `node --test file must be a .mjs script: ${f}`;
      if (!under([path.join(GATE_ROOT, 'scripts', 'design'), cwd], target)) return `node --test file must live under ${path.join(GATE_ROOT, 'scripts', 'design')} or the workspace: ${target}`;
    }
    return null;
  }
  const script = argv[1] ? path.resolve(cwd, argv[1]) : '';
  // Workspace scripts (.mjs/.cjs/.js) and package binaries under the workspace's
  // node_modules (e.g. node node_modules/next/dist/bin/next build) are allowed;
  // that is how a lane runs build, typecheck and tests without npm/npx shims.
  const isPkgBin = /[\\/]node_modules[\\/].+[\\/](bin|dist)[\\/]/i.test(script);
  if (!script || (!/\.(mjs|cjs|js)$/i.test(script) && !isPkgBin)) return 'the first argument must be a .mjs/.cjs/.js script or a package binary under node_modules';
  if (!under([path.join(GATE_ROOT, 'scripts', 'design'), cwd], script)) return `script must live under ${path.join(GATE_ROOT, 'scripts', 'design')} or the workspace: ${script}`;
  for (const t of argv.slice(2)) {
    if (!looksLikePath(t)) continue;
    if (t.split(/[\\/]/).includes('..')) return `".." is not allowed in arguments: ${t}`;
    const target = path.resolve(cwd, t);
    if (inside(cwd, target)) continue;
    if (under(READ_ONLY_ROOTS, target)) continue;
    return `argument escapes the workspace: ${t} -> ${target}`;
  }
  return null;
}

export function judgeFileTool(input, cwd) {
  const file = input && (input.file_path || input.notebook_path || input.path);
  if (!file) return null;
  const target = path.resolve(cwd, String(file));
  return inside(cwd, target) ? null : `file tool may only touch the workspace: ${target}`;
}

// Tool names that write files, across both runtimes this hook now guards:
// Claude Code (Write/Edit/MultiEdit/NotebookEdit) and Kimi Code
// (WriteFile/EditFile/Write/Edit/StrReplace). All are judged the same way,
// on whichever of file_path/notebook_path/path the tool_input carries.
const FILE_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WriteFile', 'EditFile', 'StrReplace']);
// Shell tool names across both runtimes: Claude's Bash/PowerShell, Kimi's Shell.
const SHELL_TOOL_NAMES = new Set(['Bash', 'PowerShell', 'Shell']);

// judgeTool({ tool_name, tool_input, cwd }) -> reason string | null. The single
// entry point main() uses, and the one dispatch/probe-agent.mjs and the
// acceptance tests exercise directly without going through stdin/JSON.
export function judgeTool({ tool_name, tool_input, cwd }) {
  const name = String(tool_name || '');
  const input = tool_input || {};
  const dir = path.resolve(cwd || process.cwd());
  if (SHELL_TOOL_NAMES.has(name)) return judgeBash(input.command, dir);
  if (FILE_TOOL_NAMES.has(name)) return judgeFileTool(input, dir);
  return null;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let hook;
  try { hook = JSON.parse(raw); } catch { console.error('claude-guard: unreadable hook payload'); process.exit(2); }
  const cwd = path.resolve(hook.cwd || process.cwd());
  const name = String(hook.tool_name || '');
  const reason = judgeTool({ tool_name: name, tool_input: hook.tool_input || {}, cwd });
  if (reason) { console.error(`claude-guard DENIED ${name}: ${reason}`); process.exit(2); }
}

// Prompt Matrix (Tahap 3, 2026-09-17 — docs/standards/PROMPT_MATRIX.md):
// setiap packet dispatch wajib memuat 8 unsur. Validator sederhana: cek
// penanda per unsur di teks packet akhir (header Inggris dari packetText
// atau label Indonesia dari template). Dipakai lanes.mjs untuk menolak
// dispatch yang tidak lengkap.
const PROMPT_MATRIX_MARKERS = [
  ['peran', /# Role\b|PERAN:/i],
  ['tujuan', /# Task\b|TUJUAN:/i],
  ['konteks', /# Context\b|KONTEKS:/i],
  ['batasan', /BATASAN:|Never touch credentials|Do not push/i],
  ['langkah', /LANGKAH:|^\s*1[\).]/m],
  ['format output', /# Output contract\b|FORMAT OUTPUT:/i],
  ['kriteria selesai', /KRITERIA SELESAI:|exit criterion|how it was verified/i],
  ['eskalasi', /ESKALASI:|what remains/i],
];
export function validatePromptMatrix(text) {
  const t = String(text || '');
  const missing = PROMPT_MATRIX_MARKERS.filter(([, re]) => !re.test(t)).map(([name]) => name);
  return { ok: missing.length === 0, missing };
}

const isEntry = (() => { try { return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isEntry) main().catch((err) => { console.error(`claude-guard: ${err && err.message}`); process.exit(2); });
