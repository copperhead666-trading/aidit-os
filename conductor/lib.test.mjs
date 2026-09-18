// node --test conductor/lib.test.mjs — pure logic, no live ledger/network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProtectedHours } from './lib.mjs';

// 2026-09-18 keputusan "Waktu terlindungi" (docs/DECISIONS.md): diam total
// 22.00-05.00 WIB setiap hari + Sabtu-Minggu sampai jam 10.00 WIB. Ini
// tercatat sejak awal tapi tidak pernah diimplementasikan sampai sesi ini.

test('isProtectedHours: 23:00 hari kerja -> protected', () => {
  assert.equal(isProtectedHours(new Date('2026-09-18T16:00:00Z')), true); // Jumat 23:00 WIB
});

test('isProtectedHours: 04:59 hari kerja -> protected', () => {
  assert.equal(isProtectedHours(new Date('2026-09-18T21:59:00Z')), true); // Sabtu 04:59 WIB
});

test('isProtectedHours: 12:00 hari kerja -> tidak protected', () => {
  assert.equal(isProtectedHours(new Date('2026-09-18T05:00:00Z')), false); // Jumat 12:00 WIB
});

test('isProtectedHours: Sabtu 08:00 -> protected (aturan akhir pekan)', () => {
  assert.equal(isProtectedHours(new Date('2026-09-19T01:00:00Z')), true); // Sabtu 08:00 WIB
});

test('isProtectedHours: Sabtu 11:00 -> tidak protected', () => {
  assert.equal(isProtectedHours(new Date('2026-09-19T04:00:00Z')), false); // Sabtu 11:00 WIB
});

test('isProtectedHours: Minggu 09:00 -> protected', () => {
  assert.equal(isProtectedHours(new Date('2026-09-20T02:00:00Z')), true); // Minggu 09:00 WIB
});

test('isProtectedHours: Senin 06:00 -> tidak protected (weekday, sudah lewat jam 05)', () => {
  assert.equal(isProtectedHours(new Date('2026-09-20T23:00:00Z')), false); // Senin 06:00 WIB
});
