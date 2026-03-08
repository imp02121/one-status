import { useQuery } from '@tanstack/react-query';
import { fetchIncident } from '../lib/api';

export function useIncident(id: string) {
  return useQuery({
    queryKey: ['incident', id],
    queryFn: () => fetchIncident(id),
    staleTime: 30_000,
    enabled: !!id,
  });
}
