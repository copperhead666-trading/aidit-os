import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readIssues, type IssueSummary } from '@/lib/sources';

export type InboxState = 'needs-you' | 'awaiting-your-approval' | 'working' | 'stuck' | 'done';

export interface InboxItem {
  identifier: string;
  title: string;
  state: InboxState;
  reason: string;
  action: string;
  sinceIso: string | null;
  attempts: number;
}

interface IssueComment {
  body: string;
  createdAt: string;
}

interface PaperclipConfig {
  primary_endpoint: { port: number };
  discovery_strategy: { candidate_ports: number[] };
  canonical_identity: { backup_dir_fingerprint: string };
}

const MAX_ISSUES = 40;

const STATE_ORDER: Record<InboxState, number> = {
  'needs-you': 0,
  'awaiting-your-approval': 1,
  stuck: 2,
  working: 3,
  done: 4,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseConfig(json: unknown): PaperclipConfig | null {
  if (!isRecord(json)) return null;
  const primary = json.primary_endpoint;
  const discovery = json.discovery_strategy;
  const canonical = json.canonical_identity;
  if (!isRecord(primary) || !isRecord(discovery) || !isRecord(canonical)) return null;

  const port = primary.port;
  const candidatePortsRaw = discovery.candidate_ports;
  const fingerprint = canonical.backup_dir_fingerprint;

  if (typeof port !== 'number') return null;
  if (!Array.isArray(candidatePortsRaw)) return null;
  if (typeof fingerprint !== 'string') return null;

  const candidatePorts = candidatePortsRaw.filter((p): p is number => typeof p === 'number');

  return {
    primary_endpoint: { port },
    discovery_strategy: { candidate_ports: candidatePorts },
    canonical_identity: { backup_dir_fingerprint: fingerprint },
  };
}

async function readConfig(): Promise<PaperclipConfig | null> {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, '..', '..');
    const configPath = path.join(repoRoot, 'config', 'paperclip-endpoint.json');
    const raw = await readFile(configPath, 'utf8');
    const json: unknown = JSON.parse(raw);
    return parseConfig(json);
  } catch {
    return null;
  }
}

async function checkHealth(port: number, fingerprint: string): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    if (!res.ok) return false;
    const json: unknown = await res.json();
    if (!isRecord(json)) return false;
    const backup = json.databaseBackup;
    if (!isRecord(backup)) return false;
    const backupDir = backup.backupDir;
    return typeof backupDir === 'string' && backupDir === fingerprint;
  } catch {
    return false;
  }
}

