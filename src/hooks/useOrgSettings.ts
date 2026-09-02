import { useQuery } from '@tanstack/react-query';
import { trackerApi } from '@/lib/workTrackerApi';
import { DEFAULT_ORG_SETTINGS, type OrgSettings } from '@/schemas/orgSettings';

/**
 * The organisation profile, for anything that renders it.
 *
 * Always returns a complete object: defaults until the request lands, and
 * defaults again if it fails. Chrome that cannot reach its settings should wear
 * its default name rather than flash empty or throw — the sidebar renders on
 * every page, so a failure here would take the whole app down.
 *
 * Cached for a minute. These change rarely and every page mounts this.
 */
export function useOrgSettings(): OrgSettings {
  const { data } = useQuery({
    queryKey: ['org-settings'],
    queryFn: () => trackerApi.orgSettings(),
    staleTime: 60_000,
  });
  return data?.settings ?? DEFAULT_ORG_SETTINGS;
}
