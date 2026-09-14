// ops-watcher/voice-out.mjs
// PRD v3 §5.17 T2c - VoiceBox 0.5.0 async TTS provider.

import fs from 'node:fs/promises';
import path from 'node:path';

export const EN_PIPER_MODEL = 'en_GB-alan-medium';

function piperModelPath(env, model) {
  return path.join(env.LOCALAPPDATA || path.join(process.cwd(), 'state'), 'AiditOS', 'piper', `${model}.onnx`);
}

export function chooseProvider(env, probeState, opts) {
  const language = opts?.language;
  const explicit = env.TTS_PROVIDER;
  if (explicit === 'off') return 'off';
  if (language === 'en' && explicit === 'piper') {
    return { provider: 'piper', model: piperModelPath(env, EN_PIPER_MODEL) };
  }
  // English spoken channel: prefer VoiceBox Kokoro bm_george (male JARVIS),
  // fall back to the installed male Piper en_GB-alan-medium model. The policy
  // acceptance fixture still mentions "alba" in one historical label, but alba
  // must remain test-only alias text and never be selected at runtime.
  if (language === 'en') {
    if (probeState?.voicebox?.verdict === 'pass') return { provider: 'voicebox' };
    if (explicit === 'elevenlabs') return 'elevenlabs';
    if (explicit === 'voicebox') return { provider: 'piper', model: piperModelPath(env, EN_PIPER_MODEL) };
    return { provider: 'piper', model: piperModelPath(env, EN_PIPER_MODEL) };
  }
  // Default (Indonesian) path — backward compatible
  if (env.REGISTER_LANGUAGE === 'id' || probeState?.register?.language === 'id') return 'piper';
  if (explicit === 'elevenlabs') return 'elevenlabs';
  if (explicit === 'piper') return 'piper';
  if (probeState?.voicebox?.verdict === 'pass') return 'voicebox';
  if (explicit === 'voicebox') return 'piper';
  return 'piper';
}

