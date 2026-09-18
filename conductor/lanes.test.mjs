// node --test conductor/lanes.test.mjs — no live model/lane calls, pure logic.
// instruksi-02 A.2: circuit breaker deterministik, 3x gagal 429/401
// berturut-turut -> resting 60 menit; error dengan jam reset eksplisit
// langsung resting. Test ini menulis ke state/lanes-status.json (dipakai
// Orkestrator yang berjalan) lewat kunci lane palsu, lalu membersihkannya
// di finally agar tidak mengganggu lane nyata.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { STATE, readJson, writeJson } from './lib.mjs';
import { recordLaneFailure, recordLaneSuccess, lanesStatus, CIRCUIT_BREAKER_THRESHOLD, isLaneActiveByDate, isUnauthorizedModel } from './lanes.mjs';

const STATUS_FILE = path.join(STATE, 'lanes-status.json');
const FAKE_LANE = '__test-only-circuit-breaker__';

function cleanupFakeLane() {
  const st = readJson(STATUS_FILE, { updatedAt: null, lanes: {} });
  if (st.lanes[FAKE_LANE]) {
    delete st.lanes[FAKE_LANE];
    writeJson(STATUS_FILE, st);
  }
}

after(cleanupFakeLane);

test('circuit breaker: rests only after 3 consecutive 429s, not sooner', () => {
  cleanupFakeLane();
  assert.equal(CIRCUIT_BREAKER_THRESHOLD, 3);

  let r = recordLaneFailure(FAKE_LANE, '429 rate limit');
  assert.equal(r.tripped, false);
  assert.equal(lanesStatus().lanes[FAKE_LANE].state, undefined); // not marked resting yet

  r = recordLaneFailure(FAKE_LANE, '429 rate limit');
  assert.equal(r.tripped, false);
  assert.equal(lanesStatus().lanes[FAKE_LANE].failCount, 2);

  r = recordLaneFailure(FAKE_LANE, '401 unauthorized');
  assert.equal(r.tripped, true);
  const s = lanesStatus().lanes[FAKE_LANE];
  assert.equal(s.state, 'resting');
  assert.ok(Date.parse(s.until) > Date.now());
  assert.equal(s.failCount, 0);

  cleanupFakeLane();
});

test('circuit breaker: a success in between resets the streak', () => {
  cleanupFakeLane();
  recordLaneFailure(FAKE_LANE, '429 rate limit');
  recordLaneFailure(FAKE_LANE, '429 rate limit');
  assert.equal(lanesStatus().lanes[FAKE_LANE].failCount, 2);

  recordLaneSuccess(FAKE_LANE);
  assert.equal(lanesStatus().lanes[FAKE_LANE].failCount, 0);

  const r1 = recordLaneFailure(FAKE_LANE, '429 rate limit');
  assert.equal(r1.tripped, false);
  assert.equal(lanesStatus().lanes[FAKE_LANE].failCount, 1);

  cleanupFakeLane();
});

test('circuit breaker: explicit reset time trips immediately (no 3x wait)', () => {
  cleanupFakeLane();
  const r = recordLaneFailure(FAKE_LANE, 'usage limit hit, try again at 23:59');
  assert.equal(r.tripped, true);
  assert.equal(lanesStatus().lanes[FAKE_LANE].state, 'resting');
  cleanupFakeLane();
});

// instruksi-06 s5: siklus hidup langganan lewat activeFrom/activeUntil.
test('isLaneActiveByDate: no dates set -> always active', () => {
  assert.equal(isLaneActiveByDate({}), true);
});

test('isLaneActiveByDate: activeFrom in the future -> not active yet', () => {
  const cfg = { activeFrom: '2026-09-19T23:00:00+07:00' };
  assert.equal(isLaneActiveByDate(cfg, Date.parse('2026-09-19T22:59:59+07:00')), false);
  assert.equal(isLaneActiveByDate(cfg, Date.parse('2026-09-19T23:00:01+07:00')), true);
});

test('isLaneActiveByDate: activeUntil in the past -> no longer active', () => {
  const cfg = { activeUntil: '2026-09-27T23:59:59+07:00' };
  assert.equal(isLaneActiveByDate(cfg, Date.parse('2026-09-27T23:59:58+07:00')), true);
  assert.equal(isLaneActiveByDate(cfg, Date.parse('2026-09-28T00:00:01+07:00')), false);
});

test('isLaneActiveByDate: both bounds -> only active inside the window', () => {
  const cfg = { activeFrom: '2026-09-19T00:00:00+07:00', activeUntil: '2026-09-27T00:00:00+07:00' };
  assert.equal(isLaneActiveByDate(cfg, Date.parse('2026-09-01T00:00:00+07:00')), false);
  assert.equal(isLaneActiveByDate(cfg, Date.parse('2026-09-20T00:00:00+07:00')), true);
  assert.equal(isLaneActiveByDate(cfg, Date.parse('2026-10-01T00:00:00+07:00')), false);
});

// 2026-09-18 incident: or-nemotron-free (free lane) got billed against
// qwen/qwen3-coder-next (disabled, paid) -- Hermes' own config.yaml
// fallback_providers cascaded past our lanes.json without telling us.
const FAKE_CFG = {
  lanes: {
    'or-nemotron-free': { model: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
    'or-deepseek-flash': { model: 'deepseek/deepseek-v4-flash' },
    'or-qwen-coder': { model: 'qwen/qwen3-coder-next', status: 'disabled' },
  },
};

test('isUnauthorizedModel: same model as the lane -> authorized', () => {
  assert.equal(isUnauthorizedModel(FAKE_CFG.lanes['or-nemotron-free'], 'nvidia/nemotron-3-ultra-550b-a55b:free', FAKE_CFG), false);
});

test('isUnauthorizedModel: a different but currently-enabled lane\'s model -> authorized', () => {
  assert.equal(isUnauthorizedModel(FAKE_CFG.lanes['or-nemotron-free'], 'deepseek/deepseek-v4-flash', FAKE_CFG), false);
});

test('isUnauthorizedModel: a disabled lane\'s model -> unauthorized (the actual incident)', () => {
  assert.equal(isUnauthorizedModel(FAKE_CFG.lanes['or-nemotron-free'], 'qwen/qwen3-coder-next', FAKE_CFG), true);
});

test('isUnauthorizedModel: a model that matches no lane at all -> unauthorized', () => {
  assert.equal(isUnauthorizedModel(FAKE_CFG.lanes['or-nemotron-free'], 'anthropic/claude-9-ultra', FAKE_CFG), true);
});
