import { IncidentCard } from './IncidentCard';
import type { Incident } from '../lib/api';

interface IncidentTimelineProps {
  incidents: Incident[];
  showEmpty?: boolean;
}

function formatDateHeader(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function IncidentTimeline({ incidents, showEmpty = true }: IncidentTimelineProps) {
  // Group incidents by date
  const grouped = new Map<string, Incident[]>();
  for (const incident of incidents) {
    const dateKey = formatDateHeader(incident.startTime);
    const existing = grouped.get(dateKey);
    if (existing) {
      existing.push(incident);
    } else {
      grouped.set(dateKey, [incident]);
    }
  }

  if (incidents.length === 0 && showEmpty) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-slate-400">No incidents reported in this period.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {Array.from(grouped.entries()).map(([date, dateIncidents]) => (
        <div key={date} className="py-4 first:pt-0">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
            {date}
          </p>
          <div className="divide-y divide-slate-50">
            {dateIncidents.map((incident) => (
              <IncidentCard key={incident.id} incident={incident} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
