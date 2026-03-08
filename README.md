# One Status

Open-source status page built with Astro and Cloudflare Workers. Monitor services, manage incidents, notify subscribers — all on Cloudflare's free tier.

## Features

- **Service monitoring** — Automated health checks every 5 minutes with configurable probes (HEAD or deep-health)
- **90-day uptime bars** — Per-service daily uptime percentages with color-coded visualization
- **Incident management** — Full CRUD with severity levels, status timeline, and affected services
- **Email subscriptions** — Double opt-in via Resend with verification and one-click unsubscribe
- **Slack notifications** — PagerDuty-style alerts with Block Kit formatting and escalation rules
- **RSS feed** — Subscribe to incident updates via RSS at `/rss.xml`
- **Admin SDK** — TypeScript client (`@bundlenudge/status-sdk`) for managing the status page from any dashboard
- **Configurable** — Services, notifications, and email settings managed via KV-backed config API
- **Multi-database** — Drop-in migrations for D1 (Cloudflare), PostgreSQL, and MongoDB

## Tech Stack

| Layer      | Technology                            |
| ---------- | ------------------------------------- |
| Frontend   | Astro 5 + Tailwind CSS 3 + TypeScript |
| API        | Cloudflare Workers + Hono v4          |
| Database   | Cloudflare D1 (SQLite)                |
| Cache      | Cloudflare KV                         |
| Email      | Resend API                            |
| Alerts     | Slack Incoming Webhooks               |
| Validation | Zod                                   |
| Testing    | Vitest + Stryker (mutation)           |
| SDK        | TypeScript (ESM + CJS via tsup)       |

## Architecture

```
                        ┌─────────────────────────────────────┐
                        │        Cloudflare Workers           │
                        │                                     │
  ┌──────────┐  fetch   │  ┌─────────┐    ┌──────────────┐   │
  │  Astro   │─────────>│  │  Hono   │───>│  D1 (SQLite) │   │
  │ Frontend │  /api/*  │  │  Router  │    │  incidents   │   │
  │ (SSG)    │<─────────│  │         │    │  subscribers  │   │
  └──────────┘          │  └────┬────┘    └──────────────┘   │
                        │       │                             │
  ┌──────────┐          │  ┌────┴────┐    ┌──────────────┐   │
  │  Slack   │<─────────│  │  Cron   │───>│      KV      │   │
  │ Webhook  │          │  │ (5 min) │    │  status data  │   │
  └──────────┘          │  └────┬────┘    │  uptime hist  │   │
                        │       │         │  config       │   │
  ┌──────────┐          │       v         └──────────────┘   │
  │  Resend  │<─────────│  Health Probes                      │
  │  (email) │          │  (configurable via admin API)       │
  └──────────┘          └─────────────────────────────────────┘
```

## Quick Start

```bash
# Frontend (Astro)
npm install
npm run dev              # http://localhost:4321

# Worker (Cloudflare)
cd worker
npm install
npm run dev              # http://localhost:8787
npm run test             # 276 tests

# SDK
cd sdk
npm install
npm run test             # 43 tests
npm run build            # ESM + CJS + DTS
```

## Project Structure

