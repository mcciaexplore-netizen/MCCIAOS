import { useMemo, useState } from 'react';
import {
  Code2,
  Copy,
  Eye,
  Monitor,
  Plus,
  Search,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FilterPill,
  Input,
  Modal,
  Textarea,
} from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useTemplates } from '@/hooks';
import { useSettings } from '@/settings/SettingsContext';
import type { Template } from '@/types';
import { relativeTime } from '@/lib/utils';

/**
 * Renders a template's HTML in an isolated iframe.
 *
 * The sandbox attribute is deliberately empty: that denies scripts, forms,
 * popups, top-level navigation and same-origin access all at once. Template
 * HTML is pasted in by hand and is not trusted content — a <script> tag in a
 * preview must not be able to reach the app's DOM, its storage, or its API.
 * Email clients strip scripts anyway, so nothing legitimate is lost.
 */
function HtmlPreview({ html, width }: { html: string; width: 'desktop' | 'mobile' }) {
  return (
    <div
      className="mx-auto h-full overflow-hidden rounded-lg border border-slate-200 bg-white transition-[max-width] dark:border-slate-700"
      style={{ maxWidth: width === 'mobile' ? 390 : '100%' }}
    >
      <iframe
        // Keying on the HTML forces a fresh document rather than mutating the
        // previous one, which otherwise leaves styles from the old markup.
        key={html}
        title="Template preview"
        sandbox=""
        srcDoc={html}
        className="h-full w-full border-0 bg-white"
      />
    </div>
  );
}

