import { useQuery } from '@tanstack/react-query';
import { fetchStatus } from '../lib/api';

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
