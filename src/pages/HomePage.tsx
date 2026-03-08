import { Link } from 'react-router';
import { useStatus } from '../hooks/useStatus';
import { useIncidents } from '../hooks/useIncidents';
import { useUptime } from '../hooks/useUptime';
import { StatusBadge } from '../components/StatusBadge';
import { IncidentBanner } from '../components/IncidentBanner';
import { ServiceRow } from '../components/ServiceRow';
import { IncidentTimeline } from '../components/IncidentTimeline';
import { SubscribeForm } from '../components/SubscribeForm';
import type { ServiceStatus, Incident } from '../lib/api';

function relativeTime(epoch: number): string {
  const diff = Math.floor(Date.now() / 1000) - epoch;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(epoch * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function EnrichedServiceRow({ service }: { service: ServiceStatus }) {
  const { data: days } = useUptime(service.slug);
  const uptimeDays = days || [];
  const validDays = uptimeDays.filter((d) => d.uptimePercent >= 0);
  const avgUptime =
    validDays.length > 0
      ? validDays.reduce((sum, d) => sum + d.uptimePercent, 0) / validDays.length
      : 100;

  return (
    <ServiceRow
      name={service.name}
      slug={service.slug}
      status={service.status}
      latencyMs={service.latencyMs}
      uptimeDays={uptimeDays}
      uptimePercent={avgUptime}
    />
  );
}

export function HomePage() {
  const { data: statusData } = useStatus();
  const { data: incidentsData } = useIncidents(1, 50);

  const overall = statusData?.overall || 'unknown';
  const services = statusData?.services || [];
  const lastChecked = statusData?.lastChecked || 0;
  const message = statusData?.message;

  const allIncidents = incidentsData?.incidents || [];
  const activeIncidents = allIncidents.filter((i: Incident) => i.status !== 'resolved');

  const now = Math.floor(Date.now() / 1000);
  const fourteenDaysAgo = now - 14 * 24 * 60 * 60;
  const recentResolved = allIncidents.filter(
    (i: Incident) => i.status === 'resolved' && i.startTime >= fourteenDaysAgo
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {/* Active Incident Banners */}
      {activeIncidents.length > 0 && (
        <div className="mb-8 space-y-4">
          {activeIncidents.map((incident) => (
            <IncidentBanner key={incident.id} incident={incident} />
          ))}
        </div>
      )}

      {/* Overall Status */}
      <StatusBadge status={overall} />

      {/* Custom status message from admin dashboard */}
      {message?.text && (
        <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-center">
          <p className="text-sm text-indigo-900">{message.text}</p>
          {message.updatedAt && (
            <p className="mt-1 text-xs text-indigo-400">
              Updated {new Date(message.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
      )}

      {lastChecked > 0 ? (
        <p className="mt-3 text-center text-xs text-slate-400">
          Last checked {relativeTime(lastChecked)} &middot; Checks every 5 minutes
        </p>
      ) : (
        <p className="mt-3 text-center text-xs text-slate-400">
          Status data unavailable &mdash; checks run every 5 minutes
        </p>
      )}

      {/* Services */}
      <div className="mt-10">
        {services.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {services.map((service) => (
              <EnrichedServiceRow key={service.slug} service={service} />
            ))}
          </div>
        ) : (
          <div className="py-16 text-center">
            <p className="text-sm text-slate-400">Waiting for first health check...</p>
          </div>
        )}
      </div>

      {/* Past Incidents */}
      <div className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Past Incidents</h2>
          <Link
            to="/history"
            className="text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700"
          >
            View all &rarr;
          </Link>
        </div>
        <div className="mt-4">
          <IncidentTimeline incidents={recentResolved} />
        </div>
      </div>

      {/* SLA */}
      <div className="mt-12 text-center">
        <p className="text-xs text-slate-400">
          We commit to 99.9% uptime.{' '}
          <a
            href="https://bundlenudge.com/sla"
            className="font-medium text-indigo-600 transition-colors hover:text-indigo-700"
          >
            View our SLA
          </a>
        </p>
      </div>

      {/* Subscribe */}
      <div className="mt-12">
        <SubscribeForm />
      </div>
    </main>
  );
}
