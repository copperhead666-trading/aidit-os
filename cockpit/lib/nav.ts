/**
 * Single source of truth for the app's primary navigation. The Sidebar renders
 * these groups in order; the CommandPalette derives its digit (1–9) shortcuts
 * from the same visible order, so the two can never drift apart again.
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
} from 'lucide-react';

export type NavItem = { href: string; label: string; icon: typeof Home };

export const NAV_OPERATE: NavItem[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/tasks', label: 'Tasks', icon: ListChecks },
  { href: '/decisions', label: 'Decisions', icon: Scale },
];

// The agent workforce: the roster and the skills they bring to bear.
export const NAV_AGENTS: NavItem[] = [
  { href: '/agents', label: 'Agents', icon: Users },
  { href: '/skills', label: 'Skills', icon: Sparkles },
];

// The knowledge layer the agents draw on. G-Brain is the pure knowledge graph;
// Doctor holds the engine's health readouts (pillar health, doctor, storage
// layers, pipeline, query path) so the graph tab stays a single view.
export const NAV_INTELLIGENCE: NavItem[] = [
  { href: '/brain', label: 'G-Brain', icon: Brain },
  { href: '/doctor', label: 'Doctor', icon: Stethoscope },
];

export const NAV_SYSTEM: NavItem[] = [
  { href: '/roadmap', label: 'Roadmap', icon: Map },
  { href: '/reference', label: 'Layers', icon: Layers },
  { href: '/how', label: 'Cara Pakai', icon: BookOpen },
];

/** Visible top-to-bottom order across all groups. */
export const NAV_ORDER: string[] = [
  ...NAV_OPERATE,
  ...NAV_AGENTS,
  ...NAV_INTELLIGENCE,
  ...NAV_SYSTEM,
].map((n) => n.href);

/** Digit keys 1–9 jump to the first nine views in visible order. */
export const DIGIT_VIEWS: string[] = NAV_ORDER.slice(0, 9);