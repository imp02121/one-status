# Architecture

## Data Flow

```
┌─ Every 5 minutes (Cron Trigger) ─────────────────────────────────────┐
│                                                                       │
│  1. Read previous statuses from KV                                    │
│  2. Run health probes in parallel (5s timeout each)                   │
│     ├── GET  api.bundlenudge.com/health/deep  → API status           │
│     ├── HEAD app.bundlenudge.com              → Dashboard status     │
│     └── HEAD docs.bundlenudge.com             → Docs status          │
│  3. Derive dependent service statuses from API deep health check      │
│     ├── authentication (from pgAuth check)                            │
│     ├── edge-delivery  (from KV check)                                │
│     ├── ota-updates    (from API overall)                             │
│     └── build-service  (from API overall)                             │
│  4. Store all results in KV                                           │
│     ├── health:{service}:latest       → current status per service   │
│     ├── health:{service}:history:{d}  → append to daily history      │
│     ├── uptime:{service}:daily:{d}    → update daily uptime counters │
│     └── status:overall                → computed overall status      │
│  5. Compare current vs previous → detect changes                      │
│  6. On change → notify                                                │
│     ├── Slack webhook (Block Kit message per change)                  │
│     └── Resend email (to all verified subscribers)                    │
│  7. Cleanup (once daily at 00:00 UTC)                                 │
│     ├── Delete KV entries older than 91 days                          │
│     └── Delete resolved incidents older than 91 days from D1          │
└───────────────────────────────────────────────────────────────────────┘

┌─ Frontend (Astro SSG at build time or ISR) ──────────────────────────┐
│                                                                       │
│  index.astro:                                                         │
│    1. GET /api/status          → overall status + per-service map    │
│    2. GET /api/uptime?service= → 90-day history (parallel, 7x)      │
│    3. GET /api/incidents       → recent incidents                    │
│    4. Render: StatusBadge, ServiceRow (with UptimeBar), incidents     │
│                                                                       │
│  history.astro:                                                       │
│    1. GET /api/incidents?page= → paginated incident list             │
└───────────────────────────────────────────────────────────────────────┘
```

## Service Check Strategy

The worker probes **3 endpoints directly** and **derives 4 service statuses** from the API deep health check:

| Service | Check Type | Method | Target |
| ------- | ---------- | ------ | ------ |
| API | Direct | `GET /health/deep` | `api.bundlenudge.com` |
| Dashboard | Direct | `HEAD` | `app.bundlenudge.com` |
| Documentation | Direct | `HEAD` | `docs.bundlenudge.com` |
| Authentication | Derived | — | From API `checks.pgAuth` |
| Edge Delivery | Derived | — | From API `checks.kv` |
| OTA Updates | Derived | — | From API overall |
| Build Service | Derived | — | From API overall |

**Derived logic:** If the API is `down`, all derived services are `down`. If the API is `degraded`, derived services inherit `degraded`. If `operational`, derived services are `operational`.

The API's `/health/deep` endpoint returns sub-system checks (D1, R2, KV, Postgres auth) and circuit breaker states.

## Data Retention

- **KV history and uptime entries:** 91 days. Cleanup runs daily at the first cron after midnight UTC, deleting entries from days 91-97 (7-day sweep window).
- **D1 resolved incidents:** Deleted after 91 days (`resolved_at < cutoff`).
- **KV latest status and overall:** Never expires — always reflects the most recent check.
- **KV history entries per day:** Capped at 288 (24 hours * 12 checks/hour). Oldest entries are trimmed when the cap is exceeded.

## Notification Flow

```
Status Change Detected
  │
  ├── Slack
  │   └── POST to SLACK_WEBHOOK_URL_OPS
  │       └── Block Kit message: header, service/status fields, time, error, link
  │       └── One message per changed service (sent sequentially)
  │
  └── Email (Resend)
      └── Query D1: SELECT verified subscribers
          └── For each subscriber:
              └── POST to api.resend.com/emails
                  └── HTML email with: service table, previous→current status, unsubscribe link
```

Notifications are fire-and-forget. Failures are logged but do not block the health check cycle.

## Uptime Calculation

Per-service daily uptime:

```
uptimePercent = round(((operationalChecks + degradedChecks) / totalChecks) * 10000) / 100
```

- `operational` and `degraded` both count as "up"
- Only `down` counts against uptime
- `unknown` status is treated as `down`
- Result is rounded to 2 decimal places (e.g., 99.65%)

The frontend computes the **90-day average** by averaging all daily `uptimePercent` values where data exists. Days with no data (`uptime: null`) are excluded from the average.

## Overall Status

Computed from all 7 service statuses:

| Condition | Overall Status |
| --------- | -------------- |
| Any service is `down` | `down` |
| Any service is `degraded` (none `down`) | `degraded` |
| All services `operational` | `operational` |

The frontend maps `down` to `"outage"` for display.

## Storage Architecture

```
KV (fast reads, eventual consistency)
├── Per-service latest status     — updated every 5 min
├── Per-service daily history     — append-only array, max 288 entries/day
├── Per-service daily uptime      — running counters, updated every 5 min
├── Overall status                — recomputed every 5 min
└── Custom status message         — admin-managed

D1 (SQLite, transactional)
├── status_incidents              — incident lifecycle (create → resolve)
└── status_subscribers            — email subscriptions with verification tokens
```

KV is used for all read-heavy status data (frontend reads). D1 is used for relational data that needs transactions (incident management, subscriber deduplication).
