import { useQuery } from '@tanstack/react-query';
import { fetchIncidents } from '../lib/api';

export function useIncidents(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['incidents', page, limit],
    queryFn: () => fetchIncidents(page, limit),
    staleTime: 60_000,
  });
}
