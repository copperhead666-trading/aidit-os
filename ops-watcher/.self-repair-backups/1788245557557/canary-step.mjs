// canary-step.mjs
//
// This file exists ONLY as a safe target for self-repair drills. It is
// deliberately NOT part of the heartbeat STEPS list, it has no side effects,
// no dependencies, and no IO, so it is safe to break temporarily during a
// repair drill and then restore from a snapshot. A self-repair actuator may
// mutate this file, run its regression suite, and then roll it back without
// ever touching real production steps.
//
//   node ops-watcher/canary-step.mjs --once

export function canaryAdd(a, b) {
  return a + b;
}

export function canaryLabel() {
  return "canary-step OK";
}

function usage() {
  return "usage: node ops-watcher/canary-step.mjs --once";
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length !== 1 || argv[0] !== "--once") {
    console.error(usage());
    process.exit(2);
  }
  const a = 2;
  const b = 2;
  const sum = canaryAdd(a, b);
  console.log(`canary-step --once: ${a}+${b}=${sum} OK`);
  process.exit(0);
}

const isEntry = (() => {
  try {
    // resolve against argv[1] like the other ops-watcher entry scripts
    return process.argv[1] && process.argv[1].endsWith("canary-step.mjs");
  } catch {
    return false;
  }
})();

if (isEntry) {
  main();
}