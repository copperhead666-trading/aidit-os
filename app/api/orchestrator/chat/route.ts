import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AIDIT_NODE = process.env.AIDIT_NODE ?? 'D:/aidit-node/node-v22.14.0-win-x64/node.exe';
const CHAT_SCRIPT = path.join(process.cwd(), 'conductor', 'chat.mjs');

type ChatResult = { ok: boolean; reply: string; modelUsed?: string; escalated?: boolean };

function runChat(text: string): Promise<ChatResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      AIDIT_NODE,
      [CHAT_SCRIPT, '--stdin'],
      { cwd: process.cwd(), timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.slice(0, 300) || err.message));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as ChatResult);
        } catch {
          reject(new Error('orchestrator returned invalid JSON'));
        }
      },
    );
    child.stdin?.end(JSON.stringify({ text, channel: 'dashboard' }));
  });
}

export async function POST(req: Request) {
  let message = '';
  try {
    const body = (await req.json()) as { message?: unknown };
    message = typeof body.message === 'string' ? body.message.trim() : '';
  } catch {
    // fall through to the empty-message rejection
  }
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  try {
    const result = await runChat(message);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'Maaf, Bapak, orchestrator sedang tidak bisa menjawab.', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
