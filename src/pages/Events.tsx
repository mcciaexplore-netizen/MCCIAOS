import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  CheckCheck,
  Percent,
  Plus,
  Presentation,
  Search,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FilterPill,
  Input,
  Select,
} from '@/components/ui';
import {
  ModeBadge,
  StatTile,
  StatTileSkeleton,
  StatusBadge,
  TableSkeleton,
  TypeBadge,
  formatRate,
} from '@/components/EventBadges';
import { eventsApi, type EventListFilters } from '@/lib/eventsApi';
import { EVENT_MODE_LABELS, EVENT_STATUS_LABELS } from '@/constants';
import { formatDate } from '@/lib/utils';
import type { EventMode, EventRecord, EventStatus, EventType } from '@/types';

type Tab = 'all' | 'WORKSHOP' | 'EVENT';

const TAB_LABELS: Record<Tab, string> = {
  all: 'All',
  WORKSHOP: 'Workshops',
  EVENT: 'Events',
};

/**
 * Filters live in the URL: a filtered view can be pasted to someone else and
 * survives a refresh or a trip into a detail page and back.
 */
function useEventFilters() {
  const [params, setParams] = useSearchParams();

  const tab = (params.get('tab') ?? 'all') as Tab;
  const mode = params.get('mode') ?? '';
  const status = params.get('status') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const search = params.get('search') ?? '';
  const sort = (params.get('sort') ?? 'date') as 'date' | 'code';
  const dir = (params.get('dir') ?? 'desc') as 'asc' | 'desc';

  const set = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };

  const filters: EventListFilters = {
    type: tab === 'all' ? '' : (tab as EventType),
    mode,
    status,
    from,
    to,
    search,
    sort,
    dir,
  };

  const active = Boolean(mode || status || from || to || search || tab !== 'all');

  return { tab, mode, status, from, to, search, sort, dir, set, filters, active };
}

