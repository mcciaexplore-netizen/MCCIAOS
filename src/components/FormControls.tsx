import { Button, Input, Select } from '@/components/ui';
import { useSettings } from '@/settings/SettingsContext';
import { useCompanies } from '@/hooks';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, Search } from 'lucide-react';
import {
  forwardRef,
  useMemo,
  useRef,
  useState,
  type SelectHTMLAttributes,
} from 'react';

// Company picker used by Session/Project/Creative forms.
export const CompanySelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>((props, ref) => {
  const { items } = useCompanies();
  return (
    <Select ref={ref} {...props}>
      <option value="">Select a company</option>
      {items.map((c) => (
        <option key={c.id} value={c.id}>
          {c.companyName}
        </option>
      ))}
    </Select>
  );
});
CompanySelect.displayName = 'CompanySelect';

export function CompanySearchSelect({
  value,
  onChange,
  placeholder = 'Select a company',
  disabled,
}: {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { items } = useCompanies();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = items.find((c) => c.id === value);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => {
      return (
        c.companyName?.toLowerCase().includes(q) ||
        c.contactName?.toLowerCase().includes(q) ||
        c.industry?.toLowerCase().includes(q) ||
        c.district?.toLowerCase().includes(q)
      );
    });
  }, [items, search]);
  const companyMeta = (company: (typeof items)[number]) =>
    [company.contactName, company.industry, company.district].filter(Boolean).join(' · ');

  function openMenu() {
    if (disabled) return;
    setOpen(true);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }

  function selectCompany(companyId: string) {
    onChange(companyId);
    setOpen(false);
    setSearch('');
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="secondary"
        onClick={() => (open ? setOpen(false) : openMenu())}
        disabled={disabled}
        className="w-full justify-between px-3 py-2 text-left font-normal"
      >
        <span
          className={cn(
            'truncate',
            selected ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400',
          )}
        >
          {selected?.companyName ?? placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </Button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 p-2 dark:border-slate-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search companies..."
                className="pl-9"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400">
                No companies found
              </p>
            ) : (
              filtered.map((company) => (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => selectCompany(company.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800',
                    company.id === value && 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
                  )}
                >
                  <Check
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0',
                      company.id === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {company.companyName}
                    </span>
                    {companyMeta(company) && (
                      <span className="block truncate text-xs text-slate-400">
                        {companyMeta(company)}
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Assignee picker. Supports an "Unassigned" empty option.
export const AssigneeSelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>((props, ref) => {
  const { teamMembers } = useSettings();
  return (
    <Select ref={ref} {...props}>
      <option value="">Unassigned</option>
      {teamMembers.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </Select>
  );
});
AssigneeSelect.displayName = 'AssigneeSelect';

export function useCompanyMap(): Record<string, string> {
  const { items } = useCompanies();
  const map: Record<string, string> = {};
  for (const c of items) map[c.id] = c.companyName;
  return map;
}

// Assignee filter for list views: "All assignees", each team member, or
// "Unassigned". Pair with matchesAssignee() to filter rows.
export const UNASSIGNED = '__unassigned__';

export const AssigneeFilterSelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>((props, ref) => {
  const { teamMembers } = useSettings();
  return (
    <Select ref={ref} {...props} className="w-auto min-w-[9rem]">
      <option value="all">All assignees</option>
      {teamMembers.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
      <option value={UNASSIGNED}>Unassigned</option>
    </Select>
  );
});
AssigneeFilterSelect.displayName = 'AssigneeFilterSelect';

export function matchesAssignee(
  assignedTo: string | null | undefined,
  filter: string,
): boolean {
  if (filter === 'all') return true;
  if (filter === UNASSIGNED) return !assignedTo;
  return assignedTo === filter;
}
