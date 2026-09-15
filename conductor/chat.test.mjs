// node --test conductor/chat.test.mjs — no live model calls, pure logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyContext } from './chat.mjs';

test('classifyContext: code-shaped question', () => {
  assert.equal(classifyContext('kenapa deploy gagal, ada error di script build?'), 'code');
  assert.equal(classifyContext('bug di fungsi login'), 'code');
});

test('classifyContext: policy/memory-shaped question', () => {
  assert.equal(classifyContext('kenapa dulu kita putuskan pakai Codex?'), 'memory');
  assert.equal(classifyContext('ada catatan soal kebijakan cutover?'), 'memory');
});

test('classifyContext: plain question needs no extra lookup', () => {
  assert.equal(classifyContext('bagaimana keadaan sekarang?'), 'none');
  assert.equal(classifyContext('selamat pagi'), 'none');
});
