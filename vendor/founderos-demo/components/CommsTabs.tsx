'use client';

import { useState } from 'react';
import { CalendarDays, Hash, Lock, MessageSquare, Users } from 'lucide-react';
import { CommsBoard } from '@/components/CommsBoard';
import { SlackClientBoard } from '@/components/SlackClientBoard';
import { WeekCalendar } from '@/components/WeekCalendar';
import { SectionHead } from '@/components/terminal';
import type { CommsLane } from '@/lib/comms-lanes';
import type { SlackClientCard } from '@/lib/slack-clients';
import type { SlackChannel } from '@/lib/connectors/slack';
import type { CalEvent } from '@/lib/connectors/gcal';

type Tab = 'messaging' | 'meetings';
type Account = { name: string; color: string };

/** The front of /comms: a swappable view between the messaging board (the
    per-source lanes plus the Slack client board) and the 7-day meetings
    calendar. The old unified feed lives on in CommsGravity for an easy revert. */
export function CommsTabs({
  lanes,
  slackCards,
  channels,
  events,
  accounts,
  nowISO,
}: {
  lanes: CommsLane[];
  slackCards: SlackClientCard[];
  channels: SlackChannel[];
  events: CalEvent[];
  accounts: Account[];
  nowISO: string;
}) {
  const [tab, setTab] = useState<Tab>('messaging');
  const unread = lanes.reduce((sum, lane) => sum + lane.unread, 0);

  const TabButton = ({ id, icon: Icon, label, count }: { id: Tab; icon: typeof MessageSquare; label: string; count: number }) => {
    const active = tab === id;
    return (
      <button
        onClick={() => setTab(id)}
        className={`flex items-center gap-2 rounded-[5px] px-3.5 py-1.5 font-mono text-[12px] font-semibold transition-colors ${
          active ? 'bg-[var(--accent-soft)] text-os-accent' : 'text-os-dim hover:text-os-muted'
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
        <span className={`rounded-lg px-1.5 py-px text-[10px] ${active ? 'bg-os-accent text-os-ink' : 'bg-os-surface2 text-os-dim'}`}>
          {count}
        </span>
      </button>
    );
  };

  return (
    <div>
      <div className="mb-5 flex items-center gap-2 border-b border-os-border pb-3">
        <div className="inline-flex gap-1 rounded-xl border border-os-border bg-os-surface p-1">
          <TabButton id="messaging" icon={MessageSquare} label="Messaging" count={unread} />
          <TabButton id="meetings" icon={CalendarDays} label="Meetings" count={events.length} />
        </div>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.15em] text-os-dim">
          {tab === 'messaging' ? `${unread} unread` : 'next 7 days'}
        </span>
      </div>

      {tab === 'messaging' ? (
        <div className="flex flex-col gap-7">
          <CommsBoard lanes={lanes} nowISO={nowISO} />
          <div>
            <SectionHead label="Slack · clients" count={`${slackCards.length} clients`} />
            <SlackClientBoard cards={slackCards} nowISO={nowISO} />
          </div>
          <div>
            <SectionHead label="Slack · channels" count={channels.length} />
            {channels.length === 0 ? (
              <p className="rounded-xl border border-dashed border-os-border px-3 py-3 font-mono text-[10.5px] text-os-dim">
                No channels imported — connect the Slack bot token to pull every current channel.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {channels.map((c) => (
                  <div key={c.id} className="hoverable rounded-2xl border border-os-border bg-os-surface px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {c.isPrivate ? (
                        <Lock className="h-[13px] w-[13px] shrink-0 text-os-dim" strokeWidth={1.7} />
                      ) : (
                        <Hash className="h-[13px] w-[13px] shrink-0 text-os-accent" strokeWidth={1.7} />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-semibold">{c.name}</span>
                      <span className="flex shrink-0 items-center gap-1 font-mono text-[9.5px] text-os-dim">
                        <Users className="h-3 w-3" />
                        {c.members}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[10px] leading-snug text-os-dim">
                      {c.topic || (c.isMember ? 'member' : 'not a member')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <WeekCalendar events={events} accounts={accounts} nowISO={nowISO} />
      )}
    </div>
  );
}
