import type { Incident } from '../lib/api';

interface IncidentBannerProps {
  incident: Incident;
}

const severityConfig = {
  minor: {
    borderClass: 'border-yellow-600',
    headerBg: 'bg-yellow-500',
  },
  major: {
    borderClass: 'border-orange-600',
    headerBg: 'bg-orange-500',
  },
  critical: {
    borderClass: 'border-red-700',
    headerBg: 'bg-red-600',
  },
  maintenance: {
    borderClass: 'border-blue-600',
    headerBg: 'bg-blue-500',
  },
} as const;

function formatTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
}

export function IncidentBanner({ incident }: IncidentBannerProps) {
  const config = severityConfig[incident.severity] || severityConfig.minor;

  return (
    <div className={`overflow-hidden rounded-xl border ${config.borderClass}`}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-5 py-3 ${config.headerBg}`}>
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span className="text-sm font-semibold text-white">{incident.title}</span>
      </div>

      {/* Body */}
      <div className="space-y-4 bg-white px-5 py-4">
        {/* Current status update */}
        <div>
          <p className="text-sm text-slate-800">
            <span className="font-bold capitalize">{incident.status}</span>
            {' \u2013 '}
            {incident.description}
          </p>
          <p className="mt-1 text-xs text-slate-500">{formatTime(incident.startTime)}</p>
        </div>

        {incident.affectedServices.length > 0 && (
          <p className="text-xs text-slate-500">
            Affected services: {incident.affectedServices.join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
