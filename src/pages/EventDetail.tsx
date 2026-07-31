import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  CheckCheck,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  Mic,
  Pencil,
  Percent,
  Plus,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
} from '@/components/ui';
import {
  ModeBadge,
  StatTile,
  StatTileSkeleton,
  StatusBadge,
  TableSkeleton,
  TypeBadge,
  formatRate,
  formatTimeRange,
} from '@/components/EventBadges';
import { useToast } from '@/components/Toast';
import { eventsApi } from '@/lib/eventsApi';
import { participantSchema, type ParticipantInput } from '@/schemas/events';
import { formatDate } from '@/lib/utils';
import type { EventParticipant, EventRecord } from '@/types';

interface EventDetailData {
  event: EventRecord;
  participants: EventParticipant[];
}

/** The header row of the import template, and what the UI tells people to send. */
const CSV_HEADERS = 'name,company,designation,email,phone,isMember,attended';

/**
 * Recomputes the derived counts from a participant list.
 *
 * The server owns this rule, but an optimistic attendance toggle has to move
 * the stat tiles in the same tick as the checkbox — otherwise the number lags
 * a round trip behind the box the user just ticked. Kept deliberately identical
 * to resolveCounts/attendanceRate in server/events.ts.
 */
function withRecountedStats(
  event: EventRecord,
  participants: EventParticipant[],
): EventRecord {
  const hasParticipants = participants.length > 0;
  const registered = hasParticipants ? participants.length : event.registeredCount;
  const attended = hasParticipants
    ? participants.filter((p) => p.attended).length
    : event.attendedCount;
  return {
    ...event,
    hasParticipants,
    registered,
    attended,
    attendanceRate: registered ? Math.round((attended / registered) * 1000) / 10 : null,
  };
}

