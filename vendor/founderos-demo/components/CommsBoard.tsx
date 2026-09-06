'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Archive,
  Mail,
  MailOpen,
  Maximize2,
  MessageSquare,
  Paperclip,
  PenLine,
  RefreshCw,
  Search,
  Send,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Dot } from '@/components/terminal';
import { replySubject, type EmailThread } from '@/lib/email-thread';
import type { CommsLane, CommsLaneItem, LaneSource } from '@/lib/comms-lanes';

const LANE_ICON: Record<LaneSource, LucideIcon> = { email: Mail, whatsapp: MessageSquare };
const PRIORITY_VAR: Record<number, string> = { 1: 'var(--err)', 2: 'var(--warn)', 3: 'var(--ok)' };

function ago(iso: string, nowISO: string): string {
  const ms = Date.parse(nowISO) - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  if (ms < 60_000) return 'now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function ItemRow({ item, nowISO, onOpen }: { item: CommsLaneItem; nowISO: string; onOpen?: () => void }) {
  const content = (
    <>
      <div className="flex items-center gap-2">
        {item.priority ? <span className="h-1.5 w-1.5 shrink-0" style={{ background: PRIORITY_VAR[item.priority] }} /> : null}
        {item.starred ? <Star className="h-3 w-3 shrink-0 fill-os-warn text-os-warn" /> : null}
        <span className="truncate text-[11.5px] font-semibold">{item.sender}</span>
        <span className="ml-auto shrink-0 font-mono text-[9px] text-os-dim">{ago(item.ts, nowISO)}</span>
        {item.unread ? <span className="h-1.5 w-1.5 shrink-0 bg-os-accent" /> : null}
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-os-muted">{item.subject ?? item.preview}</p>
    </>
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className="w-full px-3 py-2.5 text-left transition-colors hover:bg-os-raised">
      {content}
    </button>
  ) : (
    <div className="px-3 py-2.5">{content}</div>
  );
}

type SendPhase = 'idle' | 'sending' | 'sent' | 'error';
type ThreadPhase = 'idle' | 'loading' | 'ready' | 'error';
type EmailAction = 'archive' | 'trash' | 'read' | 'unread' | 'star' | 'unstar';

function SendComposer({
  account,
  initialTo = '',
  initialSubject = '',
  inReplyTo,
  references,
  label,
}: {
  account: string;
  initialTo?: string;
  initialSubject?: string;
  inReplyTo?: string;
  references?: string[];
  label: string;
}) {
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [bodyText, setBodyText] = useState('');
  const [phase, setPhase] = useState<SendPhase>('idle');
  const [error, setError] = useState('');

  const send = async () => {
    if (!to.trim() || !subject.trim() || !bodyText.trim()) return;
    setPhase('sending');
    setError('');
    try {
      const response = await fetch('/api/comms/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'email', account, to, subject, text: bodyText, inReplyTo, references }),
      });
      const responseBody = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(responseBody.error ?? `HTTP ${response.status}`);
      setPhase('sent');
      setBodyText('');
    } catch (sendError) {
      setPhase('error');
      setError(sendError instanceof Error ? sendError.message : 'Send failed');
    }
  };

  return (
    <div className="border-t border-os-border bg-os-bg p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <label className="flex items-center border border-os-border bg-os-surface px-2.5">
          <span className="mr-2 font-mono text-[9px] uppercase tracking-widest text-os-dim">to</span>
          <input
            type="email"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder="name@example.com"
            className="min-w-0 flex-1 bg-transparent py-2 text-[11px] text-os-text outline-none placeholder:text-os-dim"
          />
        </label>
        <label className="flex items-center border border-os-border bg-os-surface px-2.5">
          <span className="mr-2 font-mono text-[9px] uppercase tracking-widest text-os-dim">subject</span>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject"
            className="min-w-0 flex-1 bg-transparent py-2 text-[11px] text-os-text outline-none placeholder:text-os-dim"
          />
        </label>
      </div>
      <textarea
        value={bodyText}
        onChange={(event) => setBodyText(event.target.value)}
        rows={5}
        placeholder={label}
        className="mt-2 w-full resize-y border border-os-border bg-os-surface px-2.5 py-2 text-[12px] leading-relaxed text-os-text outline-none placeholder:text-os-dim focus:border-os-border-strong"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={send}
          disabled={!to.trim() || !subject.trim() || !bodyText.trim() || phase === 'sending'}
          className="flex items-center gap-1.5 border border-os-border-strong bg-os-accent px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-os-bg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-3 w-3" />
          {phase === 'sending' ? 'sending...' : 'send'}
        </button>
        {phase === 'sent' ? <Badge tone="ok">sent</Badge> : null}
        {phase === 'error' ? <span className="text-[10px] text-os-err">{error}</span> : null}
      </div>
    </div>
  );
}

