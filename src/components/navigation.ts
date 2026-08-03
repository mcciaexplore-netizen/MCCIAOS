import {
  LayoutDashboard,
  Building2,
  MessageSquareText,
  KanbanSquare,
  Megaphone,
  Link2,
  Send,
  Code2,
  BarChart3,
  CalendarDays,
  NotebookPen,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

// Settings is deliberately absent: it is reached from the icon above the nav
// in AppLayout, not listed as a workspace destination.
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/companies', label: 'Companies', icon: Building2 },
  { to: '/consulting', label: 'Consulting', icon: MessageSquareText },
  { to: '/app-development', label: 'App Development', icon: KanbanSquare },
  { to: '/daily', label: 'Daily Log', icon: NotebookPen },
  { to: '/events', label: 'Workshops & Events', icon: CalendarDays },
  { to: '/social', label: 'Social', icon: Megaphone },
  { to: '/resources', label: 'Resources', icon: Link2 },
  { to: '/messages', label: 'Messages', icon: Send },
  { to: '/templates', label: 'Templates', icon: Code2 },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
];
