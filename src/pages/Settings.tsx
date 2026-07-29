import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Check,
  Users,
  Building2,
  MessageSquareText,
  KanbanSquare,
  Megaphone,
  Link2,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Button, Card, Input, Select } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useSaveSettings, useSettings } from '@/settings/SettingsContext';
import { BADGE_TONES, DEFAULT_SETTINGS } from '@/constants';
import { cn } from '@/lib/utils';
import type { AppSettings, TonedOption } from '@/types';

// Pull just the persisted keys out of the context value, dropping the derived
// lookups so they never leak into storage.
function toAppSettings(s: AppSettings): AppSettings {
  return {
    teamMembers: [...s.teamMembers],
    leadSources: [...s.leadSources],
    businessScales: [...s.businessScales],
    membershipStatuses: [...s.membershipStatuses],
    resourceCategories: [...s.resourceCategories],
    creativePlatforms: [...s.creativePlatforms],
    projectStages: s.projectStages.map((o) => ({ ...o })),
    companyStatuses: s.companyStatuses.map((o) => ({ ...o })),
    sessionStatuses: s.sessionStatuses.map((o) => ({ ...o })),
    creativeStatuses: s.creativeStatuses.map((o) => ({ ...o })),
  };
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// Every editor, grouped by the page it configures.
//
// These used to render all at once in a two-column grid — ten cards and around
// sixty inputs on one screen, with no signal about which list drove which page.
// Grouping them by destination means you open the section for the page you are
// changing and see only its lists.
interface Editor {
  key: keyof AppSettings;
  title: string;
  description: string;
  kind: 'plain' | 'toned';
  placeholder?: string;
}

interface Group {
  id: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
  editors: Editor[];
}

const GROUPS: Group[] = [
  {
    id: 'team',
    label: 'Team',
    icon: Users,
    blurb: 'Who work can be assigned to.',
    editors: [
      {
        key: 'teamMembers',
        title: 'Team members',
        description: 'The roster behind every “Assigned to” picker and assignee filter.',
        kind: 'plain',
        placeholder: 'Name',
      },
    ],
  },
  {
    id: 'companies',
    label: 'Companies',
    icon: Building2,
    blurb: 'Vocabularies used on the Companies page.',
    editors: [
      { key: 'companyStatuses', title: 'Company statuses', description: 'Lifecycle of an MSME record.', kind: 'toned' },
      { key: 'leadSources', title: 'Lead sources', description: 'How a company first reached you.', kind: 'plain', placeholder: 'Source' },
      { key: 'businessScales', title: 'Business scales', description: 'MSME size bands.', kind: 'plain', placeholder: 'Scale' },
      { key: 'membershipStatuses', title: 'Membership statuses', description: 'MCCIA membership state of a company.', kind: 'plain', placeholder: 'Status' },
    ],
  },
  {
    id: 'consulting',
    label: 'Consulting',
    icon: MessageSquareText,
    blurb: 'Vocabularies used on the Consulting page.',
    editors: [
      { key: 'sessionStatuses', title: 'Session statuses', description: 'Status values available on a consulting session.', kind: 'toned' },
    ],
  },
  {
    id: 'projects',
    label: 'App Development',
    icon: KanbanSquare,
    blurb: 'The Kanban board on the App Development page.',
    editors: [
      { key: 'projectStages', title: 'Kanban stages', description: 'Board columns, in order. New companies enter at the first column.', kind: 'toned' },
    ],
  },
  {
    id: 'social',
    label: 'Social',
    icon: Megaphone,
    blurb: 'Vocabularies used on the Social page.',
    editors: [
      { key: 'creativeStatuses', title: 'Post statuses', description: 'Status values available on a creative.', kind: 'toned' },
      { key: 'creativePlatforms', title: 'Platforms', description: 'Channels you can file a creative under.', kind: 'plain', placeholder: 'Platform' },
    ],
  },
  {
    id: 'resources',
    label: 'Resources',
    icon: Link2,
    blurb: 'Vocabularies used on the Resources page.',
    editors: [
      { key: 'resourceCategories', title: 'Categories', description: 'Buckets on the Resources page.', kind: 'plain', placeholder: 'Category' },
    ],
  },
];

export default function Settings() {
  const settings = useSettings();
  const save = useSaveSettings();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  const tab = GROUPS.find((g) => g.id === params.get('tab')) ?? GROUPS[0];
  const selectTab = (id: string) => {
    const p = new URLSearchParams(params);
    p.set('tab', id);
    setParams(p, { replace: true });
  };

  const [draft, setDraft] = useState<AppSettings>(() => toAppSettings(settings));
  const [dirty, setDirty] = useState(false);

  // Re-sync once the stored settings arrive, unless there are unsaved edits.
  useEffect(() => {
    if (!settings.isLoading && !dirty) setDraft(toAppSettings(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.isLoading, settings]);

  function patch<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }

  /** Groups holding a blank entry, so the save error can point at the tab. */
  function groupsWithBlanks(): Group[] {
    return GROUPS.filter((g) =>
      g.editors.some((e) => {
        const v = draft[e.key] as (string | TonedOption)[];
        return v.length === 0 || v.some((x) => (typeof x === 'string' ? !x.trim() : !x.label.trim()));
      }),
    );
  }

  async function handleSave() {
    const bad = groupsWithBlanks();
    if (bad.length > 0) {
      // Naming the section matters now that only one is on screen — otherwise
      // the offending blank could be behind a tab you cannot see.
      toast(`Remove blank entries in ${bad.map((g) => g.label).join(', ')}`, 'error');
      selectTab(bad[0].id);
      return;
    }
    try {
      await save.mutateAsync(draft);
      setDirty(false);
      toast('Settings saved');
    } catch (err) {
      toast((err as Error).message || 'Could not save settings', 'error');
    }
  }

  function handleReset() {
    setDraft(toAppSettings(DEFAULT_SETTINGS));
    setDirty(true);
    toast('Defaults restored — press Save to apply');
  }

  function handleDiscard() {
    setDraft(toAppSettings(settings));
    setDirty(false);
    toast('Changes discarded');
  }

  const blanks = new Set(groupsWithBlanks().map((g) => g.id));

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Configure the lists and labels used across the app"
        actions={
          <Button variant="secondary" size="sm" onClick={handleReset}>
            <RotateCcw className="h-4 w-4" /> Reset to defaults
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
        {/* Section rail: vertical on desktop, a scrollable row on mobile. */}
        <nav
          aria-label="Settings sections"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          {GROUPS.map((g) => {
            const active = g.id === tab.id;
            return (
              <button
                key={g.id}
                onClick={() => selectTab(g.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:w-full',
                  active
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
                )}
              >
                <g.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{g.label}</span>
                {blanks.has(g.id) && (
                  <span
                    className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                    title="Has a blank entry"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div>
          <p className="mb-3 text-sm text-slate-500">{tab.blurb}</p>
          <div className="space-y-4">
            {tab.editors.map((e) =>
              e.kind === 'toned' ? (
                <TonedListEditor
                  key={e.key}
                  title={e.title}
                  description={e.description}
                  items={draft[e.key] as TonedOption[]}
                  onChange={(v) => patch(e.key, v as AppSettings[typeof e.key])}
                />
              ) : (
                <ListEditor
                  key={e.key}
                  title={e.title}
                  description={e.description}
                  placeholder={e.placeholder ?? 'Value'}
                  items={draft[e.key] as string[]}
                  onChange={(v) => patch(e.key, v as AppSettings[typeof e.key])}
                />
              ),
            )}
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Renaming an entry does not rewrite records that already use the old
            value — those keep their stored label until you edit them.
          </p>
        </div>
      </div>

      {/* Save stays reachable while scrolling, and reports unsaved changes
          across every section, not just the one on screen. */}
      <div className="sticky bottom-4 z-20 mt-5 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
        <p className="text-sm text-slate-500">
          {dirty ? (
            <span className="font-medium text-amber-600 dark:text-amber-400">
              You have unsaved changes
            </span>
          ) : (
            'All changes saved'
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleDiscard} disabled={!dirty || save.isPending}>
            Discard
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || save.isPending}>
            <Check className="h-4 w-4" />
            {save.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SectionShell({
  title,
  description,
  children,
  onAdd,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onAdd: () => void;
}) {
  return (
    <Card className="p-4">
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      <div className="mt-3 space-y-2">{children}</div>
      <Button variant="secondary" size="sm" className="mt-3" onClick={onAdd}>
        <Plus className="h-4 w-4" /> Add
      </Button>
    </Card>
  );
}

function RowButtons({
  index,
  length,
  onMove,
  onRemove,
}: {
  index: number;
  length: number;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const iconBtn =
    'rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-slate-800 dark:hover:text-slate-200';
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        aria-label="Move up"
        className={iconBtn}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Move down"
        className={iconBtn}
        disabled={index === length - 1}
        onClick={() => onMove(index + 1)}
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Remove"
        className={`${iconBtn} hover:text-rose-600 dark:hover:text-rose-400`}
        disabled={length === 1}
        onClick={onRemove}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function ListEditor({
  title,
  description,
  items,
  onChange,
  placeholder,
}: {
  title: string;
  description: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  return (
    <SectionShell
      title={title}
      description={description}
      onAdd={() => onChange([...items, ''])}
    >
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            className="min-w-0 flex-1"
            value={item}
            placeholder={placeholder}
            onChange={(e) =>
              onChange(items.map((v, j) => (j === i ? e.target.value : v)))
            }
          />
          <RowButtons
            index={i}
            length={items.length}
            onMove={(to) => onChange(move(items, i, to))}
            onRemove={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
    </SectionShell>
  );
}

function TonedListEditor({
  title,
  description,
  items,
  onChange,
}: {
  title: string;
  description: string;
  items: TonedOption[];
  onChange: (items: TonedOption[]) => void;
}) {
  return (
    <SectionShell
      title={title}
      description={description}
      onAdd={() => onChange([...items, { label: '', tone: 'gray' }])}
    >
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            className="min-w-0 flex-1"
            value={item.label}
            placeholder="Label"
            onChange={(e) =>
              onChange(
                items.map((v, j) =>
                  j === i ? { ...v, label: e.target.value } : v,
                ),
              )
            }
          />
          <div className="w-24 shrink-0 sm:w-28">
          <Select
            value={item.tone}
            aria-label="Colour"
            onChange={(e) =>
              onChange(
                items.map((v, j) =>
                  j === i ? { ...v, tone: e.target.value } : v,
                ),
              )
            }
          >
            {BADGE_TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          </div>
          <Badge tone={item.tone} className="hidden shrink-0 sm:inline-flex">
            {item.label || 'preview'}
          </Badge>
          <RowButtons
            index={i}
            length={items.length}
            onMove={(to) => onChange(move(items, i, to))}
            onRemove={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
    </SectionShell>
  );
}
