import {
  NotebookPen,
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
// Daily Log leads because "/" redirects to it — it is the module the team
// opens every day, and the Dashboard that used to hold that slot is gone.
export const NAV_ITEMS: NavItem[] = [
  { to: '/daily', label: 'Daily Log', icon: NotebookPen },
  { to: '/events', label: 'Workshops & Events', icon: CalendarDays },
  { to: '/social', label: 'Social', icon: Megaphone },
  { to: '/resources', label: 'Resources', icon: Link2 },
  { to: '/messages', label: 'Messages', icon: Send },
  { to: '/templates', label: 'Templates', icon: Code2 },
];
