# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-03-08

### Added

- Astro 5 frontend with Tailwind CSS — status page at status.bundlenudge.com
- Cloudflare Worker with Hono v4 for API and cron health checks
- 7-service monitoring: API, Dashboard, Authentication, Edge Delivery, OTA Updates, Build Service, Documentation
- 90-day uptime history bars with daily aggregation
- Incident management via D1 (SQLite)
- Email subscriptions with verification (Resend API)
- Slack notifications on status changes (Block Kit)
- Custom admin status messages (PUT/DELETE /api/status/message)
- RSS feed for status updates
- 5-minute cron health checks with derived service status
- KV-based uptime storage with 91-day retention
- Security: admin auth, rate limiting, security headers, Content-Type validation, XSS prevention
- Incident detail page with update timeline (`/incident/[id]`)
- Admin SDK (`@bundlenudge/status-sdk`) — zero-dep TypeScript client (ESM + CJS)
- Admin endpoints: incident CRUD, subscriber management, KV-backed config
- PagerDuty-style Slack escalation rules with KV-deduplicated triggers
- Batched subscriber email notifications (50 per batch)
- Configurable health check URLs via admin config API
- Drop-in database migrations for D1, PostgreSQL, and MongoDB
- Stryker mutation testing (45% score, 70% covered)
- 352 tests across worker (276), SDK (43), and frontend (33)