export async function resolveBaseUrl(): Promise<string | null> {
  try {
    const config = await readConfig();
    if (!config) return null;

    const ports = [config.primary_endpoint.port, ...config.discovery_strategy.candidate_ports];
    const seen = new Set<number>();

    for (const port of ports) {
      if (seen.has(port)) continue;
      seen.add(port);
      if (await checkHealth(port, config.canonical_identity.backup_dir_fingerprint)) {
        return `http://localhost:${port}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function parseComments(json: unknown): IssueComment[] | null {
  if (!Array.isArray(json)) return null;
  const result: IssueComment[] = [];
  for (const entry of json) {
    if (!isRecord(entry)) continue;
    const body = entry.body;
    const createdAt = entry.createdAt;
    if (typeof body === 'string' && typeof createdAt === 'string') {
      result.push({ body, createdAt });
    }
  }
  return result;
}

async function fetchComments(baseUrl: string, identifier: string): Promise<IssueComment[] | null> {
  try {
    const res = await fetch(`${baseUrl}/api/issues/${encodeURIComponent(identifier)}/comments`);
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return parseComments(json);
  } catch {
    return null;
  }
}

function translateFailureReason(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'verify-out-of-scope') {
    return 'perintah verifikasi di rencana ini di luar batas aman, jadi sistem menolak menjalankannya';
  }
  if (trimmed === 'file-scope-out-of-scope') {
    return 'rencana ini menyentuh berkas di luar batas yang diizinkan, jadi sistem menolak menjalankannya';
  }
  if (trimmed === 'parse-failed') {
    return 'AHMAD gagal menyusun rencana dalam bentuk yang bisa dibaca sistem, jadi tidak ada yang dijalankan';
  }
  if (trimmed === 'plan is too short') {
    return 'AHMAD tidak berhasil menyusun rencana yang cukup lengkap untuk dijalankan';
  }
  if (trimmed === 'snapshot-failed') {
    return 'salinan aman berkas gagal dibuat, jadi tidak ada yang diubah dan tidak ada yang hilang';
  }
  if (trimmed === 'verify-red') {
    return 'perubahan sempat dijalankan tapi verifikasinya sendiri gagal, jadi semua dikembalikan seperti semula';
  }
  if (trimmed === 'scoped-suite-red') {
    return 'uji coba yang lebih sempit gagal, jadi semua dikembalikan seperti semula';
  }
  if (trimmed === 'full-suite-red') {
    return 'uji cobanya sendiri lolos tapi uji coba yang lebih luas gagal, jadi semua dikembalikan seperti semula';
  }
  if (trimmed === 'cooldown') {
    return 'semua jalur kerja sedang penuh sesaat, ini akan pulih sendiri tanpa perlu tindakan apa pun';
  }
  if (trimmed === 'lane-quota') {
    return 'jatah jalur kerja sedang habis sesaat, ini akan pulih sendiri tanpa perlu tindakan apa pun';
  }
  if (trimmed === 'envelope') {
    return 'perubahan ini di luar batas aman sistem, jadi tidak pernah dicoba dan tidak ada yang berubah';
  }
  if (trimmed === 'unknown-lane') {
    return 'jalur kerja yang dituju tidak ditemukan, jadi tidak ada yang dijalankan';
  }
  if (trimmed === 'unknown') {
    return 'sistem sendiri tidak bisa memastikan sebabnya';
  }
  return `Ini alasan internal yang halaman ini belum bisa terjemahkan (bukan tindakan yang perlu lo lakukan): ${raw.trim()}`;
}

function normalizeReason(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').replace(/\.$/, '');
}

function extractFailureReason(body: string): string {
  const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

  // 1. Prefer an explicit `Alasan: <reason>` segment, taking the text up to the
  //    following period. This is the most stable signal for repeated failures.
  const alasanIdx = body.indexOf('Alasan:');
  if (alasanIdx !== -1) {
    const after = body.slice(alasanIdx + 'Alasan:'.length);
    const stop = after.indexOf('.');
    const reason = normalizeReason(stop === -1 ? after : after.slice(0, stop));
    if (reason) return reason;
  }

  // 2. Otherwise prefer a parenthesised group that is NOT an ISO-8601
  //    timestamp. The real comments lead with a `(YYYY-MM-DDTHH:mm:ss.sssZ)`
  //    timestamp; that must not become the grouping key.
  const parenRegex = /\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = parenRegex.exec(body)) !== null) {
    const inner = match[1].trim();
    if (!ISO_TIMESTAMP.test(inner)) {
      const reason = normalizeReason(inner);
      if (reason) return reason;
    }
  }

  // 3. Otherwise fall back to the remaining text with every ISO-8601 timestamp
  //    and every `Percobaan N/M` counter stripped out, so two repeats of the
  //    same failure produce the same string.
  const stripped = body
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '')
    .replace(/Percobaan\s+\d+\/\d+/g, '');
  return normalizeReason(stripped) || normalizeReason(body);
}

function classifyIssue(issue: IssueSummary, comments: IssueComment[]): InboxItem | null {
  const isDone = comments.some((c) => c.body.includes('DIRECTIVE RESULT'));
  if (issue.status === 'done' || isDone) return null;

  if (issue.ownerRequired) {
    return {
      identifier: issue.identifier,
      title: issue.title,
      state: 'needs-you',
      reason: 'Ada keputusan yang nunggu persetujuan lo.',
      action: 'Ketuk SETUJUI atau TOLAK pada kartu di Telegram.',
      sinceIso: issue.updatedAt,
      attempts: 0,
    };
  }

  const failureComments = comments.filter(
    (c) => c.body.includes('DIRECTIVE GAGAL') || c.body.includes('DIRECTIVE DRAFT FAILED'),
  );
  const groups = new Map<string, IssueComment[]>();
  for (const c of failureComments) {
    const reason = extractFailureReason(c.body);
    const list = groups.get(reason) ?? [];
    list.push(c);
    groups.set(reason, list);
  }

  let stuckGroup: IssueComment[] | null = null;
  let stuckReason = '';
  for (const [reason, list] of groups) {
    if (list.length >= 2 && (!stuckGroup || list.length > stuckGroup.length)) {
      stuckGroup = list;
      stuckReason = reason;
    }
  }

  if (stuckGroup) {
    const oldest = stuckGroup.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
    return {
      identifier: issue.identifier,
      title: issue.title,
      state: 'stuck',
      reason: translateFailureReason(stuckReason),
      action: 'Balas kartu ini dengan arahan, atau kirim instruksi baru.',
      sinceIso: oldest.createdAt,
      attempts: stuckGroup.length,
    };
  }

  const planComments = comments.filter((c) => c.body.includes('DIRECTIVE PLAN'));
  if (planComments.length > 0) {
    const latestPlan = planComments.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    const hasNewerDecision = comments.some(
      (c) =>
        (c.body.includes('OWNER MENYETUJUI via Telegram') || c.body.includes('OWNER MENOLAK via Telegram')) &&
        c.createdAt > latestPlan.createdAt,
    );
    if (!hasNewerDecision) {
      return {
        identifier: issue.identifier,
        title: issue.title,
        state: 'awaiting-your-approval',
        reason: 'Ada rencana (DIRECTIVE PLAN) yang nunggu keputusan lo.',
        action: 'Ketuk SETUJUI atau TOLAK.',
        sinceIso: latestPlan.createdAt,
        attempts: 0,
      };
    }
  }

  if (issue.labels.includes('DIRECTIVE')) {
    return {
      identifier: issue.identifier,
      title: issue.title,
      state: 'working',
      reason: 'Sedang dikerjakan oleh sistem.',
      action: '',
      sinceIso: issue.updatedAt,
      attempts: 0,
    };
  }

  return null;
}

function sortInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const diff = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (diff !== 0) return diff;
    if (a.state === 'stuck') {
      return (a.sinceIso ?? '').localeCompare(b.sinceIso ?? '');
    }
    return 0;
  });
}

export async function readInbox(): Promise<InboxItem[] | null> {
  try {
    const issues = await readIssues();
    if (!issues) return null;

    const baseUrl = await resolveBaseUrl();
    if (!baseUrl) return null;

    const items: InboxItem[] = [];
    let processed = 0;

    for (const issue of issues) {
      if (issue.status === 'done') continue;
      const qualifies = issue.ownerRequired || issue.labels.includes('DIRECTIVE');
      if (!qualifies) continue;
      if (processed >= MAX_ISSUES) break;
      processed += 1;

      const comments = (await fetchComments(baseUrl, issue.identifier)) ?? [];
      const item = classifyIssue(issue, comments);
      if (item) items.push(item);
    }

    return sortInbox(items);
  } catch {
    return null;
  }
}