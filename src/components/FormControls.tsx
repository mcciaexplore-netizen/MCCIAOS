import { Select } from '@/components/ui';
import { useSettings } from '@/settings/SettingsContext';
import { useCompanies } from '@/hooks';
import { forwardRef, type SelectHTMLAttributes } from 'react';

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
