import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  KanbanSquare,
  Megaphone,
  Inbox,
  ArrowRight,
  Building2,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Card } from '@/components/ui';
import { AssigneeFilterSelect, matchesAssignee } from '@/components/FormControls';
import {
  useCompanies,
  useCreatives,
  useFollowups,
  useProjects,
  useSessions,
} from '@/hooks';
import { useSettings } from '@/settings/SettingsContext';
import type { ProjectStage } from '@/types';
import { daysUntil, formatDate, relativeTime } from '@/lib/utils';

export default function Dashboard() {
  const companies = useCompanies();
  const sessions = useSessions();
  const projects = useProjects();
  const creatives = useCreatives();
  const followups = useFollowups();
  const { projectStageValues, companyStatusValues, creativeStatusValues } = useSettings();
  const [assignee, setAssignee] = useState('all');

  const mine = <T extends { assignedTo?: string | null }>(rows: T[]) =>
    rows.filter((r) => matchesAssignee(r.assignedTo, assignee));

  const companyName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of companies.items) m[c.id] = c.companyName;
    return m;
  }, [companies.items]);

  const visibleProjects = mine(projects.items);
  const visibleSessions = mine(sessions.items);
  const visibleCreatives = mine(creatives.items);

  const openFollowups = followups.items.filter((f) => !f.done);
  const overdue = openFollowups.filter((f) => (daysUntil(f.dueDate) ?? 99) < 0);
  const dueThisWeek = openFollowups.filter((f) => {
    const d = daysUntil(f.dueDate);
    return d !== null && d >= 0 && d <= 7;
  });
  // "Done" is the last configured stage/status, so these keep working when the
  // vocabularies are renamed or reordered on the Settings page.
  const finalStage = projectStageValues[projectStageValues.length - 1];
  const finalCreativeStatus = creativeStatusValues[creativeStatusValues.length - 1];
  const firstCompanyStatus = companyStatusValues[0];

  const activeProjects = visibleProjects.filter((p) => p.stage !== finalStage);
  const pendingCreatives = visibleCreatives.filter(
    (c) => c.status !== finalCreativeStatus,
  );

  const unassignedSessions = sessions.items.filter((s) => !s.assignedTo);
  const unassignedProjects = projects.items.filter((p) => !p.assignedTo);
  const newLeads = companies.items.filter((c) => c.status === firstCompanyStatus);

  const stageCounts = projectStageValues.map((stage) => ({
    stage,
    count: visibleProjects.filter((p) => p.stage === stage).length,
  }));
  const maxStage = Math.max(1, ...stageCounts.map((s) => s.count));

  // Simple activity feed: newest records across modules.
  const activity = useMemo(() => {
    type Item = { id: string; label: string; sub: string; at: string };
    const items: Item[] = [];
    for (const s of sessions.items)
      items.push({
        id: 's' + s.id,
        label: `Session · ${companyName[s.companyId] ?? 'company'}`,
        sub: (s.query ?? '').slice(0, 60),
        at: s.createdAt,
      });
    for (const p of projects.items)
      items.push({
        id: 'p' + p.id,
        label: `Project · ${p.title || companyName[p.companyId] || ''}`,
        sub: `${p.stage} · ${p.progressPct}%`,
        at: p.createdAt,
      });
    for (const c of companies.items)
      items.push({
        id: 'c' + c.id,
        label: `Company · ${c.companyName}`,
        sub: c.status,
        at: c.createdAt,
      });
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8);
  }, [sessions.items, projects.items, companies.items, companyName]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Team-wide view of what needs attention today."
        actions={
          <AssigneeFilterSelect
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          />
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Overdue follow-ups"
          value={overdue.length}
          tone="rose"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatCard
          label="Due this week"
          value={dueThisWeek.length}
          tone="amber"
          icon={<CalendarClock className="h-5 w-5" />}
        />
        <StatCard
          label="Active projects"
          value={activeProjects.length}
          tone="brand"
          icon={<KanbanSquare className="h-5 w-5" />}
        />
        <StatCard
          label="Pending creatives"
          value={pendingCreatives.length}
          tone="violet"
          icon={<Megaphone className="h-5 w-5" />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Attention required */}
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <Inbox className="h-4 w-4 text-slate-400" />
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
              Attention required
            </h3>
          </div>

          <AttentionRow
            to="/consulting"
            icon={<Inbox className="h-4 w-4" />}
            title="Unassigned sessions"
            count={unassignedSessions.length}
            tone="violet"
          />
          <AttentionRow
            to="/app-development"
            icon={<KanbanSquare className="h-4 w-4" />}
            title="Unassigned projects"
            count={unassignedProjects.length}
            tone="violet"
          />
          <AttentionRow
            to="/companies"
            icon={<Building2 className="h-4 w-4" />}
            title="New leads to contact"
            count={newLeads.length}
            tone="amber"
          />
          <AttentionRow
            to="/consulting"
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Overdue follow-ups"
            count={overdue.length}
            tone="rose"
          />

          {/* Follow-ups due soon */}
          <div className="mt-5">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Follow-ups due soon
            </h4>
            {dueThisWeek.length === 0 && overdue.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing due this week. </p>
            ) : (
              <div className="space-y-1.5">
                {[...overdue, ...dueThisWeek].slice(0, 6).map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm dark:border-slate-800"
                  >
                    <span className="text-slate-600 dark:text-slate-300">
                      {f.note || 'Follow-up'}
                    </span>
                    <Badge tone={(daysUntil(f.dueDate) ?? 0) < 0 ? 'rose' : 'amber'}>
                      {formatDate(f.dueDate)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Pipeline + activity */}
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">
              Pipeline
            </h3>
            <div className="space-y-2.5">
              {stageCounts.map(({ stage, count }) => (
                <StageBar key={stage} stage={stage} count={count} max={maxStage} />
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">
              Recent activity
            </h3>
            <div className="space-y-3">
              {activity.map((a) => (
                <div key={a.id} className="flex gap-3">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                      {a.label}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {a.sub} · {relativeTime(a.at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: 'rose' | 'amber' | 'brand' | 'violet';
  icon: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    rose: 'text-rose-500 bg-rose-50 dark:bg-rose-950/40',
    amber: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40',
    brand: 'text-brand-500 bg-brand-50 dark:bg-brand-950/40',
    violet: 'text-violet-500 bg-violet-50 dark:bg-violet-950/40',
  };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}>
          {icon}
        </div>
        <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {value}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-500">{label}</p>
    </Card>
  );
}

function AttentionRow({
  to,
  icon,
  title,
  count,
  tone,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  count: number;
  tone: 'violet' | 'amber' | 'rose';
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60"
    >
      <span className="text-slate-400">{icon}</span>
      <span className="flex-1 text-sm text-slate-600 dark:text-slate-300">{title}</span>
      <Badge tone={count > 0 ? tone : 'gray'}>{count}</Badge>
      <ArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

const stageBarColor: Record<string, string> = {
  green: 'bg-emerald-500',
  blue: 'bg-sky-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  brand: 'bg-brand-500',
};

function StageBar({
  stage,
  count,
  max,
}: {
  stage: ProjectStage;
  count: number;
  max: number;
}) {
  const { projectStageTone } = useSettings();
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-500">{stage}</span>
        <span className="font-medium text-slate-700 dark:text-slate-300">{count}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full ${
            stageBarColor[projectStageTone[stage]] ?? 'bg-slate-400'
          }`}
          style={{ width: `${(count / max) * 100}%` }}
        />
      </div>
    </div>
  );
}