function ThreadView({ thread, account }: { thread: EmailThread; account: string }) {
  const last = thread.messages.at(-1);
  const references = thread.messages.flatMap((message) => (message.messageId ? [message.messageId] : []));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-os-border px-4 py-2.5">
        <h2 className="truncate text-[13px] font-semibold text-os-text">{thread.subject}</h2>
        <Badge>{thread.messages.length} {thread.messages.length === 1 ? 'message' : 'messages'}</Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {thread.messages.map((message) => (
          <article key={`${message.uid}:${message.messageId ?? ''}`} className="border border-os-border bg-os-bg">
            <header className="border-b border-os-border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="truncate text-[12px] font-semibold">{message.sentByMe ? 'You' : message.from}</span>
                {message.starred ? <Star className="h-3 w-3 fill-os-warn text-os-warn" /> : null}
                {message.unread ? <Badge tone="accent">unread</Badge> : null}
                <time className="ml-auto shrink-0 font-mono text-[9px] text-os-dim">
                  {new Date(message.date).toLocaleString()}
                </time>
              </div>
              <p className="mt-1 truncate font-mono text-[9px] text-os-dim">
                to {message.to.join(', ') || 'unknown recipient'}
                {message.cc.length ? ` | cc ${message.cc.join(', ')}` : ''}
              </p>
            </header>
            <pre className="whitespace-pre-wrap break-words px-3 py-3 font-sans text-[12px] leading-relaxed text-os-muted">{message.body}</pre>
            {message.attachments.length ? (
              <div className="flex flex-wrap gap-2 border-t border-os-border px-3 py-2.5">
                {message.attachments.map((attachment) => (
                  <a
                    key={attachment.part}
                    href={`/api/comms/email/attachment?${new URLSearchParams({
                      account,
                      threadId: thread.threadId,
                      uid: String(message.uid),
                      part: attachment.part,
                    })}`}
                    className="flex items-center gap-1.5 border border-os-border px-2 py-1 font-mono text-[9px] text-os-muted hover:border-os-border-strong hover:text-os-text"
                  >
                    <Paperclip className="h-3 w-3" />
                    {attachment.filename}
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {thread.replyTo ? (
        <SendComposer
          key={thread.threadId}
          account={account}
          initialTo={thread.replyTo}
          initialSubject={replySubject(thread.subject)}
          inReplyTo={last?.messageId}
          references={references}
          label="Write a reply to this conversation"
        />
      ) : (
        <p className="border-t border-os-border px-4 py-3 font-mono text-[10px] text-os-dim">No reply address was supplied.</p>
      )}
    </div>
  );
}

function ToolButton({ label, active, busy, onClick, children }: { label: string; active?: boolean; busy?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className={`border p-1.5 transition-colors disabled:opacity-40 ${active ? 'border-os-warn text-os-warn' : 'border-os-border text-os-dim hover:border-os-border-strong hover:text-os-text'}`}
    >
      {children}
    </button>
  );
}

function InboxReader({ lane, nowISO, initialItemId, onClose }: { lane: CommsLane; nowISO: string; initialItemId?: string; onClose: () => void }) {
  const [items, setItems] = useState(lane.items);
  const [selectedId, setSelectedId] = useState(initialItemId ?? lane.items[0]?.id ?? '');
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [threadPhase, setThreadPhase] = useState<ThreadPhase>('idle');
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [compose, setCompose] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CommsLaneItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const displayedItems = searchResults ?? items;
  const selected = displayedItems.find((item) => item.id === selectedId) ?? items.find((item) => item.id === selectedId);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ account: lane.id, q: needle });
        const response = await fetch(`/api/comms/email/search?${params}`, { signal: controller.signal });
        const responseBody = (await response.json().catch(() => ({}))) as { items?: CommsLaneItem[]; unavailable?: boolean; error?: string };
        if (!response.ok || responseBody.unavailable) throw new Error(responseBody.error ?? `HTTP ${response.status}`);
        setSearchResults(responseBody.items ?? []);
      } catch (searchError) {
        if (!controller.signal.aborted) setError(searchError instanceof Error ? searchError.message : 'Inbox search failed');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [lane.id, query]);

  const performActionFor = async (item: CommsLaneItem, action: EmailAction, background = false) => {
    if (!item.emailThreadId) return;
    if (!background) setActionBusy(true);
    setError('');
    try {
      const response = await fetch('/api/comms/email/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: lane.id, threadId: item.emailThreadId, uid: item.emailUid, action }),
      });
      const responseBody = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(responseBody.error ?? `HTTP ${response.status}`);
      if (action === 'archive' || action === 'trash') {
        const remaining = items.filter((candidate) => candidate.emailThreadId !== item.emailThreadId);
        setItems(remaining);
        setSearchResults((current) => current?.filter((candidate) => candidate.emailThreadId !== item.emailThreadId) ?? null);
        setThread(null);
        const remainingDisplayed = (searchResults ?? remaining).filter((candidate) => candidate.emailThreadId !== item.emailThreadId);
        setSelectedId(remainingDisplayed[0]?.id ?? '');
      } else {
        const patch = {
          ...(action === 'read' ? { unread: 0 } : {}),
          ...(action === 'unread' ? { unread: 1 } : {}),
          ...(action === 'star' ? { starred: true } : {}),
          ...(action === 'unstar' ? { starred: false } : {}),
        };
        setItems((current) => current.map((candidate) => (candidate.emailThreadId === item.emailThreadId ? { ...candidate, ...patch } : candidate)));
        setSearchResults((current) => current?.map((candidate) => (candidate.emailThreadId === item.emailThreadId ? { ...candidate, ...patch } : candidate)) ?? null);
        setThread((current) => current && (action === 'read' || action === 'unread' || action === 'star' || action === 'unstar')
          ? { ...current, messages: current.messages.map((message) => ({
              ...message,
              ...(action === 'read' ? { unread: false } : {}),
              ...(action === 'unread' ? { unread: true } : {}),
              ...(action === 'star' ? { starred: true } : {}),
              ...(action === 'unstar' ? { starred: false } : {}),
            })) }
          : current);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Inbox action failed');
    } finally {
      if (!background) setActionBusy(false);
    }
  };

  const loadThread = async (item: CommsLaneItem) => {
    const params = new URLSearchParams({ account: lane.id });
    if (item.emailThreadId) params.set('threadId', item.emailThreadId);
    if (item.emailMessageId) params.set('messageId', item.emailMessageId);
    if (item.emailUid) params.set('uid', String(item.emailUid));
    setThreadPhase('loading');
    setThread(null);
    setError('');
    try {
      const response = await fetch(`/api/comms/email/thread?${params}`);
      const responseBody = (await response.json().catch(() => ({}))) as EmailThread & { unavailable?: boolean; error?: string };
      if (!response.ok || responseBody.unavailable) throw new Error(responseBody.error ?? `HTTP ${response.status}`);
      setThread(responseBody);
      setThreadPhase('ready');
      if (item.unread && item.emailThreadId) void performActionFor(item, 'read', true);
    } catch (loadError) {
      setThreadPhase('error');
      setError(loadError instanceof Error ? loadError.message : 'Could not load the conversation');
    }
  };

  useEffect(() => {
    if (selected && !compose) void loadThread(selected);
    // selectedId is the intentional fetch boundary. Item state updates should not refetch the body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, compose]);

  const performAction = (action: EmailAction) => selected && performActionFor(selected, action);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-5" onClick={onClose}>
      <div className="flex h-[92dvh] w-full max-w-6xl flex-col overflow-hidden border border-os-border-strong bg-os-surface" onClick={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-center gap-2.5 border-b border-os-border px-3 py-2.5 sm:px-4">
          <Mail className="h-4 w-4 shrink-0 text-os-accent" />
          <span className="text-[13px] font-semibold">{lane.name}</span>
          <span className="hidden font-mono text-[9px] text-os-dim sm:inline">{lane.detail}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="sm:hidden">
              <ToolButton label="Compose new email" onClick={() => { setCompose(true); setSelectedId(''); }}><PenLine className="h-3.5 w-3.5" /></ToolButton>
            </span>
            {selected?.emailThreadId && !compose ? (
              <>
                <ToolButton label={selected.starred ? 'Unstar conversation' : 'Star conversation'} active={selected.starred} busy={actionBusy} onClick={() => performAction(selected.starred ? 'unstar' : 'star')}>
                  <Star className={`h-3.5 w-3.5 ${selected.starred ? 'fill-current' : ''}`} />
                </ToolButton>
                <ToolButton label={selected.unread ? 'Mark read' : 'Mark unread'} busy={actionBusy} onClick={() => performAction(selected.unread ? 'read' : 'unread')}>
                  {selected.unread ? <MailOpen className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                </ToolButton>
                <ToolButton label="Archive conversation" busy={actionBusy} onClick={() => performAction('archive')}><Archive className="h-3.5 w-3.5" /></ToolButton>
                <ToolButton label="Move conversation to trash" busy={actionBusy} onClick={() => performAction('trash')}><Trash2 className="h-3.5 w-3.5" /></ToolButton>
              </>
            ) : null}
            <button type="button" onClick={onClose} aria-label="Close inbox" className="ml-1 p-1.5 text-os-dim hover:text-os-text"><X className="h-4 w-4" /></button>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="hidden min-h-0 flex-col border-r border-os-border sm:flex">
            <div className="space-y-2 border-b border-os-border p-2.5">
              <button type="button" onClick={() => { setCompose(true); setSelectedId(''); }} className="flex w-full items-center justify-center gap-2 border border-os-border-strong bg-os-accent px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-os-bg">
                <PenLine className="h-3.5 w-3.5" /> compose
              </button>
              <label className="flex items-center gap-2 border border-os-border bg-os-bg px-2.5">
                {searching ? <RefreshCw className="h-3 w-3 animate-spin text-os-dim" /> : <Search className="h-3 w-3 text-os-dim" />}
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search entire inbox" className="min-w-0 flex-1 bg-transparent py-2 font-mono text-[9.5px] text-os-text outline-none placeholder:text-os-dim" />
              </label>
            </div>
            <div className="min-h-0 flex-1 divide-y divide-os-border overflow-y-auto">
              {displayedItems.map((item) => (
                <button key={item.id} type="button" onClick={() => { setCompose(false); setSelectedId(item.id); }} className={`w-full px-3 py-2.5 text-left transition-colors ${item.id === selectedId ? 'bg-os-raised' : 'hover:bg-os-bg'}`}>
                  <div className="flex items-center gap-1.5">
                    {item.starred ? <Star className="h-3 w-3 fill-os-warn text-os-warn" /> : null}
                    <span className={`truncate text-[11px] ${item.unread ? 'font-bold text-os-text' : 'text-os-muted'}`}>{item.sender}</span>
                    <span className="ml-auto font-mono text-[8.5px] text-os-dim">{ago(item.ts, nowISO)}</span>
                  </div>
                  <p className={`mt-1 truncate text-[10px] ${item.unread ? 'text-os-text' : 'text-os-dim'}`}>{item.subject ?? item.preview}</p>
                </button>
              ))}
              {displayedItems.length === 0 ? <p className="p-4 font-mono text-[10px] text-os-dim">No matching mail.</p> : null}
            </div>
          </aside>
          <main className="flex min-h-0 min-w-0 flex-col">
            {compose ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 p-5"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-os-dim">new message from {lane.name}</p></div>
                <SendComposer account={lane.id} label="Write a new message" />
              </div>
            ) : null}
            {!compose && threadPhase === 'loading' ? (
              <div className="flex flex-1 items-center justify-center gap-2 font-mono text-[10px] text-os-dim"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> loading full conversation...</div>
            ) : null}
            {!compose && threadPhase === 'error' ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <p className="max-w-md text-[11px] text-os-err">{error}</p>
                {selected ? <button type="button" onClick={() => loadThread(selected)} className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-os-muted">retry</button> : null}
              </div>
            ) : null}
            {!compose && threadPhase === 'ready' && thread ? <ThreadView thread={thread} account={lane.id} /> : null}
            {!compose && !selected && threadPhase !== 'loading' ? <p className="m-auto font-mono text-[10px] text-os-dim">Inbox clear. Compose a new message or close this view.</p> : null}
            {error && threadPhase !== 'error' ? <p className="border-t border-os-border px-3 py-2 text-[10px] text-os-err">{error}</p> : null}
          </main>
        </div>
      </div>
    </div>
  );
}

function LaneColumn({ lane, nowISO, onExpand, onOpenItem }: { lane: CommsLane; nowISO: string; onExpand?: () => void; onOpenItem?: (item: CommsLaneItem) => void }) {
  const Icon = LANE_ICON[lane.source];
  const connected = lane.state === 'connected';
  return (
    <div className="flex w-[248px] shrink-0 flex-col border border-os-border bg-os-surface lg:w-auto">
      <div className="flex items-center gap-2 border-b border-os-border px-3 py-2.5">
        <Icon className={`h-[14px] w-[14px] shrink-0 ${connected ? 'text-os-accent' : 'text-os-dim'}`} />
        <span className="truncate text-[12px] font-semibold">{lane.name}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {lane.unread > 0 ? <Badge tone="accent">{lane.unread}</Badge> : null}
          <Dot state={lane.state} pulse />
          {onExpand ? <button type="button" onClick={onExpand} title={`Open ${lane.name} inbox`} aria-label={`Open ${lane.name} inbox`} className="text-os-dim hover:text-os-accent"><Maximize2 className="h-3 w-3" /></button> : null}
        </span>
      </div>
      <div className="flex max-h-[calc(100dvh-19rem)] min-h-[320px] flex-col divide-y divide-os-border overflow-y-auto">
        {lane.items.length === 0 ? (
          <p className="px-3 py-4 font-mono text-[10px] leading-relaxed text-os-dim">{connected ? 'Nothing here right now.' : lane.detail}</p>
        ) : lane.items.map((item) => <ItemRow key={item.id} item={item} nowISO={nowISO} onOpen={onOpenItem ? () => onOpenItem(item) : undefined} />)}
      </div>
    </div>
  );
}

export function CommsBoard({ lanes, nowISO }: { lanes: CommsLane[]; nowISO: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [initialItemId, setInitialItemId] = useState<string | undefined>();
  const expanded = lanes.find((lane) => lane.id === expandedId) ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setExpandedId(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const open = (lane: CommsLane, item?: CommsLaneItem) => {
    setInitialItemId(item?.id);
    setExpandedId(lane.id);
  };

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-max gap-3 lg:grid lg:min-w-0 lg:grid-cols-5">
        {lanes.map((lane) => (
          <LaneColumn
            key={lane.id}
            lane={lane}
            nowISO={nowISO}
            onExpand={lane.source === 'email' ? () => open(lane) : undefined}
            onOpenItem={lane.source === 'email' ? (item) => open(lane, item) : undefined}
          />
        ))}
      </div>
      {expanded ? <InboxReader key={`${expanded.id}:${initialItemId ?? ''}`} lane={expanded} nowISO={nowISO} initialItemId={initialItemId} onClose={() => setExpandedId(null)} /> : null}
    </div>
  );
}
