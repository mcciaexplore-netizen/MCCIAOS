import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { trackerApi } from '@/lib/workTrackerApi';
import { DEFAULT_SETTINGS, labelsOf, toneMapOf } from '@/constants';
import type { AppSettings } from '@/types';

// The settings live in a single record on the `Settings` sheet. Storing them
// through the same records API keeps the file store and Neon behaving
// identically — no extra table or endpoint.
const QUERY_KEY = ['records', 'Settings'];

type StoredSettings = AppSettings & { id: string };

export interface SettingsValue extends AppSettings {
  /**
   * The team roster, derived from the `users` table rather than stored on the
   * Settings record. It used to be a list of names in that record, which meant
   * the roster lived in two places; team members are managed on the Settings
   * page and this reads back the same rows.
   */
  teamMembers: string[];
  // Derived views the pages consume directly.
  creativeStatusValues: string[];
  creativeStatusTone: Record<string, string>;
  isLoading: boolean;
}

const SettingsContext = createContext<SettingsValue | null>(null);

function useSettingsQuery() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.list<StoredSettings>('Settings').then((r) => r.records),
    staleTime: 60_000,
  });
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useSettingsQuery();
  const usersQuery = useQuery({
    queryKey: ['tracker-users'],
    queryFn: () => trackerApi.users(),
    staleTime: 60_000,
  });

  const value = useMemo<SettingsValue>(() => {
    // Merge over defaults so a partially-saved record (or a brand new install
    // with no record at all) still yields a complete, usable config.
    const stored = data?.[0];
    const s: AppSettings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
    return {
      ...s,
      teamMembers: (usersQuery.data?.users ?? []).map((u) => u.name),
      creativeStatusValues: labelsOf(s.creativeStatuses),
      creativeStatusTone: toneMapOf(s.creativeStatuses),
      isLoading,
    };
  }, [data, isLoading, usersQuery.data]);

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}

// Save hook for the Settings page: creates the singleton record on first save,
// patches it afterwards.
export function useSaveSettings() {
  const qc = useQueryClient();
  const { data } = useSettingsQuery();
  const existingId = data?.[0]?.id;

  return useMutation({
    mutationFn: (next: AppSettings) =>
      existingId
        ? api.patch<StoredSettings>(existingId, next)
        : api.create<StoredSettings>('Settings', next),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
