import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Megaphone, Plus, Trash2, Image as ImageIcon } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SlideOver } from '@/components/SlideOver';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FilterPill,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { AssigneeSelect, CompanySelect, useCompanyMap } from '@/components/FormControls';
import { useToast } from '@/components/Toast';
import { useCreatives } from '@/hooks';
import { creativeSchema, type CreativeInput } from '@/schemas';
import { useSettings } from '@/settings/SettingsContext';
import type { Creative } from '@/types';
import { relativeTime } from '@/lib/utils';

export default function Social() {
  const { items, isError, error, invalidate, create, update, remove } = useCreatives();
  const companyMap = useCompanyMap();
  const { creativeStatusValues, creativeStatusTone } = useSettings();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState<Creative | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = useMemo(
    () => items.filter((c) => statusFilter === 'all' || c.status === statusFilter),
    [items, statusFilter],
  );

  return (
    <div>
      <PageHeader
        title="Social"
        subtitle={`${items.length} creatives`}
        actions={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDrawerOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add Creative
          </Button>
        }
      />

      {isError && (
        <div className="mb-4">
          <ErrorState error={error} onRetry={invalidate} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <FilterPill active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
          All
        </FilterPill>
        {creativeStatusValues.map((s) => (
          <FilterPill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
            {s}
          </FilterPill>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-10 w-10" />}
          title="No creatives yet"
          description="Track social content drafts, schedules, and posts here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <Card
              key={c.id}
              className="overflow-hidden"
              onClick={() => {
                setEditing(c);
                setDrawerOpen(true);
              }}
            >
              <div className="flex h-32 items-center justify-center bg-slate-100 dark:bg-slate-800">
                {c.imageUrl ? (
                  <img
                    src={c.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <Badge tone="brand">{c.platform}</Badge>
                  <Badge tone={creativeStatusTone[c.status] ?? 'gray'}>{c.status}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
                  {c.caption || 'No caption'}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {companyMap[c.companyId] ?? 'Unknown company'}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreativeDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        creative={editing}
        onCreate={async (data) => {
          await create.mutateAsync(data as Partial<Creative>);
          toast('Creative added');
          setDrawerOpen(false);
        }}
        onUpdate={async (id, data) => {
          await update.mutateAsync({ id, data: data as Partial<Creative> });
          toast('Creative updated');
          setDrawerOpen(false);
        }}
        onDelete={async (id) => {
          await remove.mutateAsync(id);
          toast('Creative deleted');
          setDrawerOpen(false);
        }}
      />
    </div>
  );
}

function CreativeDrawer({
  open,
  onClose,
  creative,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  creative: Creative | null;
  onCreate: (data: CreativeInput) => Promise<void>;
  onUpdate: (id: string, data: CreativeInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { creativePlatforms, creativeStatusValues } = useSettings();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreativeInput>({
    resolver: zodResolver(creativeSchema),
    values: creative
      ? (creative as unknown as CreativeInput)
      : {
          companyId: '',
          platform: creativePlatforms[0],
          status: creativeStatusValues[0],
        },
  });

  const submit = handleSubmit(async (data) => {
    if (creative) await onUpdate(creative.id, data);
    else await onCreate(data);
    reset();
  });

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={creative ? 'Edit Creative' : 'Add Creative'}
      footer={
        <div className="flex items-center justify-between">
          {creative ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(creative.id)}
              className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={isSubmitting}>
              {creative ? 'Save' : 'Add Creative'}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Company" required error={errors.companyId?.message}>
          <CompanySelect {...register('companyId')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Platform" required>
            <Select {...register('platform')}>
              {creativePlatforms.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" required>
            <Select {...register('status')}>
              {creativeStatusValues.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Image URL" error={errors.imageUrl?.message}>
          <Input {...register('imageUrl')} placeholder="https://..." />
        </Field>
        <Field label="Caption">
          <Textarea {...register('caption')} placeholder="Post caption or brief" />
        </Field>
        <Field label="Assigned to">
          <AssigneeSelect {...register('assignedTo')} />
        </Field>
        {creative && (
          <p className="text-xs text-slate-400">
            Added {relativeTime(creative.createdAt)}
            {creative.createdBy ? ` by ${creative.createdBy}` : ''}.
          </p>
        )}
      </form>
    </SlideOver>
  );
}
