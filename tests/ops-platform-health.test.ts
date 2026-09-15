import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { probeDashboard, checkTelegramHeartbeat } from '../conductor/ops.mjs';

describe('AID-35: platform health probes', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  describe('probeDashboard', () => {
    test('returns ok:true with status when dashboard responds 200', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as any);
      const r = await probeDashboard('http://localhost:9999/test');
      expect(r.ok).toBe(true);
      expect(r.status).toBe(200);
    });

    test('returns ok:false on network error (adversarial: dashboard down)', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
      const r = await probeDashboard('http://localhost:9999/test');
      expect(r.ok).toBe(false);
      expect(r.error).toBeTruthy();
    });

    test('returns ok:false on non-200 status (adversarial: dashboard unhealthy)', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as any);
      const r = await probeDashboard('http://localhost:9999/test');
      expect(r.ok).toBe(false);
      expect(r.status).toBe(503);
    });
  });

  describe('checkTelegramHeartbeat', () => {
    let dirs: string[] = [];
    afterEach(() => { for (const d of dirs) { try { rmSync(d, { recursive: true }); } catch {} } dirs = []; });

    test('returns ok:true with ageSec when heartbeat file is fresh', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'aid35-hb-'));
      dirs.push(dir);
      const file = path.join(dir, 'telegram-heartbeat.json');
      writeFileSync(file, JSON.stringify({ ts: new Date().toISOString() }));
      const r = checkTelegramHeartbeat(file);
      expect(r.ok).toBe(true);
      expect(typeof r.ageSec).toBe('number');
      expect(r.ageSec!).toBeGreaterThanOrEqual(0);
    });

    test('returns ok:false when heartbeat file is missing (adversarial: loop never started)', () => {
      const r = checkTelegramHeartbeat(path.join(tmpdir(), `no-such-${Date.now()}.json`));
      expect(r.ok).toBe(false);
      expect(r.ageSec).toBeNull();
    });

    test('returns ok:false when heartbeat file has no ts field (adversarial: corrupt file)', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'aid35-hb-'));
      dirs.push(dir);
      const file = path.join(dir, 'telegram-heartbeat.json');
      writeFileSync(file, JSON.stringify({ wrong: 'field' }));
      const r = checkTelegramHeartbeat(file);
      expect(r.ok).toBe(false);
      expect(r.ageSec).toBeNull();
    });

    test('returns ok:false when ts is malformed (adversarial: invalid date)', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'aid35-hb-'));
      dirs.push(dir);
      const file = path.join(dir, 'telegram-heartbeat.json');
      writeFileSync(file, JSON.stringify({ ts: 'not-a-date' }));
      const r = checkTelegramHeartbeat(file);
      expect(r.ok).toBe(false);
      expect(r.ageSec).toBeNull();
    });
  });
});
