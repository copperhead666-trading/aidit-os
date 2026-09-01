import assert from 'node:assert';
import { retry } from './retry.mjs';

let calls = 0;
async function alwaysFails() {
  calls++;
  throw new Error('fail ' + calls);
}

try {
  await retry(alwaysFails, { maxRetries: 5 });
  throw new Error('should have thrown');
} catch (err) {
  assert.strictEqual(calls, 5, `expected 5 attempts with maxRetries override, got ${calls}`);
}

calls = 0;
try {
  await retry(alwaysFails);
  throw new Error('should have thrown');
} catch (err) {
  assert.strictEqual(calls, 3, `expected default 3 attempts, got ${calls}`);
}

console.log('ALL PASS');
