import { Link } from 'react-router';
import type { Incident } from '../lib/api';

interface IncidentCardProps {
  incident: Incident;
}

const severityDot: Record<string, string> = {
  minor: 'bg-yellow-400',
  major: 'bg-orange-400',
  critical: 'bg-red-500',
  maintenance: 'bg-blue-400',
};

function formatTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
}

export function IncidentCard({ incident }: IncidentCardProps) {
  return (
    <div className="py-4" id={incident.id}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityDot[incident.severity] || 'bg-slate-400'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-4">
            <Link to={`/incident/${incident.id}`} className="text-sm font-semibold text-slate-900 transition-colors hover:text-indigo-600">{incident.title}</Link>
            <span className="shrink-0 text-xs text-slate-400">{formatTime(incident.startTime)}</span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{incident.description}</p>
          {incident.affectedServices.length > 0 && (
            <p className="mt-1.5 text-xs text-slate-400">
              {incident.affectedServices.join(' \u00b7 ')}
            </p>
          )}
          {incident.resolvedTime && (
            <p className="mt-1.5 text-xs text-green-600">
              Resolved {formatTime(incident.resolvedTime)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
