import assert from 'node:assert/strict';
import { humanizeBytes } from './humanize.mjs';

assert.strictEqual(humanizeBytes(0), '0B');
assert.strictEqual(humanizeBytes(500), '500B');
assert.strictEqual(humanizeBytes(1024), '1.0KB');
assert.strictEqual(humanizeBytes(1536), '1.5KB');
assert.strictEqual(humanizeBytes(1048576), '1.0MB');
assert.strictEqual(humanizeBytes(1073741824), '1.0GB');

console.log('ALL PASS');