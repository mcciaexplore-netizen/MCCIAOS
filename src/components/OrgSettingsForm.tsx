import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Save, Upload, X } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { trackerApi } from '@/lib/workTrackerApi';
import {
  DEFAULT_ORG_SETTINGS,
  orgSettingsSchema,
  REQUIRED_FIELDS,
  type OrgSettings,
} from '@/schemas/orgSettings';
import { cn } from '@/lib/utils';

/**
 * The organisation profile form.
 *
 * Data-driven rather than hand-laid: every field is one FIELDS entry, so labels,
 * inputs, help text and error messages line up by construction instead of by
 * each one being positioned correctly by hand. Adding a setting is a line in a
 * list, not a new block of markup that has to be made to match the others.
 */

type FieldKind = 'text' | 'email' | 'tel' | 'url' | 'number' | 'time' | 'colour' | 'toggle' | 'image';

interface Field {
  key: keyof OrgSettings;
  label: string;
  kind: FieldKind;
  help?: string;
  placeholder?: string;
  /** Half-width on desktop, so short fields pair up rather than stretching. */
  half?: boolean;
  min?: number;
  max?: number;
}

export interface Section {
  id: string;
  title: string;
  blurb: string;
  fields: Field[];
}

export const ORG_SECTIONS: Section[] = [
  {
    id: 'general',
    title: 'General',
    blurb: 'What this application calls itself, wherever its name appears.',
    fields: [
      { key: 'appName', label: 'Application name', kind: 'text', half: true, help: 'Shown in the sidebar and the browser tab.' },
      { key: 'appTagline', label: 'Tagline', kind: 'text', half: true, help: 'The smaller line under the name.' },
      { key: 'organisationName', label: 'Organisation', kind: 'text', help: 'The full legal or public name, used in exports and email.' },
    ],
  },
  {
    id: 'branding',
    title: 'Branding',
    blurb: 'The logo and colour used across the interface.',
    fields: [
      { key: 'logoDataUri', label: 'Logo', kind: 'image', help: 'PNG or SVG, up to 1.5MB. Leave empty to show a lettermark instead.' },
      { key: 'brandColour', label: 'Brand colour', kind: 'colour', half: true, help: 'Six-digit hex, used for accents.' },
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    blurb: 'How people reach the organisation. Appears on exports and templates.',
    fields: [
      { key: 'contactEmail', label: 'Email', kind: 'email', half: true, placeholder: 'hello@example.com' },
      { key: 'contactPhone', label: 'Phone', kind: 'tel', half: true, placeholder: '+91 20 0000 0000' },
      { key: 'websiteUrl', label: 'Website', kind: 'url', placeholder: 'https://example.com' },
      { key: 'addressLine', label: 'Address', kind: 'text', placeholder: 'Street, city, postcode' },
    ],
  },
  {
    id: 'preferences',
    title: 'Preferences',
    blurb: 'How the Work Tracker behaves.',
    fields: [
      { key: 'atRiskDays', label: 'At-risk window (days)', kind: 'number', half: true, min: 1, max: 30, help: 'A deadline this many days away or nearer counts as at risk.' },
      { key: 'dailyExportTime', label: 'Daily export time', kind: 'time', half: true, help: 'IST. The deployed schedule is set in vercel.json and must match.' },
      { key: 'dailyExportEnabled', label: 'Run the daily export to Google Sheets', kind: 'toggle' },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    blurb: 'Nothing is sent yet — these record what should be, for when a sender is wired in.',
    fields: [
      { key: 'notifyOnOverdue', label: 'Notify when work goes overdue', kind: 'toggle' },
      { key: 'notifyOnApproval', label: 'Notify when work is approved', kind: 'toggle' },
      { key: 'notificationEmail', label: 'Send notifications to', kind: 'email', half: true, placeholder: 'team@example.com' },
    ],
  },
];

type Errors = Partial<Record<keyof OrgSettings, string>>;

export function OrgSettingsForm({ section }: { section: Section }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<OrgSettings | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const query = useQuery({
    queryKey: ['org-settings'],
    queryFn: () => trackerApi.orgSettings(),
  });
  const saved = query.data?.settings;

  // Re-sync when the stored settings arrive or change elsewhere, but never over
  // unsaved edits — losing someone's typing to a background refetch is worse
  // than showing them a slightly stale neighbouring field.
  useEffect(() => {
    if (saved && draft === null) setDraft({ ...saved });
  }, [saved, draft]);

  const keys = useMemo(() => section.fields.map((f) => f.key), [section]);

  /** Only this section's fields, so saving one section cannot clobber another. */
  const changed = useMemo(() => {
    if (!draft || !saved) return [] as (keyof OrgSettings)[];
    return keys.filter((k) => draft[k] !== saved[k]);
  }, [draft, saved, keys]);

  const dirty = changed.length > 0;

  // Browsers only honour this from a real interaction, and only with a generic
  // message — but it is the one hook they give for "are you sure you want to
  // leave", and losing a half-filled form is a genuinely bad outcome.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (patch: Partial<OrgSettings>) => trackerApi.saveOrgSettings(patch),
    onSuccess: (r) => {
      setErrors({});
      setDraft({ ...r.settings });
      qc.setQueryData(['org-settings'], r);
      qc.invalidateQueries({ queryKey: ['org-settings'] });
      toast(`${section.title} settings saved`);
    },
    onError: (err: Error) => {
      // The server returns field-keyed messages; surface them under the inputs
      // rather than as one toast that does not say which field is wrong.
      const fromServer = (err as Error & { fieldErrors?: Record<string, string[]> })
        .fieldErrors;
      if (fromServer) {
        setErrors(
          Object.fromEntries(
            Object.entries(fromServer).map(([k, v]) => [k, v[0]]),
          ) as Errors,
        );
        toast('Some fields need attention', 'error');
      } else {
        toast(err.message, 'error');
      }
    },
  });

  const set = useCallback((key: keyof OrgSettings, value: unknown) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setErrors((e) => {
      const { [key]: _drop, ...rest } = e;
      return rest;
    });
  }, []);

  /** Validated here as well as on the server, so a mistake is caught before a round trip. */
  const validate = (): boolean => {
    if (!draft) return false;
    const found: Errors = {};
    for (const key of keys) {
      const result = orgSettingsSchema.shape[key].safeParse(draft[key]);
      if (!result.success) found[key] = result.error.issues[0]?.message ?? 'Not valid';
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !dirty || save.isPending) return;
    if (!validate()) return;
    save.mutate(Object.fromEntries(changed.map((k) => [k, draft[k]])));
  };

  const onPickImage = async (file: File) => {
    if (file.size > 1_500_000) {
      setErrors((e) => ({ ...e, logoDataUri: 'That image is over 1.5MB' }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set('logoDataUri', String(reader.result ?? ''));
    reader.readAsDataURL(file);
  };

  if (query.isLoading || !draft) {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading settings</span>
        {section.fields.map((f) => (
          <div key={f.key} className="animate-pulse">
            <div className="mb-1.5 h-3 w-28 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-9 rounded-lg bg-slate-100 dark:bg-slate-800" />
          </div>
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
        Could not load settings: {(query.error as Error).message}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        {section.fields.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            value={draft[field.key]}
            error={errors[field.key]}
            disabled={save.isPending}
            onChange={(v) => set(field.key, v)}
            onPickImage={onPickImage}
            fileRef={field.kind === 'image' ? fileRef : undefined}
          />
        ))}
      </div>

      {/* One action bar, always in the same place, so the primary action does
          not move around as sections change length. */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
          {save.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save changes
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => {
            if (saved) setDraft({ ...saved });
            setErrors({});
          }}
        >
          Cancel
        </Button>

        <span className="ml-auto flex items-center gap-2">
          {confirmReset ? (
            <>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Reset {section.title.toLowerCase()} to defaults?
              </span>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          ...Object.fromEntries(keys.map((k) => [k, DEFAULT_ORG_SETTINGS[k]])),
                        }
                      : d,
                  );
                  setErrors({});
                  setConfirmReset(false);
                }}
              >
                Reset
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              onClick={() => setConfirmReset(true)}
              title="Put this section back to its default values"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          )}
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-400" aria-live="polite">
        {save.isPending
          ? 'Saving…'
          : dirty
            ? `${changed.length} unsaved change${changed.length === 1 ? '' : 's'}`
            : 'All changes saved'}
      </p>
    </form>
  );
}

