import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Link2,
  Plus,
  Search,
  Trash2,
  ExternalLink,
  Table,
  LayoutDashboard,
  Workflow,
  FileText,
  Boxes,
} from 'lucide-react';
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
import { useToast } from '@/components/Toast';
import { DataTransfer } from '@/components/DataTransfer';
import { useResources } from '@/hooks';
import { resourceSchema, type ResourceInput } from '@/schemas';
import { useSettings } from '@/settings/SettingsContext';
import type { Resource, ResourceCategory } from '@/types';
import { relativeTime } from '@/lib/utils';

// Icons for the built-in categories. Custom categories added on the Settings
// page fall back to the generic Boxes icon.
const categoryIcon: Record<ResourceCategory, typeof Table> = {
  Sheet: Table,
  Dashboard: LayoutDashboard,
  Automation: Workflow,
  Docs: FileText,
  Other: Boxes,
};

export default function Resources() {
  const { items, isError, error, invalidate, create, update, remove } = useResources();
  const { resourceCategories } = useSettings();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [editing, setEditing] = useState<Resource | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = useMemo(() => {
    return items.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          r.name?.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, category, search]);

  return (
    <div>
      <PageHeader
        title="Resources"
        subtitle="Shared links, visible to the whole team"
        actions={
          <>
            <DataTransfer sheet="Resource" />
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDrawerOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add Resource
            </Button>
          </>
        }
      />

      {isError && (
        <div className="mb-4">
          <ErrorState error={error} onRetry={invalidate} />
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search resources..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterPill active={category === 'all'} onClick={() => setCategory('all')}>
            All
          </FilterPill>
          {resourceCategories.map((c) => (
            <FilterPill key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </FilterPill>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Link2 className="h-10 w-10" />}
          title="No resources yet"
          description="Add a shared link (sheet, dashboard, automation) for the team."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => {
            const Icon = categoryIcon[r.category] ?? Boxes;
            return (
              <Card key={r.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="truncate font-semibold text-slate-900 dark:text-slate-100">
                        {r.name}
                      </h3>
                      <Badge tone="gray">{r.category}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                      {r.description}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </a>
                  <button
                    onClick={() => {
                      setEditing(r);
                      setDrawerOpen(true);
                    }}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    {r.addedBy ? `Added by ${r.addedBy} · ` : ''}edit
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resource={editing}
        onCreate={async (data) => {
          await create.mutateAsync(data as Partial<Resource>);
          toast('Resource added');
          setDrawerOpen(false);
        }}
        onUpdate={async (id, data) => {
          await update.mutateAsync({ id, data: data as Partial<Resource> });
          toast('Resource updated');
          setDrawerOpen(false);
        }}
        onDelete={async (id) => {
          await remove.mutateAsync(id);
          toast('Resource deleted');
          setDrawerOpen(false);
        }}
      />
    </div>
  );
}

function ResourceDrawer({
  open,
  onClose,
  resource,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  resource: Resource | null;
  onCreate: (data: ResourceInput) => Promise<void>;
  onUpdate: (id: string, data: ResourceInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { resourceCategories, teamMembers } = useSettings();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ResourceInput>({
    resolver: zodResolver(resourceSchema),
    values: resource
      ? (resource as unknown as ResourceInput)
      : {
          name: '',
          url: '',
          description: '',
          category: resourceCategories[0],
          addedBy: '',
        },
  });

  const submit = handleSubmit(async (data) => {
    if (resource) await onUpdate(resource.id, data);
    else await onCreate(data);
    reset();
  });

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={resource ? 'Edit Resource' : 'Add Resource'}
      footer={
        <div className="flex items-center justify-between">
          {resource ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(resource.id)}
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
              {resource ? 'Save' : 'Add Resource'}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name" required error={errors.name?.message}>
          <Input {...register('name')} placeholder="MSME Master Sheet" />
        </Field>
        <Field label="URL" required error={errors.url?.message}>
          <Input {...register('url')} placeholder="https://..." />
        </Field>
        <Field label="Description" required error={errors.description?.message}>
          <Textarea {...register('description')} placeholder="What is this link for?" />
        </Field>
        <Field label="Category" required>
          <Select {...register('category')}>
            {resourceCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Added by" hint="Optional">
          <Select {...register('addedBy')}>
            <option value="">Not specified</option>
            {teamMembers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </SlideOver>
  );
}