export default function Events() {
  const navigate = useNavigate();
  const { tab, mode, status, from, to, search, sort, dir, set, filters, active } =
    useEventFilters();

  const query = useQuery({
    queryKey: ['events', filters],
    queryFn: () => eventsApi.list(filters),
  });

  const events = query.data?.events ?? [];
  const summary = query.data?.summary;

  const subtitle = useMemo(() => {
    if (!summary) return 'Workshops and short events run by the Applied AI Studio';
    const total = summary.workshops + summary.events;
    return `${total} record${total === 1 ? '' : 's'}${active ? ' matching these filters' : ''}`;
  }, [summary, active]);

  /** Clicking a sortable header re-sorts, or flips direction if already active. */
  const sortBy = (key: 'date' | 'code') =>
    set(
      sort === key
        ? { sort: key, dir: dir === 'asc' ? 'desc' : 'asc' }
        : { sort: key, dir: 'desc' },
    );

  return (
    <div>
      <PageHeader
        title="Workshops & Events"
        subtitle={subtitle}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => navigate('/events/new?type=EVENT')}>
              <Plus className="h-4 w-4" /> Add Event
            </Button>
            <Button size="sm" onClick={() => navigate('/events/new?type=WORKSHOP')}>
              <Plus className="h-4 w-4" /> Add Workshop
            </Button>
          </>
        }
      />

      {query.isError && (
        <div className="mb-4">
          <ErrorState error={query.error as Error} onRetry={() => query.refetch()} />
        </div>
      )}

      {/* Summary — aggregated server-side over the active filters, so these
          numbers always describe exactly what the table below is showing. */}
      <div className="mb-5 grid gap-3 grid-cols-2 lg:grid-cols-5">
        {query.isLoading || !summary ? (
          <>
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
          </>
        ) : (
          <>
            <StatTile
              label="Workshops"
              value={summary.workshops}
              tone="brand"
              icon={<Presentation className="h-[18px] w-[18px]" />}
            />
            <StatTile
              label="Events"
              value={summary.events}
              tone="violet"
              icon={<CalendarDays className="h-[18px] w-[18px]" />}
            />
            <StatTile
              label="Registrations"
              value={summary.registered}
              tone="amber"
              icon={<Users className="h-[18px] w-[18px]" />}
            />
            <StatTile
              label="Attendees"
              value={summary.attended}
              tone="green"
              icon={<CheckCheck className="h-[18px] w-[18px]" />}
            />
            <StatTile
              label="Attendance rate"
              value={formatRate(summary.attendanceRate)}
              tone="green"
              icon={<Percent className="h-[18px] w-[18px]" />}
              foot={
                summary.attendanceRate === null ? 'No registrations yet' : undefined
              }
            />
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <FilterPill key={t} active={tab === t} onClick={() => set({ tab: t === 'all' ? '' : t })}>
            {TAB_LABELS[t]}
          </FilterPill>
        ))}
      </div>

      {/* Filters. Each control sits in a sized wrapper rather than carrying a
          width class of its own: the shared input style is `w-full`, and
          Tailwind emits `w-full` after `w-auto`, so a `w-auto` override on the
          element would silently lose. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-[12rem] flex-1 sm:w-auto sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Search code or title..."
            className="pl-9"
          />
        </div>
        <div className="w-36">
          <Select
            value={mode}
            onChange={(e) => set({ mode: e.target.value })}
            aria-label="Filter by mode"
          >
            <option value="">Any mode</option>
            {(Object.keys(EVENT_MODE_LABELS) as EventMode[]).map((m) => (
              <option key={m} value={m}>
                {EVENT_MODE_LABELS[m]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <Select
            value={status}
            onChange={(e) => set({ status: e.target.value })}
            aria-label="Filter by status"
          >
            <option value="">Any status</option>
            {(Object.keys(EVENT_STATUS_LABELS) as EventStatus[]).map((s) => (
              <option key={s} value={s}>
                {EVENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-[9.5rem]">
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => set({ from: e.target.value })}
            aria-label="From date"
          />
        </div>
        <span className="text-sm text-slate-400">to</span>
        <div className="w-[9.5rem]">
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => set({ to: e.target.value })}
            aria-label="To date"
          />
        </div>
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              set({ tab: '', mode: '', status: '', from: '', to: '', search: '' })
            }
          >
            Clear
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {query.isLoading ? (
          <TableSkeleton />
        ) : events.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<CalendarDays className="h-10 w-10" />}
              title={active ? 'Nothing matches these filters' : 'No workshops or events yet'}
              description={
                active
                  ? 'Try widening the date range or clearing the filters.'
                  : 'Record a workshop to start tracking registrations and attendance.'
              }
              action={
                active ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      set({ tab: '', mode: '', status: '', from: '', to: '', search: '' })
                    }
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => navigate('/events/new?type=WORKSHOP')}>
                    <Plus className="h-4 w-4" /> Add Workshop
                  </Button>
                )
              }
            />
          </div>
        ) : (
          // Horizontal scroll rather than wrapping: nine columns cannot reflow
          // onto a phone without becoming unreadable.
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">
                    <SortHeader label="Code" active={sort === 'code'} dir={dir} onClick={() => sortBy('code')} />
                  </th>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Type</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Mode</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">
                    <SortHeader label="Date" active={sort === 'date'} dir={dir} onClick={() => sortBy('date')} />
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Registered</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Attended</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Attendance</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {events.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200"
    >
      {label}
      {active && <span aria-hidden>{dir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );
}

function EventRow({ event }: { event: EventRecord }) {
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
      <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">
        <Link to={`/events/${event.id}`} className="text-brand-600 hover:underline dark:text-brand-400">
          {event.code}
        </Link>
      </td>
      {/* The one column allowed to give ground: everything else is a badge or a
          number that cannot truncate meaningfully. */}
      <td className="max-w-[15rem] px-3 py-2">
        <Link
          to={`/events/${event.id}`}
          className="block truncate text-slate-700 hover:underline dark:text-slate-200"
          title={event.title}
        >
          {event.title}
        </Link>
        {event.topic && (
          <span className="block truncate text-xs text-slate-400">{event.topic}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <TypeBadge type={event.type} />
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <ModeBadge mode={event.mode} />
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500">
        {formatDate(event.eventDate)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
        {event.registered}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
        {event.attended}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-500">
        {formatRate(event.attendanceRate)}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <StatusBadge status={event.status} />
      </td>
    </tr>
  );
}
