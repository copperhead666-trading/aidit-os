// ops-watcher/voice-in.mjs
// PRD v3 §5.17 T2c - VoiceBox 0.5.0 transcription provider.

import fs from 'node:fs/promises';
import path from 'node:path';
import { startVoicebox } from './voice-out.mjs';

export async function transcribe(audioFile, { provider = 'voicebox', deps = {} } = {}) {
  const now = deps.now || Date.now;
  const start = now();

  if (provider === 'off') return { ok: false, provider: 'off', ms: 0, reason: 'STT is off' };
  if (provider === 'whisper-cpp') return { ok: false, provider: 'whisper-cpp', ms: 0, reason: 'whisper-cpp provider not yet implemented' };
  if (provider !== 'voicebox') return { ok: false, provider, ms: 0, reason: `Unknown STT provider: ${provider}` };

  const ffmpegFn = deps.ffmpeg || defaultFfmpeg;
  const fetchFn = deps.fetch || globalThis.fetch;
  const parsed = path.parse(audioFile);
  const inputFormat = parsed.ext.replace(/^\./, '').toLowerCase() || 'unknown';
  const wavFile = path.join(parsed.dir, `${parsed.name}.wav`);

  const converted = await ffmpegFn(audioFile, wavFile);
  if (!converted?.ok) {
    return { ok: false, provider: 'voicebox', ms: now() - start, inputFormat, reason: 'ffmpeg audio-to-wav conversion failed' };
  }

  let serverHandle = null;
  try {
    const wav = await fs.readFile(wavFile);
    serverHandle = await (deps.startVoicebox || startVoicebox)(deps);

    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    const res = await fetchFn(`${serverHandle.baseUrl}/transcribe`, { method: 'POST', body: form });
    if (!res.ok) {
      return { ok: false, provider: 'voicebox', ms: now() - start, reason: `Transcribe returned status ${res.status}` };
    }

    const data = await res.json();
    return { ok: true, text: data.text || data.transcription || '', provider: 'voicebox', inputFormat, ms: now() - start };
  } catch (err) {
    return { ok: false, provider: 'voicebox', inputFormat, ms: now() - start, reason: err.message };
  } finally {
    if (serverHandle?.stop) await serverHandle.stop();
  }
}

async function defaultFfmpeg(inFile, outFile) {
  const { execSync } = await import('node:child_process');
  try {
    execSync(`ffmpeg -y -i "${inFile}" -ar 16000 -ac 1 -c:a pcm_s16le "${outFile}"`, {
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
