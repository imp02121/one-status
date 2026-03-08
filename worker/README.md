# Status Page Worker

Cloudflare Worker that runs health checks every 5 minutes, stores results in KV + D1, and sends notifications via Slack and email.

## Setup

### Create KV Namespace

```bash
wrangler kv namespace create STATUS_KV
# Copy the ID into wrangler.toml -> [[kv_namespaces]] -> id
```

### Create D1 Database

```bash
wrangler d1 create bundlenudge-status-db
# Copy the database_id into wrangler.toml -> [[d1_databases]] -> database_id
```

### Run Migrations

```bash
# Local development
wrangler d1 execute bundlenudge-status-db --local --file=migrations/0001_init.sql

# Production
wrangler d1 execute bundlenudge-status-db --remote --file=migrations/0001_init.sql
```

### Set Secrets

```bash
wrangler secret put SLACK_WEBHOOK_URL_OPS    # Slack incoming webhook URL
wrangler secret put RESEND_API_KEY           # Resend API key for email notifications
```

## Development

```bash
npm run dev          # Start local dev server (http://localhost:8787)
npm run test         # Run Vitest tests
npm run test:watch   # Run tests in watch mode
npm run typecheck    # TypeScript type checking
```

## Deploy

```bash
npm run deploy       # Deploy to Cloudflare Workers (runs `wrangler deploy`)
```

## Cron Schedule

The worker runs a cron trigger every 5 minutes (`*/5 * * * *`). Each cycle:

1. Reads previous service statuses from KV
2. Pings all services in parallel (5s timeout per probe)
3. Stores results in KV (latest status, daily history, daily uptime)
4. Detects status changes (compares current vs previous)
5. Sends notifications on changes (Slack webhook + email to verified subscribers)
6. Cleans up entries older than 91 days (runs once daily at midnight UTC)

## KV Key Schema

| Pattern | Example | Value | TTL |
| ------- | ------- | ----- | --- |
| `health:{service}:latest` | `health:api:latest` | `LatestStatus` JSON (status, latencyMs, checkedAt, error?) | None |
| `health:{service}:history:{date}` | `health:api:history:2026-03-08` | `HistoryEntry[]` JSON (max 288 entries = 24h * 12/hr) | 91 days |
| `uptime:{service}:daily:{date}` | `uptime:api:daily:2026-03-08` | `DailyUptime` JSON (totalChecks, operationalChecks, degradedChecks, downChecks, uptimePercent) | 91 days |
| `status:overall` | `status:overall` | `OverallStatus` JSON (status, services map, updatedAt) | None |
| `status:message` | `status:message` | `{ text, updatedAt }` JSON — custom admin message | None |

## D1 Schema

### `status_incidents`

| Column | Type | Default | Notes |
| ------ | ---- | ------- | ----- |
| `id` | INTEGER | AUTOINCREMENT | Primary key |
| `title` | TEXT | — | Required |
| `description` | TEXT | `''` | Incident details |
| `status` | TEXT | `'investigating'` | One of: investigating, identified, monitoring, resolved |
| `severity` | TEXT | `'minor'` | One of: minor, major, critical |
| `affected_services` | TEXT | `'[]'` | JSON array of service slugs |
| `created_at` | TEXT | `datetime('now')` | ISO timestamp |
| `updated_at` | TEXT | `datetime('now')` | ISO timestamp |
| `resolved_at` | TEXT | NULL | Set when status = resolved |

Indexes: `status`, `created_at DESC`, `severity`

### `status_subscribers`

| Column | Type | Default | Notes |
| ------ | ---- | ------- | ----- |
| `id` | INTEGER | AUTOINCREMENT | Primary key |
| `email` | TEXT | — | Required, unique |
| `verified` | INTEGER | `0` | 1 = verified via email link |
| `verify_token` | TEXT | — | UUID for email verification |
| `unsubscribe_token` | TEXT | — | UUID for one-click unsubscribe |
| `created_at` | TEXT | `datetime('now')` | ISO timestamp |

Indexes: `email`, `verify_token`, `unsubscribe_token`