```
one-status/
├── src/
│   ├── components/          # Astro components
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── StatusBadge.astro
│   │   ├── ServiceRow.astro
│   │   ├── UptimeBar.astro
│   │   ├── IncidentBanner.astro
│   │   ├── IncidentCard.astro
│   │   ├── IncidentTimeline.astro
│   │   └── SubscribeForm.astro
│   ├── layouts/
│   │   └── BaseLayout.astro
│   ├── lib/
│   │   └── api.ts           # Frontend API client
│   └── pages/
│       ├── index.astro      # Main status page
│       ├── history.astro    # Paginated incident history
│       ├── incident/[id].astro  # Incident detail + timeline
│       └── rss.xml.ts       # RSS feed
├── worker/
│   ├── src/
│   │   ├── index.ts         # Hono app + cron handler
│   │   ├── types.ts         # TypeScript types
│   │   ├── routes/
│   │   │   ├── status.ts        # GET/PUT/DELETE /api/status
│   │   │   ├── uptime.ts        # GET /api/uptime
│   │   │   ├── incidents.ts     # Full CRUD /api/incidents
│   │   │   ├── subscribe.ts     # POST /api/subscribe + GET /api/verify
│   │   │   ├── unsubscribe.ts   # GET /api/unsubscribe
│   │   │   ├── admin-subscribers.ts  # Subscriber management
│   │   │   ├── admin-config.ts  # Config CRUD
│   │   │   └── ping.ts         # GET /api/ping
│   │   ├── cron/
│   │   │   ├── health-check.ts  # Cron orchestrator
│   │   │   ├── service-checks.ts # Health probes
│   │   │   └── kv-storage.ts    # KV operations
│   │   ├── lib/
│   │   │   ├── notifications.ts # Slack + email + escalation
│   │   │   ├── slack.ts        # Slack Block Kit
│   │   │   ├── email.ts        # Resend email
│   │   │   ├── fetch-timeout.ts # Fetch with timeout
│   │   │   └── html.ts         # XSS escaping
│   │   └── middleware/
│   │       ├── admin-auth.ts    # Bearer token auth
│   │       └── rate-limit.ts    # KV-based rate limiting
│   ├── migrations/
│   │   ├── d1/               # Cloudflare D1 (SQLite)
│   │   ├── postgres/         # PostgreSQL
│   │   └── mongodb/          # MongoDB
│   ├── stryker.config.json
│   └── wrangler.toml
├── sdk/
│   ├── src/
│   │   ├── client.ts        # StatusPageClient class
│   │   ├── types.ts         # Request/response types
│   │   ├── errors.ts        # Typed error hierarchy
│   │   └── index.ts         # Re-exports
│   ├── tsup.config.ts       # ESM + CJS build
│   └── package.json
├── shared/
│   └── constants.ts         # Service names (shared)
└── docs/
    ├── API.md               # Full API reference
    ├── ARCHITECTURE.md
    ├── CUSTOMIZATION.md
    ├── DEPLOYMENT.md
    └── ENVIRONMENT.md
```

## Admin SDK

Install and use the SDK to manage your status page programmatically:

```typescript
import { StatusPageClient } from '@bundlenudge/status-sdk';

const client = new StatusPageClient({
  baseUrl: 'https://status-api.example.com',
  adminToken: 'your-admin-token',
});

// Create an incident
await client.createIncident({
  title: 'API elevated error rates',
  description: 'Investigating 500s on /v1/updates/check',
  severity: 'major',
  affectedServices: ['api', 'ota-updates'],
});

// Update config (services, Slack, email)
await client.updateConfig({
  services: [
    { slug: 'api', name: 'API', url: 'https://api.example.com/health', checkType: 'deep-health' },
    { slug: 'web', name: 'Web App', url: 'https://app.example.com', checkType: 'head' },
  ],
  emailFrom: 'status@example.com',
  emailFromName: 'Status Page',
  notifications: {
    slack: {
      enabled: true,
      webhookUrl: 'https://hooks.slack.com/services/...',
      severityFilter: ['critical', 'major'],
      escalation: [
        { afterMinutes: 15, webhookUrl: 'https://hooks.slack.com/services/...', mention: '@oncall' },
      ],
    },
    email: { enabled: true, onStatusChange: true, onIncident: true },
  },
});
```

See [sdk/README.md](sdk/README.md) for full API reference.

## Documentation

- [API Reference](docs/API.md) — All endpoints with request/response examples
- [Architecture](docs/ARCHITECTURE.md) — Data flow, health checks, uptime calculation
- [Customization](docs/CUSTOMIZATION.md) — Branding, colors, services, fonts
- [Deployment](docs/DEPLOYMENT.md) — Cloudflare Workers + Pages deployment
- [Environment Variables](docs/ENVIRONMENT.md) — All configuration options
- [Database Migrations](worker/migrations/README.md) — D1, PostgreSQL, MongoDB setup

## Testing

```bash
# Worker tests (276 tests)
cd worker && npm test

# SDK tests (43 tests)
cd sdk && npm test

# Frontend tests (33 tests)
npm test

# Mutation testing (Stryker)
cd worker && npm run test:mutate
```

## License

BSL 1.1 — See [LICENSE](LICENSE) for details. Converts to Apache 2.0 after 4 years.
