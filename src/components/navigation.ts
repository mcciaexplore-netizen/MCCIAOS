import {
  ListChecks,
  CalendarDays,
  Megaphone,
  Link2,
  Send,
  Code2,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

// Settings is deliberately absent: it is reached from the icon above the nav
// in AppLayout, not listed as a workspace destination.
//
// Work Tracker leads because "/" redirects to it. It took this slot from the
// Daily Work Log, which it replaces.
export const NAV_ITEMS: NavItem[] = [
  { to: '/work-tracker', label: 'Work Tracker', icon: ListChecks },
  { to: '/events', label: 'Workshops & Events', icon: CalendarDays },
  { to: '/social', label: 'Social', icon: Megaphone },
  { to: '/resources', label: 'Resources', icon: Link2 },
  { to: '/messages', label: 'Messages', icon: Send },
  { to: '/templates', label: 'Templates', icon: Code2 },
];