export default function Templates() {
  const { items, isError, error, invalidate, create, update, remove } = useTemplates();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [editing, setEditing] = useState<Template | null>(null);
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<Template | null>(null);

  const categories = useMemo(
    () => [...new Set(items.map((t) => t.category).filter(Boolean))] as string[],
    [items],
  );

  const filtered = useMemo(
    () =>
      items.filter((t) => {
        if (category !== 'all' && t.category !== category) return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          t.name?.toLowerCase().includes(q) ||
          t.subject?.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q)
        );
      }),
    [items, search, category],
  );

  return (
    <div>
      <PageHeader
        title="Email Templates"
        subtitle={`${items.length} HTML template${items.length === 1 ? '' : 's'}`}
        actions={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New Template
          </Button>
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
            placeholder="Search templates..."
            className="pl-9"
          />
        </div>
        {categories.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <FilterPill active={category === 'all'} onClick={() => setCategory('all')}>
              All
            </FilterPill>
            {categories.map((c) => (
              <FilterPill key={c} active={category === c} onClick={() => setCategory(c)}>
                {c}
              </FilterPill>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Code2 className="h-10 w-10" />}
          title={items.length === 0 ? 'No templates yet' : 'No templates match'}
          description={
            items.length === 0
              ? 'Paste the HTML of an email template and preview it here.'
              : 'Try clearing the search or filter.'
          }
          action={
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              New Template
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => (
            <Card key={t.id} className="flex flex-col overflow-hidden">
              {/* A live thumbnail of the real markup, not a stock icon. */}
              <div className="h-40 shrink-0 overflow-hidden border-b border-slate-100 bg-white dark:border-slate-800">
                <iframe
                  key={t.id + (t.updatedAt ?? '')}
                  title={`${t.name} thumbnail`}
                  sandbox=""
                  srcDoc={t.html}
                  aria-hidden="true"
                  tabIndex={-1}
                  className="pointer-events-none h-[400px] w-[640px] origin-top-left scale-[0.4] border-0 bg-white"
                />
              </div>
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="truncate font-semibold text-slate-900 dark:text-slate-100">
                    {t.name}
                  </h3>
                  {t.category && <Badge tone="violet">{t.category}</Badge>}
                </div>
                {t.subject && (
                  <p className="mt-0.5 truncate text-sm text-slate-500">{t.subject}</p>
                )}
                {t.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-slate-400">{t.description}</p>
                )}
                <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <Button variant="secondary" size="sm" onClick={() => setPreviewing(t)}>
                    <Eye className="h-4 w-4" /> Preview
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(t);
                      setOpen(true);
                    }}
                  >
                    <Code2 className="h-4 w-4" /> Edit
                  </Button>
                  <span className="ml-auto text-xs text-slate-400">
                    {relativeTime(t.updatedAt ?? t.createdAt)}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <TemplateEditor
        open={open}
        template={editing}
        onClose={() => setOpen(false)}
        onSave={async (data) => {
          if (editing) {
            await update.mutateAsync({ id: editing.id, data: data as Partial<Template> });
            toast('Template updated');
          } else {
            await create.mutateAsync(data as Partial<Template>);
            toast('Template created');
          }
          setOpen(false);
        }}
        onDelete={
          editing
            ? async () => {
                await remove.mutateAsync(editing.id);
                toast('Template deleted');
                setOpen(false);
              }
            : undefined
        }
      />

      <Modal
        open={previewing !== null}
        onClose={() => setPreviewing(null)}
        size="xl"
        title={previewing?.name ?? 'Preview'}
        description={previewing?.subject}
      >
        <div className="h-[60vh]">
          {previewing && <HtmlPreview html={previewing.html} width="desktop" />}
        </div>
      </Modal>
    </div>
  );
}

const STARTER_HTML = `<!-- Paste your email HTML here -->
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h1 style="color:#0B1F3A; font-size:22px;">MCCIA Applied AI Studio</h1>
  <p style="color:#333; line-height:1.6;">Hello {{name}},</p>
  <p style="color:#333; line-height:1.6;">Your message goes here.</p>
  <a href="#" style="display:inline-block;background:#2E8B57;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Call to action</a>
</div>`;

function TemplateEditor({
  open,
  template,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  template: Template | null;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const { toast } = useToast();
  const { resourceCategories } = useSettings();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [html, setHtml] = useState(STARTER_HTML);
  const [tab, setTab] = useState<'code' | 'preview'>('code');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [saving, setSaving] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Reset the form when the modal opens onto a different record. Driven by an
  // id rather than an effect so the fields never clobber in-progress typing.
  const key = template?.id ?? 'new';
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setName(template?.name ?? '');
    setSubject(template?.subject ?? '');
    setDescription(template?.description ?? '');
    setCategory(template?.category ?? '');
    setHtml(template?.html ?? STARTER_HTML);
    setTab('code');
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const errors = {
    name: !name.trim() ? 'Name the template' : '',
    html: !html.trim() ? 'Paste the template HTML' : '',
  };
  const valid = !errors.name && !errors.html;

  async function submit() {
    if (!valid) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        subject: subject.trim() || undefined,
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        html,
      });
    } catch (err) {
      toast((err as Error).message || 'Could not save template', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={template ? 'Edit Template' : 'New Template'}
      description="Paste HTML on the left, see it rendered on the right."
      footer={
        <div className="flex items-center justify-between gap-3">
          {onDelete ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
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
            <Button size="sm" onClick={submit} disabled={!valid || saving}>
              {saving ? 'Saving...' : 'Save template'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required error={errors.name}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Workshop invite"
            />
          </Field>
          <Field label="Subject line">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="You're invited: AI for MSMEs"
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" hint="Groups templates on this page.">
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={resourceCategories[0] ?? 'Workshop'}
              list="template-categories"
            />
            <datalist id="template-categories">
              {resourceCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Sent to registrants the day before"
            />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FilterPill active={tab === 'code'} onClick={() => setTab('code')}>
                <Code2 className="h-3.5 w-3.5" /> HTML
              </FilterPill>
              <FilterPill active={tab === 'preview'} onClick={() => setTab('preview')}>
                <Eye className="h-3.5 w-3.5" /> Preview
              </FilterPill>
            </div>
            <div className="flex items-center gap-1.5">
              {tab === 'preview' && (
                <>
                  <button
                    onClick={() => setDevice('desktop')}
                    aria-label="Desktop width"
                    className={
                      'rounded-md p-1.5 ' +
                      (device === 'desktop'
                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
                        : 'text-slate-400')
                    }
                  >
                    <Monitor className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setDevice('mobile')}
                    aria-label="Mobile width"
                    className={
                      'rounded-md p-1.5 ' +
                      (device === 'mobile'
                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
                        : 'text-slate-400')
                    }
                  >
                    <Smartphone className="h-4 w-4" />
                  </button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(html);
                  toast('HTML copied');
                }}
              >
                <Copy className="h-4 w-4" /> Copy
              </Button>
            </div>
          </div>

          {tab === 'code' ? (
            <>
              <Textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                spellCheck={false}
                className="h-[46vh] resize-none font-mono text-xs leading-relaxed"
                placeholder="<html>..."
              />
              {errors.html && (
                <p className="mt-1 text-xs text-rose-500">{errors.html}</p>
              )}
            </>
          ) : (
            <div className="h-[46vh]">
              <HtmlPreview html={html} width={device} />
            </div>
          )}
          <p className="mt-2 text-xs text-slate-400">
            The preview runs in a sandboxed frame with scripts disabled, so it
            shows exactly what an email client would render.
          </p>
        </div>
      </div>
    </Modal>
  );
}
