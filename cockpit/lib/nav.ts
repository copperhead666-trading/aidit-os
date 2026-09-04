/**
 * Single source of truth for the app's primary navigation. The Sidebar renders
 * these groups in order; the CommandPalette derives its digit (1–9) shortcuts
 * from the same visible order, so the two can never drift apart again.
 *
 * Eleven destinations became four (interface standard, 2026-09-03). The other
 * seven are not deleted — they are demoted behind "More", still routable and
 * still reachable from the command palette. A rail is a place to go, not an
 * index of everything that exists.
 *
 * Labels are English: navigation is frame, not substance.
 */
import {
  Stethoscope,
  Inbox,
  BookOpen,
  Home,
  ListChecks,
  Users,
  Sparkles,
  Brain,
  Scale,
  Map,
  Layers,
  Moon,
} from 'lucide-react';

export type NavItem = { href: string; label: string; icon: typeof Home };

/** The four the owner actually opens. */
export const NAV_PRIMARY: NavItem[] = [
  { href: '/', label: 'Brief', icon: Home },
  { href: '/decisions', label: 'Decisions', icon: Scale },
  { href: '/tasks', label: 'Work', icon: ListChecks },
  { href: '/doctor', label: 'System', icon: Stethoscope },
];

/** Everything else, behind one disclosure. */
export const NAV_MORE: NavItem[] = [
  { href: '/night', label: 'Overnight', icon: Moon },
  { href: '/inbox', label: 'Attention', icon: Inbox },
  { href: '/agents', label: 'Agents', icon: Users },
  { href: '/skills', label: 'Skills', icon: Sparkles },
  { href: '/brain', label: 'Memory', icon: Brain },
  { href: '/roadmap', label: 'Roadmap', icon: Map },
  { href: '/reference', label: 'Layers', icon: Layers },
  { href: '/how', label: 'How to use', icon: BookOpen },
];

/** Visible top-to-bottom order across both groups. */
export const NAV_ORDER: string[] = [...NAV_PRIMARY, ...NAV_MORE].map((n) => n.href);

/** Digit keys 1–9 jump to the first nine views in visible order. */
export const DIGIT_VIEWS: string[] = NAV_ORDER.slice(0, 9);
