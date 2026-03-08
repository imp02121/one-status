# Environment Variables

## Worker (Cloudflare Workers)

### Bindings (wrangler.toml)

| Name | Type | Description |
| ---- | ---- | ----------- |
| `STATUS_DB` | D1 Database | SQLite database for incidents and subscribers |
| `STATUS_KV` | KV Namespace | Key-value store for status data and uptime history |

### Variables (wrangler.toml `[vars]`)

| Name | Required | Default | Description | Example |
| ---- | -------- | ------- | ----------- | ------- |
| `ENVIRONMENT` | Yes | `"production"` | Environment name | `production`, `staging` |
| `STATUS_PAGE_URL` | Yes | `"https://status.bundlenudge.com"` | Public URL of the status page frontend. Used in email links (verify, unsubscribe) and Slack messages. | `https://status.bundlenudge.com` |

### Secrets (`wrangler secret put`)

| Name | Required | Description | Example |
| ---- | -------- | ----------- | ------- |
| `SLACK_WEBHOOK_URL_OPS` | Yes | Slack incoming webhook URL for status change notifications. Create one at [api.slack.com/apps](https://api.slack.com/apps). | `https://hooks.slack.com/services/T.../B.../xxx` |
| `RESEND_API_KEY` | Yes | API key from [resend.com](https://resend.com). Used to send verification emails and status change notifications to subscribers. | `re_123abc...` |

If `RESEND_API_KEY` is not set, email sending silently skips. If `SLACK_WEBHOOK_URL_OPS` is not set, Slack notifications silently skip.

## Frontend (Astro)

| Name | Required | Default | Description | Example |
| ---- | -------- | ------- | ----------- | ------- |
| `PUBLIC_STATUS_API_URL` | No | `https://status-api.bundlenudge.com` | Worker API base URL. Set at build time — Astro embeds it during static site generation. | `http://localhost:8787` (dev) |

Set via environment or `.env` file:

```bash
# .env (local development)
PUBLIC_STATUS_API_URL=http://localhost:8787

# Production build
PUBLIC_STATUS_API_URL=https://status-api.bundlenudge.com npm run build
```

## Local Development

For local development, the worker dev server (`wrangler dev`) uses local D1 and KV emulation. No secrets are required for basic functionality — Slack and email notifications will silently skip when credentials are absent.

```bash
# Worker (no secrets needed locally)
cd worker
npm run dev

# Frontend (points to local worker)
PUBLIC_STATUS_API_URL=http://localhost:8787 npm run dev
```
