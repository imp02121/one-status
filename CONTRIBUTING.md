# Contributing to One Status

Thank you for your interest in contributing!

## Current Status

We are **not currently accepting pull requests** from external contributors. This project is in active development and the architecture is still evolving.

## How to Contribute

- **Report bugs**: [Open a bug report](../../issues/new?template=bug_report.md)
- **Request features**: [Open a feature request](../../issues/new?template=feature_request.md)
- **Ask questions**: Open a discussion in the Issues tab

## Long-Term Contributors

We are looking for dedicated long-term contributors who want to help shape the future of this project. If you are interested in becoming a maintainer, please reach out by opening an issue describing your background and how you would like to contribute.

## Development Setup

### Prerequisites

- Node.js >= 18
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account (for KV + D1 bindings)

### Frontend (Astro)

```bash
npm install
npm run dev         # http://localhost:4321
npm run build       # Static build to dist/
```

### Worker (Cloudflare Workers)

```bash
cd worker
npm install
npm run test        # Run Vitest tests (276 tests)
npm run typecheck   # TypeScript check
npm run dev         # Local dev with Wrangler
```

### Project Structure

```
one-status/
├── src/                    # Astro frontend
│   ├── components/         # .astro UI components
│   ├── layouts/            # Base HTML layout
│   ├── lib/                # API client (api.ts)
│   └── pages/              # Routes (/, /history, /incident/[id], /rss.xml)
├── worker/                 # Cloudflare Worker
│   ├── src/
│   │   ├── cron/           # Scheduled health checks
│   │   ├── lib/            # Email, Slack, notifications
│   │   ├── middleware/     # Auth, rate limiting
│   │   └── routes/         # Hono API routes
│   ├── migrations/         # D1, PostgreSQL, MongoDB
│   └── stryker.config.json # Mutation testing
├── sdk/                    # Admin SDK (@bundlenudge/status-sdk)
│   └── src/                # Client, types, errors
└── docs/                   # Documentation
```

## Code Style

- TypeScript strict mode
- Zod for all runtime validation
- Named exports only (no `export default` except CF Worker handler)
- Tests colocated next to source (`*.test.ts`)
- Max 300 lines per file, 50 lines per function
- Early returns over nesting

## License

This project is licensed under BSL 1.1. See [LICENSE](LICENSE) for details.
