import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Bell, Moon, Sun, Menu, X, SlidersHorizontal } from 'lucide-react';
import { NAV_ITEMS } from './navigation';
import { useTheme } from '@/lib/theme';
import { useFollowups } from '@/hooks';
import { cn, daysUntil } from '@/lib/utils';
import { APP_NAME, APP_TAGLINE, LOGO_DATA_URI, hasLogo } from '@/lib/brand';

function Brand() {
  // Install the real wordmark with `npm run logo -- path/to/logo.png`; until
  // then this renders a lettermark rather than a broken image.
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {hasLogo() ? (
        // The wordmark's blue sits low-contrast on the dark sidebar, so in dark
        // mode it gets a white plate rather than being recoloured — the brand
        // colours stay correct in both themes.
        <div className="shrink-0 rounded dark:bg-white dark:px-1 dark:py-0.5">
          <img
            src={LOGO_DATA_URI}
            alt="MCCIA"
            className="h-6 w-auto max-w-[4.5rem] object-contain"
          />
        </div>
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          M
        </div>
      )}
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {APP_NAME}
        </div>
        <div className="truncate text-[11px] text-slate-400">{APP_TAGLINE}</div>
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

function NotificationBell() {
  const { items } = useFollowups();
  const [open, setOpen] = useState(false);
  const due = items.filter((f) => {
    if (f.done) return false;
    const d = daysUntil(f.dueDate);
    return d !== null && d <= 3;
  });
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <Bell className="h-5 w-5" />
        {due.length > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-2 w-2 rounded-full bg-rose-500" />
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white py-2 shadow-lg dark:border-slate-800 dark:bg-slate-900">
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Follow-ups due soon
            </p>
            {due.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-400">Nothing due. </p>
            ) : (
              due.slice(0, 6).map((f) => (
                <div
                  key={f.id}
                  className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300"
                >
                  <span className="font-medium">{f.note || 'Follow-up'}</span>
                  <span className="ml-1 text-xs text-slate-400">
                    · {daysUntil(f.dueDate) === 0 ? 'today' : `${daysUntil(f.dueDate)}d`}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function AppLayout() {
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const current = NAV_ITEMS.find(
    (n) => n.to === location.pathname || (n.to !== '/' && location.pathname.startsWith(n.to)),
  );
  // Settings is no longer in NAV_ITEMS, so the header title needs it named
  // here — otherwise /settings would fall through to "Dashboard".
  const title = location.pathname.startsWith('/settings')
    ? 'Settings'
    : (current?.label ?? 'Dashboard');

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
            <NotificationBell />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
