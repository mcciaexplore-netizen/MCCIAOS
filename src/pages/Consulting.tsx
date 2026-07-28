import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  MessageSquareText,
  Plus,
  Search,
  Trash2,
  CalendarClock,
  CheckCircle2,
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
import {
  AssigneeSelect,
  AssigneeFilterSelect,
  CompanySelect,
  matchesAssignee,
  useCompanyMap,
} from '@/components/FormControls';
import { useToast } from '@/components/Toast';
import { DataTransfer } from '@/components/DataTransfer';
import { useSessions, useFollowups } from '@/hooks';
import { sessionSchema, type SessionInput } from '@/schemas';
import { useSettings } from '@/settings/SettingsContext';
import type { Session } from '@/types';
import { formatDate, relativeTime, daysUntil } from '@/lib/utils';

export default function Consulting() {
  const { items, isError, error, invalidate, create, update, remove } = useSessions();
  const followups = useFollowups();
  const companyMap = useCompanyMap();
  const { sessionStatusValues, sessionStatusTone } = useSettings();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState<Session | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = useMemo(() => {
    return items.filter((s) => {
      if (!matchesAssignee(s.assignedTo, assignee)) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          s.query?.toLowerCase().includes(q) ||
          companyMap[s.companyId]?.toLowerCase().includes(q) ||
          s.domain?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, assignee, statusFilter, search, companyMap]);

  const followupFor = (sessionId: string) =>
    followups.items.find((f) => f.sessionId === sessionId && !f.done);

  return (
    <div>
      <PageHeader
        title="Consulting"
        subtitle={`${items.length} sessions logged`}
        actions={
          <>
            <DataTransfer sheet="Session" />
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDrawerOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add Session
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
            placeholder="Search sessions..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AssigneeFilterSelect
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <FilterPill active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
          Any status
        </FilterPill>
        {sessionStatusValues.map((s) => (
          <FilterPill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
            {s}
          </FilterPill>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<MessageSquareText className="h-10 w-10" />}
          title="No sessions here"
          description="Log a consultation to get started."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((s) => {
            const fu = followupFor(s.id);
            return (
              <Card
                key={s.id}
                className="p-4"
                onClick={() => {
                  setEditing(s);
                  setDrawerOpen(true);
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-slate-900 dark:text-slate-100">
                      {companyMap[s.companyId] ?? 'Unknown company'}
                    </h3>
                    <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{s.query}</p>
                  </div>
                  <Badge tone={sessionStatusTone[s.status] ?? 'gray'}>{s.status}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {s.domain && <Badge tone="gray">{s.domain}</Badge>}
                  {fu && (
                    <Badge tone={(daysUntil(fu.dueDate) ?? 9) <= 2 ? 'rose' : 'amber'}>
                      <CalendarClock className="h-3 w-3" /> {formatDate(fu.dueDate)}
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-slate-400">
                    {s.assignedTo ? s.assignedTo : 'Unassigned'}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <SessionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        session={editing}
        existingFollowup={editing ? followupFor(editing.id) : undefined}
        onSave={async (data, followup) => {
          let sessionId = editing?.id;
          if (editing) {
            await update.mutateAsync({ id: editing.id, data: data as Partial<Session> });
            toast('Session updated');
          } else {
            const res = await create.mutateAsync(data as Partial<Session>);
            sessionId = (res.record as Session).id;
            toast('Session added');
          }
          if (followup.dueDate && sessionId) {
            await followups.create.mutateAsync({
              sessionId,
              dueDate: followup.dueDate,
              note: followup.note,
              done: false,
            } as never);
          }
          setDrawerOpen(false);
        }}
        onDelete={async (id) => {
          await remove.mutateAsync(id);
          toast('Session deleted');
          setDrawerOpen(false);
        }}
        onCompleteFollowup={async (id) => {
          await followups.update.mutateAsync({ id, data: { done: true } as never });
          toast('Follow-up marked done');
        }}
      />
    </div>
  );
}

function SessionDrawer({
  open,
  onClose,
  session,
  existingFollowup,
  onSave,
  onDelete,
  onCompleteFollowup,
}: {
  open: boolean;
  onClose: () => void;
  session: Session | null;
  existingFollowup?: { id: string; dueDate: string; note?: string };
  onSave: (
    data: SessionInput,
    followup: { dueDate?: string; note?: string },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCompleteFollowup: (id: string) => Promise<void>;
}) {
  const { sessionStatusValues } = useSettings();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SessionInput>({
    resolver: zodResolver(sessionSchema),
    values: session
      ? (session as unknown as SessionInput)
      : {
          companyId: '',
          query: '',
          status: sessionStatusValues[0],
        },
  });

  const [fuDate, setFuDate] = useState('');
  const [fuNote, setFuNote] = useState('');

  const submit = handleSubmit(async (data) => {
    await onSave(data, { dueDate: fuDate || undefined, note: fuNote || undefined });
    reset();
    setFuDate('');
    setFuNote('');
  });

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={session ? 'Edit Session' : 'Add Session'}
      footer={
        <div className="flex items-center justify-between">
          {session ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(session.id)}
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
              {session ? 'Save' : 'Add Session'}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Company" required error={errors.companyId?.message}>
          <CompanySelect {...register('companyId')} />
        </Field>
        <Field label="Query" required error={errors.query?.message}>
          <Textarea {...register('query')} placeholder="What did the client ask about?" />
        </Field>
        <Field label="Solution / notes">
          <Textarea {...register('solution')} placeholder="What did you advise or build?" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Consultant">
            <Input {...register('consultant')} />
          </Field>
          <Field label="Mode">
            <Select {...register('mode')}>
              <option value="">Select</option>
              <option>In-person</option>
              <option>Online</option>
              <option>Phone</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Domain">
            <Input {...register('domain')} placeholder="Automation, Marketing..." />
          </Field>
          <Field label="Payment">
            <Select {...register('payment')}>
              <option value="">Select</option>
              <option>Free</option>
              <option>Paid</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status" required>
            <Select {...register('status')}>
              {sessionStatusValues.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assigned to">
            <AssigneeSelect {...register('assignedTo')} />
          </Field>
        </div>
        <Field label="Outcome">
          <Input {...register('outcome')} placeholder="Positive, wants a follow-up..." />
        </Field>

        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            Follow-up
          </p>
          {existingFollowup ? (
            <div className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/40">
              <span className="text-amber-700 dark:text-amber-300">
                Due {formatDate(existingFollowup.dueDate)}
                {existingFollowup.note ? ` · ${existingFollowup.note}` : ''}
              </span>
              <button
                type="button"
                onClick={() => onCompleteFollowup(existingFollowup.id)}
                className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Done
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Due date">
                <Input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} />
              </Field>
              <Field label="Note">
                <Input value={fuNote} onChange={(e) => setFuNote(e.target.value)} placeholder="Optional" />
              </Field>
            </div>
          )}
        </div>

        {session && (
          <p className="text-xs text-slate-400">
            Logged {relativeTime(session.createdAt)}
            {session.createdBy ? ` by ${session.createdBy}` : ''}.
          </p>
        )}
      </form>
    </SlideOver>
  );
}
