import { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://status-api.bundlenudge.com';

export function SubscribeForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/subscribe`, {
        method: 'POST',
        body: JSON.stringify({ email }),
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        setMessage({ type: 'success', text: "Subscribed. You'll receive an email when service status changes." });
        setEmail('');
      } else {
        setMessage({ type: 'error', text: 'Something went wrong. Please try again.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong. Please try again.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div id="subscribe" className="border-t border-slate-200 pt-8">
      <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:justify-between sm:text-left">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Get notified</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Receive email updates when services are disrupted.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex gap-2 sm:mt-0">
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm transition-colors focus:border-slate-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Subscribing...' : 'Subscribe'}
          </button>
        </form>
      </div>

      {message?.type === 'success' && (
        <div className="mt-3 text-sm text-green-600">
          {message.text}
        </div>
      )}
      {message?.type === 'error' && (
        <div className="mt-3 text-sm text-red-600">
          {message.text}
        </div>
      )}
    </div>
  );
}
