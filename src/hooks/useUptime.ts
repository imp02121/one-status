import { useQuery } from '@tanstack/react-query';
import { fetchUptime } from '../lib/api';

export function useUptime(service: string, days = 90) {
  return useQuery({
    queryKey: ['uptime', service, days],
    queryFn: () => fetchUptime(service, days),
    staleTime: 5 * 60_000,
    enabled: !!service,
  });
}
