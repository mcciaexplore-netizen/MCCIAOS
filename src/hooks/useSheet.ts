import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SheetName } from '@/types';

// Generic CRUD hook over one `sheet`. Per-module hooks (useCompanies, etc.)
// are thin typed wrappers around this so behavior stays consistent.
export function useSheet<T extends { id: string }>(sheet: SheetName) {
  const qc = useQueryClient();
  const key = ['records', sheet];

  const query = useQuery({
    queryKey: key,
    queryFn: () => api.list<T>(sheet).then((r) => r.records),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: (data: Partial<T>) => api.create<T>(sheet, data),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<T> }) =>
      api.patch<T>(id, data),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: invalidate,
  });

  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    create,
    update,
    remove,
    invalidate,
  };
}
