import { useParams, Link, Navigate } from 'react-router';
import { useIncident } from '../hooks/useIncident';

const severityColor: Record<string, string> = {
  minor: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  major: 'bg-orange-100 text-orange-800 border-orange-200',
  critical: 'bg-red-100 text-red-800 border-red-200',
  maintenance: 'bg-blue-100 text-blue-800 border-blue-200',
};

const statusColor: Record<string, string> = {
  investigating: 'text-red-600',
  identified: 'text-orange-600',
  monitoring: 'text-yellow-600',
  resolved: 'text-green-600',
};

const statusDot: Record<string, string> = {
  investigating: 'bg-red-500',
  identified: 'bg-orange-500',
  monitoring: 'bg-yellow-500',
  resolved: 'bg-green-500',
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

function formatUpdateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function IncidentPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useIncident(id || '');

  if (!id || (!isLoading && !data)) {
    return <Navigate to="/history" replace />;
  }

  if (isLoading || !data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-slate-400">Loading...</p>
      </main>
    );
  }

  const { incident, updates } = data;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        to="/history"
        className="mb-6 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700"
      >
        &larr; All incidents
      </Link>

      {/* Incident header */}
      <div className="mt-4">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${severityColor[incident.severity] || 'bg-slate-100 text-slate-800 border-slate-200'}`}>
            {incident.severity}
          </span>
          <span className={`mt-0.5 text-xs font-medium capitalize ${statusColor[incident.status] || 'text-slate-600'}`}>
            {incident.status}
          </span>
        </div>

        <h1 className="mt-3 text-xl font-semibold text-slate-900">{incident.title}</h1>

        {incident.description && (
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{incident.description}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span>Started {formatTime(incident.startTime)}</span>
          {incident.resolvedTime && (
            <span className="text-green-600">Resolved {formatTime(incident.resolvedTime)}</span>
          )}
        </div>

        {incident.affectedServices.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {incident.affectedServices.map((svc) => (
              <span key={svc} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {svc}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      {updates.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold text-slate-900">Timeline</h2>
          <div className="mt-4 space-y-0">
            {updates.map((update, i) => (
              <div key={update.id} className="relative flex gap-4 pb-6 last:pb-0">
                {/* Vertical line */}
                {i < updates.length - 1 && (
                  <div className="absolute left-[7px] top-4 h-full w-px bg-slate-200" />
                )}
                {/* Dot */}
                <div className="relative z-10 mt-1">
                  <span className={`block h-3.5 w-3.5 rounded-full border-2 border-white ${statusDot[update.status] || 'bg-slate-400'}`} />
                </div>
                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-xs font-semibold capitalize ${statusColor[update.status] || 'text-slate-600'}`}>
                      {update.status}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{formatUpdateTime(update.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{update.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {updates.length === 0 && (
        <div className="mt-10 rounded-lg border border-slate-100 py-8 text-center">
          <p className="text-sm text-slate-400">No updates posted yet.</p>
        </div>
      )}
    </main>
  );
}
