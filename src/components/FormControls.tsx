import { Select } from '@/components/ui';
import { useSettings } from '@/settings/SettingsContext';
import { forwardRef, type SelectHTMLAttributes } from 'react';

// This module used to also hold CompanySelect, CompanySearchSelect,
// useCompanyMap, AssigneeFilterSelect and matchesAssignee. Every one of them
// existed only for the Companies, Consulting, App Development and Dashboard
// pages, which have been removed; the assignee picker is all that the
// remaining forms (Social, Messages) still use.

/** Assignee picker. Supports an "Unassigned" empty option. */
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
