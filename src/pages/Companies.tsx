import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Building2,
  Plus,
  Search,
  Mail,
  Phone,
  MapPin,
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
  Select,
} from '@/components/ui';
import {
  AssigneeSelect,
  AssigneeFilterSelect,
  matchesAssignee,
} from '@/components/FormControls';
import { useToast } from '@/components/Toast';
import { DataTransfer } from '@/components/DataTransfer';
import { useCompanies } from '@/hooks';
import { companySchema, type CompanyInput } from '@/schemas';
import { useSettings } from '@/settings/SettingsContext';
import type { Company } from '@/types';
import { relativeTime } from '@/lib/utils';

export default function Companies() {
  const { items, isError, error, invalidate, create, update, remove } = useCompanies();
  const { companyStatusValues, companyStatusTone } = useSettings();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [assignee, setAssignee] = useState('all');
  const [editing, setEditing] = useState<Company | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = useMemo(() => {
    return items.filter((c) => {
      if (!matchesAssignee(c.assignedTo, assignee)) return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          c.companyName?.toLowerCase().includes(q) ||
          c.contactName?.toLowerCase().includes(q) ||
          c.industry?.toLowerCase().includes(q) ||
          c.district?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, assignee, statusFilter, search]);

  function openNew() {
    setEditing(null);
    setDrawerOpen(true);
  }
  function openEdit(c: Company) {
    setEditing(c);
    setDrawerOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="Companies"
        subtitle={`${items.length} MSME records`}
        actions={
          <>
            <DataTransfer sheet="Company" />
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4" /> Add Company
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
            placeholder="Search companies..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
            All
          </FilterPill>
          {companyStatusValues.map((s) => (
            <FilterPill
              key={s}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
            >
              {s}
            </FilterPill>
          ))}
          <AssigneeFilterSelect
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title="No companies match"
          description="Try clearing filters, or add a new MSME record."
          action={<Button size="sm" onClick={openNew}>Add Company</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className="p-4" onClick={() => openEdit(c)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-slate-900 dark:text-slate-100">
                    {c.companyName}
                  </h3>
                  <p className="truncate text-sm text-slate-500">
                    {[c.contactName, c.contactRole].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Badge tone={companyStatusTone[c.status] ?? 'gray'}>{c.status}</Badge>
              </div>
              <div className="mt-3 space-y-1.5 text-sm text-slate-500">
                {/* Imported rows may legitimately have no contact details, so
                    each line is omitted rather than rendering a bare icon. */}
                {c.contactEmail && (
                  <div className="flex items-center gap-2 truncate">
                    <Mail className="h-3.5 w-3.5 shrink-0" /> {c.contactEmail}
                  </div>
                )}
                {c.contactPhone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 shrink-0" /> {c.contactPhone}
                  </div>
                )}
                {c.district && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 shrink-0" /> {c.district}
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                {c.industry && <Badge tone="gray">{c.industry}</Badge>}
                {c.businessScale && <Badge tone="blue">{c.businessScale}</Badge>}
                <span className="ml-auto text-xs text-slate-400">
                  {c.assignedTo ? c.assignedTo : 'Unassigned'}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CompanyDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        company={editing}
        onCreate={async (data) => {
          await create.mutateAsync(data as Partial<Company>);
          toast('Company added');
          setDrawerOpen(false);
        }}
        onUpdate={async (id, data) => {
          await update.mutateAsync({ id, data: data as Partial<Company> });
          toast('Company updated');
          setDrawerOpen(false);
        }}
        onDelete={async (id) => {
          await remove.mutateAsync(id);
          toast('Company deleted');
          setDrawerOpen(false);
        }}
      />
    </div>
  );
}

function CompanyDrawer({
  open,
  onClose,
  company,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  company: Company | null;
  onCreate: (data: CompanyInput) => Promise<void>;
  onUpdate: (id: string, data: CompanyInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const {
    companyStatusValues,
    leadSources,
    businessScales,
    membershipStatuses,
  } = useSettings();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CompanyInput>({
    resolver: zodResolver(companySchema),
    values: company
      ? (company as unknown as CompanyInput)
      : {
          companyName: '',
          contactName: '',
          contactEmail: '',
          contactPhone: '',
          contactRole: '',
          industry: '',
          membershipStatus: membershipStatuses[0],
          leadSource: leadSources[0],
          businessScale: businessScales[0],
          status: companyStatusValues[0],
        },
  });

  const submit = handleSubmit(async (data) => {
    if (company) await onUpdate(company.id, data);
    else await onCreate(data);
    reset();
  });

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={company ? 'Edit Company' : 'Add Company'}
      footer={
        <div className="flex items-center justify-between">
          {company ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(company.id)}
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
              {company ? 'Save' : 'Add Company'}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Company name" required error={errors.companyName?.message}>
          <Input {...register('companyName')} placeholder="Acme Traders" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact name" required error={errors.contactName?.message}>
            <Input {...register('contactName')} />
          </Field>
          <Field label="Contact role" error={errors.contactRole?.message}>
            <Input {...register('contactRole')} placeholder="Owner" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email" required error={errors.contactEmail?.message}>
            <Input type="email" {...register('contactEmail')} />
          </Field>
          <Field label="Phone" required error={errors.contactPhone?.message}>
            <Input {...register('contactPhone')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="UDYAM number" error={errors.udyamNumber?.message}>
            <Input {...register('udyamNumber')} />
          </Field>
          <Field label="District" error={errors.district?.message}>
            <Input {...register('district')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Industry" error={errors.industry?.message}>
            <Input {...register('industry')} />
          </Field>
          <Field label="Membership status" error={errors.membershipStatus?.message}>
            <Select {...register('membershipStatus')}>
              {membershipStatuses.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lead source">
            <Select {...register('leadSource')}>
              {leadSources.map((s: string) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Business scale">
            <Select {...register('businessScale')}>
              {businessScales.map((s: string) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status" required>
            <Select {...register('status')}>
              {companyStatusValues.map((s) => (
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
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" {...register('rampScheme')} className="rounded" />
          Enrolled in RAMP scheme
        </label>
        {company && (
          <p className="text-xs text-slate-400">
            Added {relativeTime(company.createdAt)}
            {company.createdBy ? ` by ${company.createdBy}` : ''}.
          </p>
        )}
      </form>
    </SlideOver>
  );
}