export async function synthesize(text, { provider, model = null, deps = {} } = {}) {
  if (model && !deps.model) deps = { ...deps, model };
  const now = deps.now || Date.now;
  const start = now();
  const chars = text.length;

  if (provider === 'off') return { ok: false, provider: 'off', chars, ms: 0, reason: 'TTS is off' };
  if (provider === 'piper') return synthesizePiper(text, { start, chars, deps });
  if (provider === 'elevenlabs') return { ok: false, provider: 'elevenlabs', chars, ms: 0, reason: 'ElevenLabs provider not yet implemented' };
  if (provider !== 'voicebox') return { ok: false, provider: provider || 'unknown', chars, ms: 0, reason: `Unknown provider: ${provider}` };

  const outDir = deps.outDir || path.join(process.cwd(), 'state', 'voice');
  let serverHandle = null;
  try {
    await fs.mkdir(outDir, { recursive: true });
    serverHandle = await (deps.startVoicebox || startVoicebox)(deps);
    const fetchFn = deps.fetch || globalThis.fetch;
    const ffmpegFn = deps.ffmpeg || defaultFfmpeg;
    const profileId = await ensureVoiceboxProfile(serverHandle.baseUrl, fetchFn, deps);

    const generate = await fetchFn(`${serverHandle.baseUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId, text, language: 'en', engine: 'kokoro' }),
    });
    if (!generate.ok) {
      return { ok: false, provider: 'voicebox', chars, ms: Date.now() - start, reason: `Generate returned status ${generate.status}` };
    }

    const job = await generate.json();
    if (!job?.id) {
      return { ok: false, provider: 'voicebox', chars, ms: Date.now() - start, reason: 'Generate did not return a job id' };
    }

    const wav = await waitForVoiceboxAudio(`${serverHandle.baseUrl}/audio/${encodeURIComponent(job.id)}`, fetchFn, deps);
    const wavFile = path.join(outDir, `tts-${Date.now()}.wav`);
    const oggFile = wavFile.replace(/\.wav$/i, '.ogg');
    await fs.writeFile(wavFile, wav);

    const converted = await ffmpegFn(wavFile, oggFile);
    if (!converted?.ok) {
      return { ok: false, provider: 'voicebox', chars, ms: Date.now() - start, reason: 'ffmpeg conversion failed' };
    }

    await countChars(chars, provider, deps);
    return { ok: true, file: oggFile, provider: 'voicebox', chars, ms: now() - start };
  } catch (err) {
    return { ok: false, provider: 'voicebox', chars, ms: Date.now() - start, reason: err.message };
  } finally {
    if (serverHandle?.stop) await serverHandle.stop();
  }
}

async function synthesizePiper(text, { start, chars, deps }) {
  const outDir = deps.outDir || path.join(process.cwd(), 'state', 'voice');
  const now = deps.now || Date.now;
  const outFile = path.join(outDir, `tts-piper-${now()}.wav`);
  const model = deps.model || path.join(process.env.LOCALAPPDATA || path.join(process.cwd(), 'state'), 'AiditOS', 'piper', 'id_ID-news_tts-medium.onnx');
  const voice = deps.voice || (/en_GB-alan-medium\.onnx$/i.test(model) ? 'en_GB' : 'id_ID');
  const binary = deps.binary || path.join(process.env.LOCALAPPDATA || path.join(process.cwd(), 'state'), 'AiditOS', 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper');
  if (deps.dryRun) return { ok: false, provider: 'piper', voice, chars, ms: now() - start, reason: 'Piper dry-run only', model };
  try {
    await fs.mkdir(outDir, { recursive: true });
    const spawn = deps.spawn || (await import('node:child_process')).spawn;
    const ok = await new Promise((resolve) => {
      const child = spawn(binary, ['--model', model, '--output_file', outFile], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
      child.stdin.end(text);
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
    if (!ok) return { ok: false, provider: 'piper', voice, chars, ms: now() - start, reason: 'Piper failed' };
    // Telegram voice notes need ogg/opus; Piper only writes wav.
    const oggFile = outFile.replace(/\.wav$/i, '.ogg');
    const converted = await (deps.ffmpeg || defaultFfmpeg)(outFile, oggFile);
    if (!converted?.ok) return { ok: false, provider: 'piper', voice, chars, ms: now() - start, reason: 'ffmpeg conversion failed' };
    await countChars(chars, 'piper', deps);
    return { ok: true, file: oggFile, provider: 'piper', voice, chars, ms: now() - start };
  } catch (err) {
    return { ok: false, provider: 'piper', voice, chars, ms: now() - start, reason: err.message };
  }
}

async function countChars(chars, provider, deps) {
  const budgetFile = deps.budgetFile || path.join(process.cwd(), 'state', 'voice', 'voice-budget.json');
  const now = deps.now ? new Date(deps.now()) : new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let budget = await readJson(budgetFile, {});
  if (budget.month !== month) budget = { month, chars: 0, byProvider: {} };
  budget.chars = (budget.chars || 0) + chars;
  budget.byProvider = budget.byProvider || {};
  budget.byProvider[provider] = (budget.byProvider[provider] || 0) + chars;

  await fs.mkdir(path.dirname(budgetFile), { recursive: true });
  await fs.writeFile(budgetFile, JSON.stringify(budget, null, 2), 'utf8');
}

export async function startVoicebox(deps = {}) {
  const { spawn, spawnSync } = await import('node:child_process');
  const { setTimeout: sleep } = await import('node:timers/promises');
  const probeFile = deps.probeFile || path.join(process.cwd(), 'state', 'voice', 'probe.json');
  const probe = await readJson(probeFile, {});
  const exe = probe.voicebox?.exe;
  if (!exe) throw new Error('No VoiceBox exe found in probe state');

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = spawn(exe, ['--port', String(port)], {
    cwd: path.dirname(exe),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: false,
  });

  const log = deps.log || (() => {});
  const healthStart = Date.now();
  const deadline = healthStart + (deps.healthTimeoutMs || 240_000);
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      const body = await res.json();
      if (body?.status === 'healthy' || body?.status === 'ok') {
        healthy = true;
        log(`voice-out: VoiceBox health check passed in ${Date.now() - healthStart}ms`);
        break;
      }
    } catch {
      // Server is still importing torch or binding the port.
    }
    await sleep(1000);
  }

  if (!healthy) {
    try { proc.kill(); } catch {}
    log(`voice-out: VoiceBox health check timed out after ${Date.now() - healthStart}ms`);
    throw new Error('VoiceBox health check timed out');
  }

  return {
    baseUrl,
    stop: async () => {
      if (process.platform === 'win32' && proc.pid) {
        spawnSync('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true });
      } else {
        try { proc.kill(); } catch {}
        await sleep(1000);
        try { proc.kill('SIGKILL'); } catch {}
      }
    },
  };
}

async function ensureVoiceboxProfile(baseUrl, fetchFn, deps) {
  const probeFile = deps.probeFile || path.join(process.cwd(), 'state', 'voice', 'probe.json');
  const probe = await readJson(probeFile, {});
  if (probe.voicebox?.profileId) return probe.voicebox.profileId;

  const existing = await fetchFn(`${baseUrl}/profiles`);
  if (!existing.ok) throw new Error(`Profiles returned status ${existing.status}`);
  const profiles = await existing.json();
  let profile = Array.isArray(profiles) ? profiles.find(p => p?.name === 'JARVIS') : null;

  if (!profile?.id) {
    const created = await fetchFn(`${baseUrl}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'JARVIS',
        description: 'Aidit OS JARVIS Kokoro voice profile',
        language: 'en',
        voice_type: 'preset',
        preset_engine: 'kokoro',
        preset_voice_id: 'bm_george',
        default_engine: 'kokoro',
      }),
    });
    if (!created.ok) throw new Error(`Create profile returned status ${created.status}`);
    profile = await created.json();
  }

  if (!profile?.id) throw new Error('VoiceBox profile has no id');
  probe.voicebox = { ...(probe.voicebox || {}), profileId: profile.id };
  await fs.mkdir(path.dirname(probeFile), { recursive: true });
  await fs.writeFile(probeFile, JSON.stringify(probe, null, 2), 'utf8');
  return profile.id;
}

async function waitForVoiceboxAudio(url, fetchFn, deps) {
  const { setTimeout: sleep } = await import('node:timers/promises');
  const pollMs = deps.pollMs || 1000;
  const deadline = Date.now() + (deps.maxWaitMs || 180_000);
  while (Date.now() < deadline) {
    const res = await fetchFn(url);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 404) throw new Error(`Audio returned status ${res.status}`);
    await sleep(pollMs);
  }
  throw new Error('Audio timed out waiting for VoiceBox generation');
}

async function freePort() {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function defaultFfmpeg(inFile, outFile) {
  const { execSync } = await import('node:child_process');
  try {
    execSync(`ffmpeg -y -loglevel error -i "${inFile}" -c:a libopus -b:a 32k "${outFile}"`, {
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
