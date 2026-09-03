import { NextResponse } from 'next/server';
import { resolveVerifiedPaperclip } from '@/lib/sources';

/**
 * The owner's answer to a waiting item, recorded for real.
 *
 * The comment prefixes are NOT free text: `ops-watcher/directive-runner.mjs`
 * matches `OWNER MENYETUJUI via Telegram` and `OWNER MENOLAK via Telegram`
 * literally, and a decision written any other way would be filed and then
 * ignored by the thing that acts on it. The cockpit IS the Telegram Mini App,
 * so the wording stays accurate; only the trailing sentence differs, and it
 * names the surface the tap actually came from.
 *
 * State changes mirror `telegram-listener.mjs` exactly:
 *   SETUJU — drop OWNER_REQUIRED so the automated flow may continue
 *   TOLAK  — status cancelled, drop OWNER_REQUIRED, add OWNER_REJECTED
 *   NANTI  — comment only, nothing moves
 *   REVISI — comment only; there is no runner contract for it, so it is
 *            recorded as a request and never claims execution
 *
 * Reached only through the middleware, so an unauthenticated POST never gets
 * here. Every failure answers with what actually happened rather than a
 * generic error: a decision that silently did not land is the worst outcome.
 */

export const dynamic = 'force-dynamic';

const AKSI = ['SETUJU', 'REVISI', 'TOLAK', 'NANTI'] as const;
type Aksi = (typeof AKSI)[number];

function isAksi(value: unknown): value is Aksi {
  return typeof value === 'string' && (AKSI as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function gagal(reason: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, reason }, { status });
}

async function json(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

/** What gets written on the issue, per action. */
function komentar(aksi: Aksi, stamp: string, alasan: string | null): string {
  const dari = 'ketukan tombol oleh owner di Cockpit (Telegram Mini App)';
  const ekor = alasan ? ` Alasan owner: ${alasan}` : '';
  if (aksi === 'SETUJU') {
    return `OWNER MENYETUJUI via Telegram (${stamp}) — ${dari}. Label OWNER_REQUIRED dihapus sehingga alur otomatis dapat dilanjutkan.${ekor}`;
  }
  if (aksi === 'TOLAK') {
    return `OWNER MENOLAK via Telegram (${stamp}) — ${dari}. Status diubah menjadi cancelled; label OWNER_REJECTED ditambahkan.${ekor}`;
  }
  if (aksi === 'NANTI') {
    return `OWNER MENUNDA via Telegram (${stamp}) — ${dari}. Tidak ada perubahan status; issue tetap menunggu keputusan.${ekor}`;
  }
  return `OWNER MINTA REVISI (${stamp}) — ${dari}. Rencananya belum disetujui: owner minta diubah dulu, dan tidak ada yang dieksekusi sampai rencana baru disetujui.${ekor}`;
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return gagal('badan permintaan tidak terbaca');
  }
  if (!isRecord(payload)) return gagal('badan permintaan tidak terbaca');

  const identifier = typeof payload.identifier === 'string' ? payload.identifier.trim() : '';
  const aksi = payload.action;
  const alasanRaw = typeof payload.alasan === 'string' ? payload.alasan.trim() : '';
  const alasan = alasanRaw.length > 0 ? alasanRaw.slice(0, 500) : null;

  if (identifier === '') return gagal('nomor perkara kosong');
  if (!isAksi(aksi)) return gagal('aksi tidak dikenal');

  const resolved = await resolveVerifiedPaperclip();
  if (resolved === null) {
    return gagal('papan kerja tidak terjangkau — keputusan Anda belum tercatat', 503);
  }
  const base = `http://127.0.0.1:${resolved.port}`;

  const issues = await json(`${base}/api/companies/${resolved.companyId}/issues`);
  if (!issues.ok || !Array.isArray(issues.body)) {
    return gagal('daftar perkara tidak terbaca — keputusan Anda belum tercatat', 503);
  }
  const issue = issues.body
    .filter(isRecord)
    .find((i) => i.identifier === identifier);
  if (!issue || typeof issue.id !== 'string') {
    return gagal(`${identifier} tidak ditemukan`, 404);
  }
  const issueId = issue.id;

  // Label ids are per-instance; resolve them rather than assuming.
  const labelsRes = await json(`${base}/api/companies/${resolved.companyId}/labels`);
  const labelMap = new Map<string, string>();
  if (labelsRes.ok && Array.isArray(labelsRes.body)) {
    for (const entry of labelsRes.body) {
      if (isRecord(entry) && typeof entry.id === 'string' && typeof entry.name === 'string') {
        labelMap.set(entry.name, entry.id);
      }
    }
  }

  // State first: a comment claiming a change that did not happen is the lie
  // this whole screen exists to avoid.
  let stateChanged = false;
  if (aksi === 'SETUJU' || aksi === 'TOLAK') {
    const current = new Set(Array.isArray(issue.labelIds) ? (issue.labelIds as string[]) : []);
    const required = labelMap.get('OWNER_REQUIRED');
    if (required) current.delete(required);

    const patch: Record<string, unknown> = { labelIds: [...current] };
    if (aksi === 'TOLAK') {
      const rejected = labelMap.get('OWNER_REJECTED');
      if (rejected) current.add(rejected);
      patch.labelIds = [...current];
      patch.status = 'cancelled';
    }

    const res = await json(`${base}/api/issues/${issueId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      return gagal(
        `papan kerja menolak perubahan (HTTP ${res.status}) — keputusan Anda belum tercatat`,
        502,
      );
    }
    stateChanged = true;
  }

  const posted = await json(`${base}/api/issues/${issueId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: komentar(aksi, new Date().toISOString(), alasan), authorType: 'user' }),
  });

  if (!posted.ok) {
    // Half-applied is a real state and the owner is told, not reassured.
    return NextResponse.json(
      {
        ok: false,
        reason: stateChanged
          ? 'status perkara sudah diubah, tapi catatan keputusannya gagal tersimpan'
          : 'keputusan Anda gagal tersimpan',
        stateChanged,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, identifier, action: aksi, stateChanged });
}
