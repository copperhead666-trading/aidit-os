'use strict';
// Loaded via `node --require` before any app code (currently: paperclip's PM2
// process). Windows only: child_process spawns a console window per call
// unless windowsHide:true is set on each individual call. paperclipai's
// compiled dist/index.js builds some subprocess args dynamically (a poller
// that repeatedly runs `git rev-parse`/`git status` against a project
// workspace), so those call sites can't be found or patched by grepping the
// bundle for literal argv strings, and any file-level patch is wiped by the
// next `npm update -g paperclipai` anyway. Patching child_process itself here
// is call-site-agnostic and survives package updates.
if (process.platform === 'win32') {
  const cp = require('child_process');
  const methods = ['exec', 'execFile', 'execSync', 'execFileSync', 'spawn', 'spawnSync'];
  for (const name of methods) {
    const original = cp[name];
    if (typeof original !== 'function') continue;
    cp[name] = function windowsHidePatched(...args) {
      for (const arg of args) {
        if (arg && typeof arg === 'object' && !Array.isArray(arg) && arg.windowsHide === undefined) {
          arg.windowsHide = true;
        }
      }
      return original.apply(this, args);
    };
  }
}
