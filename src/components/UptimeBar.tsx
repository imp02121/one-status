import type { UptimeDay } from '../lib/api';

interface UptimeBarProps {
  days: UptimeDay[];
}

function getBarColor(percent: number): string {
  if (percent >= 99.5) return 'bg-indigo-500';
  if (percent >= 95) return 'bg-yellow-400';
  if (percent > 0) return 'bg-red-500';
  return 'bg-slate-200';
}

export function UptimeBar({ days }: UptimeBarProps) {
  // Pad to 90 days if needed
  const paddedDays = days.length >= 90
    ? days.slice(-90)
    : [
        ...Array.from({ length: 90 - days.length }, () => ({ date: '', uptimePercent: -1 })),
        ...days,
      ];

  return (
    <div>
      <div className="flex items-stretch gap-[2px]" style={{ height: 32 }}>
        {paddedDays.map((day, i) => (
          <div
            key={day.date || i}
            className={`flex-1 rounded-[2px] transition-opacity hover:opacity-80 ${
              day.uptimePercent < 0 ? 'bg-slate-100' : getBarColor(day.uptimePercent)
            }`}
            title={day.date ? `${day.date}: ${day.uptimePercent.toFixed(2)}% uptime` : 'No data'}
          />
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-xs text-slate-400">90 days ago</span>
        <span className="text-xs text-slate-400">Today</span>
      </div>
    </div>
  );
}
