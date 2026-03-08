import type { UptimeDay } from '../lib/api';
import { UptimeBar } from './UptimeBar';

interface ServiceRowProps {
  name: string;
  slug: string;
  status: string;
  latencyMs: number;
  uptimeDays: UptimeDay[];
  uptimePercent: number;
}

const statusLabels: Record<string, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
};

const statusColors: Record<string, string> = {
  operational: 'text-green-600',
  degraded: 'text-yellow-600',
  down: 'text-red-600',
};

export function ServiceRow({ name, status, latencyMs, uptimeDays, uptimePercent }: ServiceRowProps) {
  const uptimeColor = uptimePercent >= 99.5
    ? 'text-indigo-600'
    : uptimePercent >= 95
      ? 'text-yellow-600'
      : 'text-red-600';

  return (
    <div className="border-b border-slate-100 py-6 last:border-b-0">
      {/* Top row: name + status */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-900">{name}</span>
          {latencyMs > 0 && (
            <span className="font-mono text-xs text-slate-400">{latencyMs}ms</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${statusColors[status] || 'text-slate-600'}`}>
            {statusLabels[status] || status}
          </span>
          <span className={`text-sm font-semibold tabular-nums ${uptimeColor}`}>
            {uptimePercent.toFixed(2)}% uptime
          </span>
        </div>
      </div>

      {/* Uptime bars */}
      <UptimeBar days={uptimeDays} />
    </div>
  );
}
