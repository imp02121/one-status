import { Link, useSearchParams } from 'react-router';
import { useIncidents } from '../hooks/useIncidents';
import { IncidentTimeline } from '../components/IncidentTimeline';

export function HistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const limit = 20;

  const { data } = useIncidents(page, limit);
  const incidents = data?.incidents || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit) || 1;

  function goToPage(p: number) {
    setSearchParams({ page: String(p) });
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Incident History</h1>
          <p className="mt-1 text-sm text-slate-500">
            Complete log of past incidents and maintenance.
          </p>
        </div>
        <Link
          to="/"
          className="text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700"
        >
          &larr; Current status
        </Link>
      </div>

      <div className="mt-8">
        <IncidentTimeline incidents={incidents} />
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-6">
          {page > 1 ? (
            <button
              onClick={() => goToPage(page - 1)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300"
            >
              Previous
            </button>
          ) : (
            <span />
          )}
          <span className="text-xs text-slate-400">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <button
              onClick={() => goToPage(page + 1)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300"
            >
              Next
            </button>
          ) : (
            <span />
          )}
        </div>
      )}
    </main>
  );
}
