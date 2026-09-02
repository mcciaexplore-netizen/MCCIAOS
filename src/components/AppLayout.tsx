import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Moon, Sun, Menu, X, SlidersHorizontal } from 'lucide-react';
import { NAV_ITEMS } from './navigation';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { APP_NAME, APP_TAGLINE, LOGO_SRC } from '@/lib/brand';
import { useOrgSettings } from '@/hooks/useOrgSettings';

/**
 * The name, tagline and logo come from Settings now. The constants in
 * lib/brand.ts remain the fallback for the first paint and for an install that
 * has never saved anything — the sidebar must render before the settings
 * request lands, and it should not flash empty while it waits.
 */
function Brand() {
  const org = useOrgSettings();
  const name = org.appName || APP_NAME;
  const tagline = org.appTagline || APP_TAGLINE;
  const logo = org.logoDataUri || LOGO_SRC;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-white p-1 ring-1 ring-slate-200 dark:ring-slate-700">
        {logo ? (
          <img src={logo} alt={name} className="max-h-full max-w-full object-contain" />
        ) : (
          // A lettermark rather than a broken image, when no logo is set.
          <span className="text-sm font-semibold text-slate-500">
            {name.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {name}
        </div>
        <div className="truncate text-[11px] text-slate-400">{tagline}</div>
      </div>
    </div>
  );
}

/**
 * Settings sits above the nav as an icon rather than in the list: it is a
 * destination you visit occasionally to configure the app, not one of the
 * places you work, and listing it alongside them gave it equal weight.
 */
function SettingsButton({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <NavLink
      to="/settings"
      onClick={onNavigate}
      title="Settings"
      aria-label="Settings"
      className={({ isActive }) =>
        cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
          isActive
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200',
        )
      }
    >
      <SlidersHorizontal className="h-[18px] w-[18px]" />
    </NavLink>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 px-2">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
            )
          }
        >
          <item.icon style={{ width: 18, height: 18 }} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppLayout() {
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const current = NAV_ITEMS.find(
    (n) => n.to === location.pathname || (n.to !== '/' && location.pathname.startsWith(n.to)),
  );
  // Settings is not in NAV_ITEMS, so the header title needs it named here.
  // Everything else falls back to Daily Log, which is where "/" redirects.
  const title = location.pathname.startsWith('/settings')
    ? 'Settings'
    : (current?.label ?? 'Daily Log');

  return (
    <div className="flex h-full">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white py-4 dark:border-slate-800 dark:bg-slate-900 lg:flex">
        <div className="mb-6 flex items-center justify-between gap-2 px-2">
          <Brand />
          <SettingsButton />
        </div>
        <NavLinks />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-60 flex-col border-r border-slate-200 bg-white py-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-6 flex items-center justify-between gap-2 px-2 pr-3">
              <Brand />
              <div className="flex items-center gap-1">
                <SettingsButton onNavigate={() => setMobileOpen(false)} />
                <button onClick={() => setMobileOpen(false)} aria-label="Close menu">
                  <X className="h-5 w-5 text-slate-400" />
                </button>
              </div>
            </div>
            <NavLinks onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggle}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              title="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
