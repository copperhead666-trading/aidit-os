import { describe, expect, test } from 'vitest';
import { shapeChannels, type SlackChannel } from '@/lib/connectors/slack';

/**
 * The /comms Slack board imports every current channel in the workspace.
 * shapeChannels is the pure half of listChannels: raw conversations.list
 * entries in, a clean sorted board out.
 */

const raw = [
  { id: 'C1', name: 'general', is_archived: false, is_member: true, is_private: false, num_members: 9, topic: { value: 'company wide' } },
  { id: 'C2', name: 'acme-corp', is_archived: false, is_member: true, is_private: true, num_members: 4, topic: { value: '' } },
  { id: 'C3', name: 'zzz-dead', is_archived: true, is_member: false, is_private: false, num_members: 0, topic: { value: 'old' } },
  { id: 'C4', name: 'builds', is_archived: false, is_member: false, is_private: false, num_members: 2, topic: undefined },
  { id: undefined, name: 'ghost', is_archived: false }, // no id — dropped
];

describe('shapeChannels', () => {
  const channels: SlackChannel[] = shapeChannels(raw);

  test('drops archived and id-less entries, keeps the rest sorted by name', () => {
    expect(channels.map((c) => c.name)).toEqual(['acme-corp', 'builds', 'general']);
  });

  test('carries membership, privacy, member count, and topic', () => {
    const acme = channels.find((c) => c.name === 'acme-corp')!;
    expect(acme).toEqual({ id: 'C2', name: 'acme-corp', isMember: true, isPrivate: true, members: 4, topic: '' });
    const builds = channels.find((c) => c.name === 'builds')!;
    expect(builds.isMember).toBe(false);
    expect(builds.topic).toBe('');
  });
});