export default function EventDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = ['event', id];

  const query = useQuery({
    queryKey: key,
    queryFn: () => eventsApi.get(id),
  });

  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const event = query.data?.event;
  const participants = query.data?.participants ?? [];

  /** Applies a change to the cached detail payload, keeping counts consistent. */
  const patchCache = (next: (list: EventParticipant[]) => EventParticipant[]) => {
    qc.setQueryData<EventDetailData>(key, (old) => {
      if (!old) return old;
      const list = next(old.participants);
      return { event: withRecountedStats(old.event, list), participants: list };
    });
  };

  const toggleAttendance = useMutation({
    mutationFn: ({ participantId, attended }: { participantId: string; attended: boolean }) =>
      eventsApi.updateParticipant(participantId, { attended }),

    // Optimistic: tick the box now, put it back if the server disagrees.
    onMutate: async ({ participantId, attended }) => {
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<EventDetailData>(key);
      patchCache((list) =>
        list.map((p) => (p.id === participantId ? { ...p, attended } : p)),
      );
      return { snapshot };
    },
    onError: (err: Error, _vars, context) => {
      if (context?.snapshot) qc.setQueryData(key, context.snapshot);
      toast(err.message || 'Could not save attendance', 'error');
    },
    // Reconcile with the server's own counts once the write lands.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const markAll = useMutation({
    mutationFn: () => eventsApi.setAllAttendance(id, true),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<EventDetailData>(key);
      patchCache((list) => list.map((p) => ({ ...p, attended: true })));
      return { snapshot };
    },
    onError: (err: Error, _vars, context) => {
      if (context?.snapshot) qc.setQueryData(key, context.snapshot);
      toast(err.message || 'Could not update attendance', 'error');
    },
    onSuccess: (res) => toast(`${res.updated} marked attended`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const addParticipant = useMutation({
    mutationFn: (input: ParticipantInput) => eventsApi.addParticipant(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['events'] });
      toast('Participant added');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const removeParticipant = useMutation({
    mutationFn: (participantId: string) => eventsApi.removeParticipant(participantId),
    onMutate: async (participantId) => {
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<EventDetailData>(key);
      patchCache((list) => list.filter((p) => p.id !== participantId));
      return { snapshot };
    },
    onError: (err: Error, _vars, context) => {
      if (context?.snapshot) qc.setQueryData(key, context.snapshot);
      toast(err.message || 'Could not remove that person', 'error');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const importCsv = useMutation({
    mutationFn: (csv: string) => eventsApi.importParticipants(id, csv),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['events'] });
      setImportOpen(false);
      toast(
        res.skipped
          ? `Imported ${res.created}, skipped ${res.skipped}`
          : `Imported ${res.created} participants`,
        res.skipped ? 'info' : 'success',
      );
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  async function exportCsv() {
    if (!event) return;
    setExporting(true);
    try {
      await eventsApi.exportParticipants(id, event.code);
      toast('Participant list downloaded');
    } catch (err) {
      toast((err as Error).message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  }

  if (query.isLoading) return <DetailSkeleton />;

  if (query.isError) {
    return (
      <div>
        <BackLink />
        <ErrorState error={query.error as Error} onRetry={() => query.refetch()} />
      </div>
    );
  }

  if (!event) {
    return (
      <div>
        <BackLink />
        <EmptyState
          icon={<CalendarDays className="h-10 w-10" />}
          title="That event no longer exists"
          description="It may have been deleted by someone else."
          action={
            <Button size="sm" onClick={() => navigate('/events')}>
              Back to the list
            </Button>
          }
        />
      </div>
    );
  }

  const times = formatTimeRange(event.startTime, event.endTime);

  return (
    <div>
      <BackLink />
      <PageHeader
        title={event.title}
        subtitle={`${event.code}${event.topic ? ` · ${event.topic}` : ''}`}
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate(`/events/${id}/edit`)}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
        }
      />

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <TypeBadge type={event.type} />
          <ModeBadge mode={event.mode} />
          <StatusBadge status={event.status} />
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2 dark:border-slate-800">
          <Detail icon={<CalendarDays className="h-4 w-4" />} label="Date">
            {formatDate(event.eventDate)}
            {times && <span className="text-slate-400"> · {times}</span>}
          </Detail>
          {event.speaker && (
            <Detail icon={<Mic className="h-4 w-4" />} label="Speaker">
              {event.speaker}
            </Detail>
          )}
          {event.venue && (
            <Detail icon={<MapPin className="h-4 w-4" />} label="Venue">
              {event.venue}
            </Detail>
          )}
          {event.meetingLink && (
            <Detail icon={<ExternalLink className="h-4 w-4" />} label="Meeting link">
              <a
                href={event.meetingLink}
                target="_blank"
                rel="noreferrer noopener"
                className="truncate text-brand-600 hover:underline dark:text-brand-400"
              >
                {event.meetingLink}
              </a>
            </Detail>
          )}
        </dl>
        {event.description && (
          <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
            {event.description}
          </p>
        )}
        {event.notes && (
          <p className="mt-2 text-sm text-slate-400">{event.notes}</p>
        )}
      </Card>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <StatTile
          label="Registered"
          value={event.registered}
          tone="amber"
          icon={<Users className="h-[18px] w-[18px]" />}
          foot={event.hasParticipants ? undefined : 'Bulk figure'}
        />
        <StatTile
          label="Attended"
          value={event.attended}
          tone="green"
          icon={<CheckCheck className="h-[18px] w-[18px]" />}
          foot={event.hasParticipants ? undefined : 'Bulk figure'}
        />
        <StatTile
          label="Attendance"
          value={formatRate(event.attendanceRate)}
          tone="brand"
          icon={<Percent className="h-[18px] w-[18px]" />}
        />
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Participants
          </h3>
          <p className="text-xs text-slate-400">
            {event.hasParticipants
              ? 'Registered and attended counts come from this list.'
              : 'No participants yet — the counts above are the bulk figures from the event form.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={participants.length === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            {markAll.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="h-4 w-4" />
            )}
            Mark all attended
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Import CSV
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={participants.length === 0 || exporting}
            onClick={exportCsv}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export CSV
          </Button>
        </div>
      </div>

      <Card className="mb-4 overflow-hidden">
        {participants.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Users className="h-10 w-10" />}
              title="No participants recorded"
              description="Add someone below, or import a delegate list as CSV."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                <tr>
                  <th className="w-12 px-4 py-2 text-center font-medium">Here</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Designation</th>
                  <th className="px-4 py-2 font-medium">Contact</th>
                  <th className="whitespace-nowrap px-4 py-2 font-medium">Member</th>
                  <th className="w-12 px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {participants.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={p.attended}
                        aria-label={`${p.name} attended`}
                        onChange={(e) =>
                          toggleAttendance.mutate({
                            participantId: p.id,
                            attended: e.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-700 dark:text-slate-200">
                      {p.name}
                    </td>
                    <td className="max-w-[14rem] truncate px-4 py-2 text-slate-500">
                      {p.company ?? '—'}
                    </td>
                    <td className="max-w-[12rem] truncate px-4 py-2 text-slate-500">
                      {p.designation ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-slate-500">
                      <div className="flex flex-col">
                        {p.email && <span className="truncate">{p.email}</span>}
                        {p.phone && <span className="text-xs text-slate-400">{p.phone}</span>}
                        {!p.email && !p.phone && '—'}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {p.isMember ? <Badge tone="green">Member</Badge> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        aria-label={`Remove ${p.name}`}
                        onClick={() => removeParticipant.mutate(p.id)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AddParticipantForm
        pending={addParticipant.isPending}
        onAdd={(input) => addParticipant.mutateAsync(input).then(() => undefined)}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        pending={importCsv.isPending}
        onImport={(csv) => importCsv.mutate(csv)}
      />
    </div>
  );
}

function Detail({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 shrink-0 text-slate-400">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-slate-400">{label}</dt>
        <dd className="truncate text-slate-700 dark:text-slate-200">{children}</dd>
      </div>
    </div>
  );
}

function AddParticipantForm({
  pending,
  onAdd,
}: {
  pending: boolean;
  onAdd: (input: ParticipantInput) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ParticipantInput>({
    resolver: zodResolver(participantSchema),
    defaultValues: {
      name: '',
      company: '',
      designation: '',
      email: '',
      phone: '',
      isMember: false,
      attended: false,
    },
  });

  const submit = handleSubmit(async (data) => {
    await onAdd(data);
    reset();
  });

  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
        Add a participant
      </p>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name" required error={errors.name?.message}>
            <Input {...register('name')} placeholder="Full name" />
          </Field>
          <Field label="Company">
            <Input {...register('company')} />
          </Field>
          <Field label="Designation">
            <Input {...register('designation')} />
          </Field>
          <Field label="Email" error={errors.email?.message}>
            <Input {...register('email')} type="email" />
          </Field>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid w-full gap-3 sm:max-w-xs">
            <Field label="Phone">
              <Input {...register('phone')} />
            </Field>
          </div>
          <div className="flex items-center gap-4 pb-1">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                {...register('isMember')}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
              />
              MCCIA member
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                {...register('attended')}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
              />
              Attended
            </label>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function ImportModal({
  open,
  onClose,
  pending,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  onImport: (csv: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');

  async function pick(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
  }

  function close() {
    setCsv('');
    setFileName('');
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import participants"
      description="Upload a CSV delegate list."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" disabled={!csv || pending} onClick={() => onImport(csv)}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Import
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Expected columns
          </p>
          <pre className="mt-1.5 overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {CSV_HEADERS}
          </pre>
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            <li>
              <strong className="text-slate-500 dark:text-slate-400">name</strong> is the
              only required column. Rows without one are skipped and reported.
            </li>
            <li>
              Common alternatives are understood: <em>Organisation</em> for company,
              <em> Role</em> for designation, <em>Mobile</em> for phone.
            </li>
            <li>
              <strong className="text-slate-500 dark:text-slate-400">isMember</strong> and{' '}
              <strong className="text-slate-500 dark:text-slate-400">attended</strong> accept
              yes/no, true/false or 1/0.
            </li>
            <li>Importing adds to the list; it never replaces what is already there.</li>
          </ul>
        </div>

        <div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4" /> Choose file
          </Button>
          {fileName && (
            <span className="ml-3 text-sm text-slate-500">{fileName}</span>
          )}
        </div>
      </div>
    </Modal>
  );
}

function BackLink() {
  return (
    <Link
      to="/events"
      className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
    >
      <ArrowLeft className="h-4 w-4" /> Workshops & Events
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div>
      <div className="mb-3 h-4 w-40 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      <div className="mb-5 h-8 w-64 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      <Card className="mb-5 space-y-3 p-4">
        <div className="h-5 w-48 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
        <div className="h-4 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      </Card>
      <div className="mb-5 grid grid-cols-3 gap-3">
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
      </div>
      <Card className="overflow-hidden">
        <TableSkeleton />
      </Card>
    </div>
  );
}
