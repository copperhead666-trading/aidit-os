// ops-watcher/ventures-registry.mjs
//
// Repository-bound reader/writer for config/ventures.json. The registry's own
// rules are enforced here before any write reaches disk.

import { promises as realFs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const DEFAULT_VENTURES_FILE = path.join(ROOT, "config", "ventures.json");

function resolveDeps(deps = {}) {
  return {
    _fs: deps._fs || realFs,
    file: deps.file || DEFAULT_VENTURES_FILE,
    tmpSuffix: deps.tmpSuffix || `${process.pid}-${Date.now()}`,
  };
}

function errText(err) {
  return err && err.stack ? err.stack : String(err);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hardStopCarriesSource(stop) {
  if (typeof stop === "string") {
    return /\([^()]*\S[^()]*\)/.test(stop);
  }
  if (!isPlainObject(stop)) return false;
  return ["source", "sumber", "line", "citation"].some((key) => hasText(stop[key]));
}

export async function readVenturesRegistry(deps = {}) {
  const { _fs, file } = resolveDeps(deps);
  let raw;
  try {
    raw = await _fs.readFile(file, "utf8");
  } catch (err) {
    return { ok: false, registry: null, ventures: [], reason: `read failed: ${errText(err)}` };
  }

  let registry;
  try {
    registry = JSON.parse(raw);
  } catch (err) {
    return { ok: false, registry: null, ventures: [], reason: `malformed JSON: ${err.message}` };
  }

  if (!isPlainObject(registry)) {
    return { ok: false, registry: null, ventures: [], reason: "registry is not an object" };
  }
  if (!Array.isArray(registry.ventures)) {
    return { ok: false, registry, ventures: [], reason: "registry.ventures is not an array" };
  }

  return { ok: true, registry, ventures: registry.ventures, reason: null };
}

export function validateVenture(venture) {
  const problems = [];
  const id = hasText(venture?.id) ? venture.id.trim() : "<unknown>";
  const label = `venture ${id}`;

  if (!isPlainObject(venture)) {
    return ["venture is not an object"];
  }

  if (!hasText(venture.id)) {
    problems.push(`${label}: id must be a non-empty string`);
  }

  if (!Object.prototype.hasOwnProperty.call(venture, "status")) {
    problems.push(`${label}: status is required`);
  }

  if (hasText(venture.tujuan) && !hasText(venture.tujuan_sumber)) {
    problems.push(`${label}: tujuan rule failed - tujuan must carry a non-empty tujuan_sumber`);
  }

  if (hasText(venture.metrik) && !hasText(venture.metrik_sumber)) {
    problems.push(`${label}: metrik rule failed - non-empty metrik must carry a non-empty metrik_sumber`);
  }

  if (Object.prototype.hasOwnProperty.call(venture, "metrik_terakhir")) {
    const last = venture.metrik_terakhir;
    if (!isPlainObject(last)) {
      problems.push(`${label}: metrik_terakhir must be an object`);
    } else {
      for (const key of ["nilai", "dari", "pada", "sumber"]) {
        if (!Object.prototype.hasOwnProperty.call(last, key)) {
          problems.push(`${label}: metrik_terakhir must include ${key}`);
        }
      }
      if (Object.prototype.hasOwnProperty.call(last, "nilai") && last.nilai !== null && typeof last.nilai !== "number") {
        problems.push(`${label}: metrik_terakhir.nilai must be null or a number; numeric strings are not coerced`);
      }
      if (!hasText(last.sumber)) {
        problems.push(`${label}: metrik_terakhir.sumber must be non-empty`);
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(venture, "hardStops")) {
    if (!Array.isArray(venture.hardStops)) {
      problems.push(`${label}: hardStops must be an array when present`);
    } else {
      venture.hardStops.forEach((stop, index) => {
        if (!hardStopCarriesSource(stop)) {
          problems.push(`${label}: hardStops[${index}] must carry its source`);
        }
      });
    }
  }

  return problems;
}

export function validateVentures(ventures) {
  if (!Array.isArray(ventures)) return ["ventures must be an array"];
  return ventures.flatMap((venture) => validateVenture(venture));
}

async function ensureDir(_fs, file) {
  if (typeof _fs.mkdir !== "function") return;
  await _fs.mkdir(path.dirname(file), { recursive: true });
}

async function writeBesideAndRename({ _fs, file, tmpSuffix, text }) {
  const tmp = `${file}.tmp-${tmpSuffix}`;
  await ensureDir(_fs, file);
  await _fs.writeFile(tmp, text, "utf8");
  await _fs.rename(tmp, file);
}

export async function writeVenturesRegistry(ventures, deps = {}) {
  const d = resolveDeps(deps);
  const problems = validateVentures(ventures);
  if (problems.length > 0) {
    return { ok: false, written: false, problems, reason: problems.join("; ") };
  }

  const current = await readVenturesRegistry(d);
  if (!current.ok) {
    return { ok: false, written: false, problems: [current.reason], reason: current.reason };
  }

  const next = { ...current.registry, ventures };
  const text = `${JSON.stringify(next, null, 2)}\n`;

  try {
    await writeBesideAndRename({ ...d, text });
    return { ok: true, written: true, problems: [], reason: null };
  } catch (err) {
    return { ok: false, written: false, problems: [`write failed: ${errText(err)}`], reason: `write failed: ${errText(err)}` };
  }
}
