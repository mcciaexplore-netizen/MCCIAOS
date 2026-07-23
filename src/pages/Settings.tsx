import { useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Check,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Button, Card, Input, Select } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useSaveSettings, useSettings } from '@/settings/SettingsContext';
import { BADGE_TONES, DEFAULT_SETTINGS } from '@/constants';
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

export default function Settings() {
  const settings = useSettings();
  const save = useSaveSettings();
  const { toast } = useToast();

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

  async function handleSave() {
    const empty = (Object.keys(draft) as (keyof AppSettings)[]).filter((k) => {
      const v = draft[k] as (string | TonedOption)[];
      return (
        v.length === 0 ||
        v.some((e) => (typeof e === 'string' ? !e.trim() : !e.label.trim()))
      );
    });
    if (empty.length > 0) {
      toast('Remove blank entries before saving', 'error');
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

      <div className="grid gap-4 lg:grid-cols-2">
        <TonedListEditor
          title="Kanban stages"
          description="Columns on the App Development board, in order. The first column is where new companies are added."
          items={draft.projectStages}
          onChange={(v) => patch('projectStages', v)}
        />
        <ListEditor
          title="Team members"
          description="The roster behind every “Assigned to” picker and assignee filter."
          items={draft.teamMembers}
          onChange={(v) => patch('teamMembers', v)}
          placeholder="Name"
        />
        <TonedListEditor
          title="Company statuses"
          description="Lifecycle of an MSME record on the Companies page."
          items={draft.companyStatuses}
          onChange={(v) => patch('companyStatuses', v)}
        />
        <TonedListEditor
          title="Consulting session statuses"
          description="Status values available on the Consulting page."
          items={draft.sessionStatuses}
          onChange={(v) => patch('sessionStatuses', v)}
        />
        <TonedListEditor
          title="Social post statuses"
          description="Status values available on the Social page."
          items={draft.creativeStatuses}
          onChange={(v) => patch('creativeStatuses', v)}
        />
        <ListEditor
          title="Social platforms"
          description="Channels you can file a creative under."
          items={draft.creativePlatforms}
          onChange={(v) => patch('creativePlatforms', v)}
          placeholder="Platform"
        />
        <ListEditor
          title="Lead sources"
          description="How a company first reached you."
          items={draft.leadSources}
          onChange={(v) => patch('leadSources', v)}
          placeholder="Source"
        />
        <ListEditor
          title="Business scales"
          description="MSME size bands."
          items={draft.businessScales}
          onChange={(v) => patch('businessScales', v)}
          placeholder="Scale"
        />
        <ListEditor
          title="Membership statuses"
          description="MCCIA membership state of a company."
          items={draft.membershipStatuses}
          onChange={(v) => patch('membershipStatuses', v)}
          placeholder="Status"
        />
        <ListEditor
          title="Resource categories"
          description="Buckets on the Resources page."
          items={draft.resourceCategories}
          onChange={(v) => patch('resourceCategories', v)}
          placeholder="Category"
        />
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Renaming an entry does not rewrite records that already use the old
        value — those keep their stored label until you edit them.
      </p>

      {/* Save stays reachable while scrolling — the page is taller than the
          viewport, so the header button alone is not enough. */}
      <div className="sticky bottom-4 z-20 mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
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
          <Button
            variant="secondary"
            size="sm"
            onClick={handleDiscard}
            disabled={!dirty || save.isPending}
          >
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
          <Select
            value={item.tone}
            className="w-28 shrink-0"
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
