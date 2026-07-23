import {
  LayoutDashboard,
  Building2,
  MessageSquareText,
  KanbanSquare,
  Megaphone,
  Link2,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/companies', label: 'Companies', icon: Building2 },
  { to: '/consulting', label: 'Consulting', icon: MessageSquareText },
  { to: '/app-development', label: 'App Development', icon: KanbanSquare },
  { to: '/social', label: 'Social', icon: Megaphone },
  { to: '/resources', label: 'Resources', icon: Link2 },
  { to: '/settings', label: 'Settings', icon: SlidersHorizontal },
];
