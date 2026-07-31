import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { useToast } from '@/components/Toast';
import { eventsApi } from '@/lib/eventsApi';
import { eventSchema, type EventInput } from '@/schemas/events';
import {
  EVENT_MODE_LABELS,
  EVENT_STATUS_LABELS,
  EVENT_TOPIC_SUGGESTIONS,
  EVENT_TYPE_LABELS,
} from '@/constants';
import type { EventMode, EventStatus, EventType } from '@/types';

const TOPIC_LIST_ID = 'event-topic-suggestions';

export default function EventForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();

  // "Add Workshop" and "Add Event" are the same form; the button that opened it
  // decides which type it starts on.
  const initialType: EventType = params.get('type') === 'EVENT' ? 'EVENT' : 'WORKSHOP';

  const existing = useQuery({
    queryKey: ['event', id],
    queryFn: () => eventsApi.get(id as string),
    enabled: isEdit,
  });

  const event = existing.data?.event;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EventInput>({
    resolver: zodResolver(eventSchema),
    values: event
      ? {
          code: event.code,
          type: event.type,
          title: event.title,
          description: event.description ?? '',
          topic: event.topic ?? '',
          mode: event.mode,
          venue: event.venue ?? '',
          meetingLink: event.meetingLink ?? '',
          eventDate: event.eventDate,
          startTime: event.startTime ?? '',
          endTime: event.endTime ?? '',
          speaker: event.speaker ?? '',
          status: event.status,
          registeredCount: event.registeredCount,
          attendedCount: event.attendedCount,
          notes: event.notes ?? '',
        }
      : {
          code: '',
          type: initialType,
          title: '',
          description: '',
          topic: '',
          mode: 'OFFLINE',
          venue: '',
          meetingLink: '',
          eventDate: new Date().toISOString().slice(0, 10),
          startTime: '',
          endTime: '',
          speaker: '',
          status: 'UPCOMING',
          registeredCount: 0,
          attendedCount: 0,
          notes: '',
        },
  });

  const type = watch('type');
  const mode = watch('mode');

  // Off by default: the code is assigned for you, and back-filling an old
  // workshop under its original number is the exception.
  const [override, setOverride] = useState(false);

  // What the server would assign right now. Refetched when the type changes,
  // because the two types have independent sequences.
  const preview = useQuery({
    queryKey: ['event-next-code', type],
    queryFn: () => eventsApi.nextCode(type),
    enabled: !isEdit && !override,
  });

  // Switching type invalidates a code typed for the old one, so clear it rather
  // than submitting a W- code on an event.
  useEffect(() => {
    if (!override) setValue('code', '');
  }, [type, override, setValue]);

  const save = useMutation({
    mutationFn: async (data: EventInput) => {
      // An untouched code field means "leave it to the server" on create, and
      // "leave it alone" on edit — in neither case should it be sent.
      const payload = override ? data : { ...data, code: undefined };
      return isEdit
        ? eventsApi.update(id as string, payload)
        : eventsApi.create(payload as EventInput);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['event', res.event.id] });
      toast(isEdit ? 'Event updated' : `${res.event.code} created`);
      navigate(`/events/${res.event.id}`);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const remove = useMutation({
    mutationFn: () => eventsApi.remove(id as string),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      toast('Event deleted');
      navigate('/events');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const submit = handleSubmit((data) => save.mutateAsync(data).catch(() => undefined));

  if (isEdit && existing.isLoading) {
    return <FormSkeleton />;
  }

  if (isEdit && existing.isError) {
    return (
      <div>
        <BackLink />
        <ErrorState error={existing.error as Error} onRetry={() => existing.refetch()} />
      </div>
    );
  }

  const showVenue = mode === 'OFFLINE' || mode === 'HYBRID';
  const showLink = mode === 'ONLINE' || mode === 'HYBRID';

  return (
    <div>
      <BackLink />
      <PageHeader
        title={isEdit ? `Edit ${event?.code ?? 'event'}` : `Add ${EVENT_TYPE_LABELS[type]}`}
        subtitle={
          isEdit
            ? 'Changes apply immediately once saved.'
            : 'The code is assigned automatically unless you override it.'
        }
      />

      <form onSubmit={submit} className="max-w-3xl space-y-4">
        <Card className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type" required error={errors.type?.message}>
              <Select {...register('type')} disabled={isEdit}>
                {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((t) => (
                  <option key={t} value={t}>
                    {EVENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Code"
              error={errors.code?.message}
              hint={
                override
                  ? 'W-01 for workshops, EV-01 for events. Must not already be in use.'
                  : undefined
              }
            >
              {override ? (
                <Input
                  {...register('code')}
                  placeholder={type === 'WORKSHOP' ? 'W-01' : 'EV-01'}
                  autoCapitalize="characters"
                />
              ) : (
                <div className="flex h-[38px] items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-800/60">
                  {isEdit ? (
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {event?.code}
                    </span>
                  ) : preview.isLoading ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
                    </span>
                  ) : preview.data ? (
                    <>
                      Next code:&nbsp;
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {preview.data.code}
                      </span>
                    </>
                  ) : (
                    'Assigned on save'
                  )}
                </div>
              )}
              <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(e) => {
                    setOverride(e.target.checked);
                    setValue('code', e.target.checked && isEdit ? (event?.code ?? '') : '');
                  }}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
                />
                Override the code {isEdit ? '' : '(for back-filling old records)'}
              </label>
            </Field>
          </div>

          <Field label="Title" required error={errors.title?.message}>
            <Input {...register('title')} placeholder="Practical AI for HR teams" />
          </Field>

          <Field label="Description">
            <Textarea
              {...register('description')}
              placeholder="What the session covered, who it was for..."
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Topic" hint="e.g. HR/Admin, Finance, CX, Sales/CRM">
              <Input {...register('topic')} list={TOPIC_LIST_ID} placeholder="HR/Admin" />
              <datalist id={TOPIC_LIST_ID}>
                {EVENT_TOPIC_SUGGESTIONS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field label="Speaker">
              <Input {...register('speaker')} placeholder="Name of the person presenting" />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date" required error={errors.eventDate?.message}>
              <Input type="date" {...register('eventDate')} />
            </Field>
            <Field label="Start time" error={errors.startTime?.message}>
              <Input type="time" {...register('startTime')} />
            </Field>
            <Field label="End time" error={errors.endTime?.message}>
              <Input type="time" {...register('endTime')} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mode" required error={errors.mode?.message}>
              <Select {...register('mode')}>
                {(Object.keys(EVENT_MODE_LABELS) as EventMode[]).map((m) => (
                  <option key={m} value={m}>
                    {EVENT_MODE_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" required error={errors.status?.message}>
              <Select {...register('status')}>
                {(Object.keys(EVENT_STATUS_LABELS) as EventStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {EVENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* Only the field that applies to the chosen mode is shown, and the
              server clears the other, so an online workshop cannot keep a
              stale venue from when it was offline. */}
          {showVenue && (
            <Field label="Venue" hint="Where the session physically takes place">
              <Input {...register('venue')} placeholder="MCCIA Trade Tower, Senapati Bapat Road" />
            </Field>
          )}
          {showLink && (
            <Field label="Meeting link" hint="Google Meet, Zoom or Teams link">
              <Input {...register('meetingLink')} placeholder="https://meet.google.com/..." />
            </Field>
          )}
        </Card>

        <Card className="space-y-4 p-4">
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Bulk figures
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              Used only while this event has no participant rows. Add participants on
              the event page and these are replaced by the real counts.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Registered" error={errors.registeredCount?.message}>
              <Input type="number" min={0} {...register('registeredCount')} />
            </Field>
            <Field label="Attended" error={errors.attendedCount?.message}>
              <Input type="number" min={0} {...register('attendedCount')} />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea {...register('notes')} placeholder="Anything worth remembering" />
          </Field>
        </Card>

        <div className="flex items-center justify-between gap-2 pb-2">
          {isEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              disabled={remove.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete ${event?.code}? Its participant list is deleted too. This cannot be undone.`,
                  )
                ) {
                  remove.mutate();
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting || save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? 'Save changes' : `Add ${EVENT_TYPE_LABELS[type]}`}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function BackLink() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/events')}
      className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
    >
      <ArrowLeft className="h-4 w-4" /> Workshops & Events
    </button>
  );
}

function FormSkeleton() {
  return (
    <div className="max-w-3xl space-y-4">
      <div className="h-8 w-48 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      {[0, 1, 2].map((i) => (
        <Card key={i} className="space-y-3 p-4">
          {Array.from({ length: 3 }).map((_, j) => (
            <div key={j} className="space-y-1.5">
              <div className="h-3 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-9 w-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
