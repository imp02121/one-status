interface StatusBadgeProps {
  status: 'operational' | 'degraded' | 'outage' | 'unknown';
}

const config = {
  operational: {
    label: 'All systems operational',
    dotClass: 'bg-green-500',
    bgClass: 'bg-green-50 border-green-200',
    textClass: 'text-green-800',
  },
  degraded: {
    label: 'Experiencing issues',
    dotClass: 'bg-yellow-500',
    bgClass: 'bg-yellow-50 border-yellow-200',
    textClass: 'text-yellow-800',
  },
  outage: {
    label: 'Major outage in progress',
    dotClass: 'bg-red-500',
    bgClass: 'bg-red-50 border-red-200',
    textClass: 'text-red-800',
  },
  unknown: {
    label: 'Unable to determine status',
    dotClass: 'bg-slate-400',
    bgClass: 'bg-slate-50 border-slate-200',
    textClass: 'text-slate-600',
  },
} as const;

export function StatusBadge({ status }: StatusBadgeProps) {
  const { label, dotClass, bgClass, textClass } = config[status];

  return (
    <div className={`flex items-center justify-center gap-3 rounded-xl border px-6 py-5 ${bgClass}`}>
      <span className="relative flex h-3 w-3">
        {status === 'operational' && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${dotClass}`} />
        )}
        <span className={`relative inline-flex h-3 w-3 rounded-full ${dotClass}`} />
      </span>
      <span className={`text-lg font-semibold ${textClass}`}>{label}</span>
    </div>
  );
}