function FieldRow({
  field,
  value,
  error,
  disabled,
  onChange,
  onPickImage,
  fileRef,
}: {
  field: Field;
  value: unknown;
  error?: string;
  disabled?: boolean;
  onChange: (v: unknown) => void;
  onPickImage: (file: File) => void;
  fileRef?: React.RefObject<HTMLInputElement>;
}) {
  const id = `org-${field.key}`;
  const describedBy = [error ? `${id}-error` : null, field.help ? `${id}-help` : null]
    .filter(Boolean)
    .join(' ');
  const required = REQUIRED_FIELDS.includes(field.key);
  const span = field.half ? 'sm:col-span-1' : 'sm:col-span-2';

  if (field.kind === 'toggle') {
    return (
      <div className={cn(span, 'flex items-start gap-3')}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={describedBy || undefined}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
        />
        <span className="min-w-0">
          <label htmlFor={id} className="block text-sm text-slate-700 dark:text-slate-200">
            {field.label}
          </label>
          {field.help && (
            <p id={`${id}-help`} className="mt-0.5 text-xs text-slate-400">
              {field.help}
            </p>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className={span}>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200"
      >
        {field.label}
        {required && (
          <span className="ml-1 text-rose-600 dark:text-rose-400" aria-hidden>
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>

      {field.kind === 'image' ? (
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            {typeof value === 'string' && value ? (
              <img src={value} alt="Current logo" className="h-full w-full object-contain" />
            ) : (
              <span className="text-xs text-slate-400">None</span>
            )}
          </span>
          <input
            ref={fileRef}
            id={id}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            disabled={disabled}
            aria-describedby={describedBy || undefined}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickImage(f);
            }}
            className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-200"
          />
          {typeof value === 'string' && value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
              <X className="h-4 w-4" />
              Remove
            </Button>
          )}
        </div>
      ) : field.kind === 'colour' ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${field.label} picker`}
            value={typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-800"
          />
          <Input
            id={id}
            value={String(value ?? '')}
            disabled={disabled}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy || undefined}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono"
          />
        </div>
      ) : (
        <Input
          id={id}
          type={field.kind === 'number' ? 'number' : field.kind === 'time' ? 'time' : field.kind}
          inputMode={field.kind === 'number' ? 'numeric' : undefined}
          min={field.min}
          max={field.max}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          onChange={(e) =>
            onChange(field.kind === 'number' ? Number(e.target.value) : e.target.value)
          }
        />
      )}

      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-1.5 text-xs text-rose-600 dark:text-rose-400"
        >
          {error}
        </p>
      ) : field.help ? (
        <p id={`${id}-help`} className="mt-1.5 text-xs text-slate-400">
          {field.help}
        </p>
      ) : null}
    </div>
  );
}

export { Select };
