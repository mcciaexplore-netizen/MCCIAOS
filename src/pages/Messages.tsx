import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarClock,
  Copy,
  Eye,
  Mail,
  MessageCircle,
  Plus,
  Search,
  Send,
  Trash2,
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
  Modal,
  Select,
  Textarea,
} from '@/components/ui';
import { AssigneeSelect } from '@/components/FormControls';
import { useToast } from '@/components/Toast';
import { TimeBars, type ChartTone, type Point } from '@/components/charts';
import { useMessages, useTemplates } from '@/hooks';
import { MESSAGE_STATUSES } from '@/schemas';
import type { Message, MessageChannel, MessageKind, MessageStatus } from '@/types';
import { formatDate, relativeTime } from '@/lib/utils';

const CHANNEL_LABEL: Record<MessageChannel, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
};

const KIND_LABEL: Record<MessageKind, string> = {
  daily: 'Daily',
  workshop: 'Workshop',
};

const STATUS_TONE: Record<MessageStatus, string> = {
  draft: 'gray',
  scheduled: 'amber',
  sent: 'green',
  failed: 'rose',
};

/** IST calendar day for a stored timestamp. */
function istDay(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

/**
 * Zero-filled daily counts for the last `days` IST days.
 *
 * Computed client-side rather than through a dedicated endpoint because the
 * message list is already loaded here and is small — adding a round trip to
 * count what is in memory would be slower, not faster.
 */
function dailySeries(messages: Message[], days = 30): Point[] {
  const counts = new Map<string, number>();
  for (const m of messages) {
    const day = istDay(m.sentAt || m.scheduledFor || m.createdAt);
    if (day) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const out: Point[] = [];
  const today = new Date(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()) +
      'T00:00:00Z',
  );
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ bucket: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

export default function Messages() {
  const { items, isError, error, invalidate, create, update, remove } = useMessages();
  const templates = useTemplates();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  const kind = (params.get('kind') ?? 'all') as MessageKind | 'all';
  const channel = (params.get('channel') ?? 'all') as MessageChannel | 'all';
  const status = (params.get('status') ?? 'all') as MessageStatus | 'all';
  const setFilter = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v === 'all') p.delete(k);
    else p.set(k, v);
    setParams(p, { replace: true });
  };

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Message | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [preview, setPreview] = useState<Message | null>(null);

  const filtered = useMemo(
    () =>
      items.filter((m) => {
        if (kind !== 'all' && m.kind !== kind) return false;
        if (channel !== 'all' && m.channel !== channel) return false;
        if (status !== 'all' && m.status !== status) return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          m.title?.toLowerCase().includes(q) ||
          m.body?.toLowerCase().includes(q) ||
          m.audience?.toLowerCase().includes(q)
        );
      }),
    [items, kind, channel, status, search],
  );

  const whatsapp = useMemo(() => items.filter((m) => m.channel === 'whatsapp'), [items]);
  const email = useMemo(() => items.filter((m) => m.channel === 'email'), [items]);

  const reach = useMemo(
    () =>
      items
        .filter((m) => m.status === 'sent')
        .reduce((n, m) => n + (Number(m.recipientCount) || 0), 0),
    [items],
  );

  const templateName = (id?: string | null) =>
    templates.items.find((t) => t.id === id)?.name;

  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle={`${items.length} recorded · ${reach.toLocaleString('en-IN')} recipients reached`}
        actions={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDrawer(true);
            }}
          >
            <Plus className="h-4 w-4" /> New Message
          </Button>
        }
      />

      {isError && (
        <div className="mb-4">
          <ErrorState error={error} onRetry={invalidate} />
        </div>
      )}

      {/* Outreach volume — one chart per channel, each a single series. */}
      <div className="mb-5 grid gap-3 lg:grid-cols-2">
        <VolumeCard
          title="WhatsApp"
          icon={<MessageCircle className="h-4 w-4" />}
          messages={whatsapp}
          tone="primary"
        />
        <VolumeCard
          title="Email"
          icon={<Mail className="h-4 w-4" />}
          messages={email}
          tone="accent"
        />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages..."
            className="pl-9"
          />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <FilterPill active={kind === 'all'} onClick={() => setFilter('kind', 'all')}>
            All
          </FilterPill>
          {(['daily', 'workshop'] as MessageKind[]).map((k) => (
            <FilterPill key={k} active={kind === k} onClick={() => setFilter('kind', k)}>
              {KIND_LABEL[k]}
            </FilterPill>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />
          {(['whatsapp', 'email'] as MessageChannel[]).map((c) => (
            <FilterPill
              key={c}
              active={channel === c}
              onClick={() => setFilter('channel', channel === c ? 'all' : c)}
            >
              {CHANNEL_LABEL[c]}
            </FilterPill>
          ))}
          <Select
            value={status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="w-auto min-w-[8rem]"
            aria-label="Status"
          >
            <option value="all">Any status</option>
            {MESSAGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Send className="h-10 w-10" />}
          title={items.length === 0 ? 'No messages recorded yet' : 'No messages match'}
          description={
            items.length === 0
              ? 'Record the daily WhatsApp and email sends, and workshop notices, so the team can see what went out.'
              : 'Try clearing the filters or the search.'
          }
          action={
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDrawer(true);
              }}
            >
              New Message
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((m) => (
            <Card key={m.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {m.channel === 'whatsapp' ? (
                    <MessageCircle className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Mail className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <h3 className="truncate font-semibold text-slate-900 dark:text-slate-100">
                    {m.title}
                  </h3>
                </div>
                <Badge tone={STATUS_TONE[m.status] ?? 'gray'}>{m.status}</Badge>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={m.kind === 'workshop' ? 'violet' : 'blue'}>
                  {KIND_LABEL[m.kind]}
                </Badge>
                {m.audience && <Badge tone="gray">{m.audience}</Badge>}
                {m.templateId && templateName(m.templateId) && (
                  <Badge tone="brand">{templateName(m.templateId)}</Badge>
                )}
              </div>

              {m.subject && (
                <p className="mt-2 truncate text-sm text-slate-500">{m.subject}</p>
              )}
              {m.body && (
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-slate-400">
                  {m.body}
                </p>
              )}

              <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                <Button variant="ghost" size="sm" onClick={() => setPreview(m)}>
                  <Eye className="h-4 w-4" /> View
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(m);
                    setDrawer(true);
                  }}
                >
                  Edit
                </Button>
                <span className="ml-auto text-right text-xs text-slate-400">
                  {m.status === 'scheduled' && m.scheduledFor
                    ? `for ${formatDate(m.scheduledFor)}`
                    : m.sentAt
                      ? relativeTime(m.sentAt)
                      : relativeTime(m.createdAt)}
                  {m.recipientCount ? ` · ${m.recipientCount}` : ''}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <MessageDrawer
        open={drawer}
        message={editing}
        templates={templates.items}
        onClose={() => setDrawer(false)}
        onSave={async (data) => {
          if (editing) {
            await update.mutateAsync({ id: editing.id, data: data as Partial<Message> });
            toast('Message updated');
          } else {
            await create.mutateAsync(data as Partial<Message>);
            toast('Message recorded');
          }
          setDrawer(false);
        }}
        onDelete={
          editing
            ? async () => {
                await remove.mutateAsync(editing.id);
                toast('Message deleted');
                setDrawer(false);
              }
            : undefined
        }
      />

      <MessagePreview
        message={preview}
        template={templates.items.find((t) => t.id === preview?.templateId)}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}

function VolumeCard({
  title,
  icon,
  messages,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  messages: Message[];
  tone: ChartTone;
}) {
  const points = useMemo(() => dailySeries(messages), [messages]);
  const sent = messages.filter((m) => m.status === 'sent').length;
  const scheduled = messages.filter((m) => m.status === 'scheduled').length;
  const reach = messages
    .filter((m) => m.status === 'sent')
    .reduce((n, m) => n + (Number(m.recipientCount) || 0), 0);
  const empty = points.every((p) => p.count === 0);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          {icon} {title}
        </h3>
        <p className="text-xs text-slate-400">
          <span className="font-medium text-slate-600 dark:text-slate-300">{sent}</span> sent
          {scheduled > 0 && ` · ${scheduled} scheduled`}
          {reach > 0 && ` · ${reach.toLocaleString('en-IN')} reached`}
        </p>
      </div>
      {empty ? (
        <p className="flex h-[196px] items-center justify-center text-center text-sm text-slate-400">
          No {title} messages in the last 30 days
        </p>
      ) : (
        <TimeBars points={points} tone={tone} />
      )}
    </Card>
  );
}

function MessagePreview({
  message,
  template,
  onClose,
}: {
  message: Message | null;
  template?: { html: string; name: string };
  onClose: () => void;
}) {
  const { toast } = useToast();
  if (!message) return null;
  const isEmailTemplate = message.channel === 'email' && template;

  return (
    <Modal
      open
      onClose={onClose}
      size={isEmailTemplate ? 'xl' : 'lg'}
      title={message.title}
      description={`${CHANNEL_LABEL[message.channel]} · ${KIND_LABEL[message.kind]}${
        message.audience ? ` · ${message.audience}` : ''
      }`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            Copy this out to whatever actually sends it.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(
                isEmailTemplate ? template.html : (message.body ?? ''),
              );
              toast('Copied to clipboard');
            }}
          >
            <Copy className="h-4 w-4" /> Copy {isEmailTemplate ? 'HTML' : 'text'}
          </Button>
        </div>
      }
    >
      {message.subject && (
        <p className="mb-3 text-sm">
          <span className="text-slate-400">Subject: </span>
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {message.subject}
          </span>
        </p>
      )}
      {isEmailTemplate ? (
        <div className="h-[55vh] overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700">
          {/* Same sandbox rules as the Templates page. */}
          <iframe
            title="Message preview"
            sandbox=""
            srcDoc={template.html}
            className="h-full w-full border-0 bg-white"
          />
        </div>
      ) : (
        <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
          {message.body || 'No body recorded.'}
        </pre>
      )}
      {message.notes && (
        <p className="mt-3 text-xs text-slate-400">Notes: {message.notes}</p>
      )}
    </Modal>
  );
}

function MessageDrawer({
  open,
  message,
  templates,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  message: Message | null;
  templates: { id: string; name: string }[];
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<Record<string, string>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const key = message?.id ?? 'new';
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setForm({
      channel: message?.channel ?? 'whatsapp',
      kind: message?.kind ?? 'daily',
      title: message?.title ?? '',
      body: message?.body ?? '',
      templateId: message?.templateId ?? '',
      subject: message?.subject ?? '',
      audience: message?.audience ?? '',
      recipientCount: message?.recipientCount ? String(message.recipientCount) : '',
      scheduledFor: message?.scheduledFor?.slice(0, 10) ?? '',
      sentAt: message?.sentAt?.slice(0, 10) ?? '',
      status: message?.status ?? 'draft',
      notes: message?.notes ?? '',
      assignedTo: message?.assignedTo ?? '',
    });
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isEmail = form.channel === 'email';

  // Mirrors the refinements on messageSchema so the drawer reports the same
  // rules the server enforces, rather than failing only on submit.
  const errors = {
    title: !form.title?.trim() ? 'Give the message a title' : '',
    body:
      !isEmail && !form.body?.trim()
        ? 'WhatsApp messages need body text'
        : isEmail && !form.templateId && !form.body?.trim()
          ? 'Pick a template or write the email body'
          : '',
    scheduledFor:
      form.status === 'scheduled' && !form.scheduledFor
        ? 'A scheduled message needs a date'
        : '',
  };
  const valid = !errors.title && !errors.body && !errors.scheduledFor;

  async function submit() {
    if (!valid) return;
    setSaving(true);
    try {
      await onSave({
        channel: form.channel,
        kind: form.kind,
        title: form.title.trim(),
        body: form.body?.trim() || undefined,
        templateId: isEmail && form.templateId ? form.templateId : null,
        subject: form.subject?.trim() || undefined,
        audience: form.audience?.trim() || undefined,
        recipientCount: form.recipientCount ? Number(form.recipientCount) : undefined,
        scheduledFor: form.scheduledFor || undefined,
        sentAt: form.sentAt || undefined,
        status: form.status,
        notes: form.notes?.trim() || undefined,
        assignedTo: form.assignedTo || null,
      });
    } catch (err) {
      toast((err as Error).message || 'Could not save message', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={message ? 'Edit Message' : 'New Message'}
      description="Recorded here and copied out to send — nothing is delivered from the app yet."
      footer={
        <div className="flex items-center justify-between">
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
              {saving ? 'Saving...' : message ? 'Save' : 'Record message'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Channel" required>
            <Select value={form.channel} onChange={(e) => set('channel', e.target.value)}>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </Select>
          </Field>
          <Field label="Type" required>
            <Select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
              <option value="daily">Daily message</option>
              <option value="workshop">Workshop message</option>
            </Select>
          </Field>
        </div>

        <Field label="Title" required error={errors.title}>
          <Input
            value={form.title ?? ''}
            onChange={(e) => set('title', e.target.value)}
            placeholder={
              form.kind === 'workshop' ? 'AI for MSMEs — reminder' : 'Daily update, 29 Jul'
            }
          />
        </Field>

        {isEmail && (
          <>
            <Field label="Subject line">
              <Input
                value={form.subject ?? ''}
                onChange={(e) => set('subject', e.target.value)}
              />
            </Field>
            <Field
              label="Template"
              hint={
                templates.length === 0
                  ? 'No templates yet — create one on the Templates page.'
                  : 'Uses the saved HTML when sending.'
              }
            >
              <Select
                value={form.templateId ?? ''}
                onChange={(e) => set('templateId', e.target.value)}
              >
                <option value="">No template — plain body below</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        <Field
          label={isEmail ? 'Body (used when no template)' : 'Message text'}
          required={!isEmail}
          error={errors.body}
        >
          <Textarea
            value={form.body ?? ''}
            onChange={(e) => set('body', e.target.value)}
            className="min-h-[140px]"
            placeholder={
              isEmail ? 'Plain-text fallback...' : 'Good morning, here is today’s update...'
            }
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Audience" hint="Who it went to.">
            <Input
              value={form.audience ?? ''}
              onChange={(e) => set('audience', e.target.value)}
              placeholder="MSME members"
            />
          </Field>
          <Field label="Recipients">
            <Input
              type="number"
              min={0}
              value={form.recipientCount ?? ''}
              onChange={(e) => set('recipientCount', e.target.value)}
              placeholder="0"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status" required>
            <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {MESSAGE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assigned to">
            <AssigneeSelect
              value={form.assignedTo ?? ''}
              onChange={(e) => set('assignedTo', e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Scheduled for"
            error={errors.scheduledFor}
            hint={form.status === 'scheduled' ? undefined : 'Only for scheduled messages.'}
          >
            <Input
              type="date"
              value={form.scheduledFor ?? ''}
              onChange={(e) => set('scheduledFor', e.target.value)}
            />
          </Field>
          <Field label="Sent on">
            <Input
              type="date"
              value={form.sentAt ?? ''}
              onChange={(e) => set('sentAt', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea
            value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Anything worth remembering about this send."
          />
        </Field>

        {message && (
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <CalendarClock className="h-3.5 w-3.5" />
            Added {relativeTime(message.createdAt)}
            {message.createdBy ? ` by ${message.createdBy}` : ''}.
          </p>
        )}
      </div>
    </SlideOver>
  );
}
