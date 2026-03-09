# One Status — SaaS Plan

> Open-source status page monitoring. Undercut everyone. Ship fast.

## Vision

Status page monitoring is a commodity. Competitors charge $29-$399/month for what amounts to pinging URLs and showing green dots. Our infrastructure cost is ~$0.30/tenant/month on Cloudflare. We pass those savings on with aggressive pricing that makes switching a no-brainer.

**Goal:** Become the default status page for indie devs, startups, and small teams by being the cheapest, simplest, and fastest to set up.

---

## Pricing

### The Strategy

Undercut every competitor by a country mile. Atlassian Statuspage charges $29/mo for their cheapest paid tier. Better Stack charges $21/mo. We charge $4.99.

Our infrastructure runs on Cloudflare Workers + D1 + KV. Marginal cost per tenant: ~$0.30/month. Even at $4.99 we're running 94% gross margins. This is a volume play.

### Tiers

| | **Free** | **Starter — $4.99/mo** | **Pro — $9.99/mo** | **Business — $29.99/mo** |
|---|---|---|---|---|
| **Status pages** | 1 | 1 | 3 | Unlimited |
| **Monitors** | 3 | 10 | 25 | 100 |
| **Check interval** | 5 min | 1 min | 30 sec | 30 sec |
| **Subscribers** | 50 | 500 | 2,000 | 10,000 |
| **Team members** | 1 | 3 | 10 | Unlimited |
| **Custom domain** | No | Yes | Yes | Yes |
| **Branding** | "Powered by One Status" | "Powered by One Status" | Remove branding | Full white-label |
| **Email notifications** | No | No | 1,000/mo to subscribers | 5,000/mo |
| **Slack/Discord alerts** | No | No | Yes | Yes |
| **Webhook integrations** | No | No | Yes | Yes |
| **Incident history** | 7 days | 30 days | 90 days | 1 year |
| **API access** | Read-only | Read-only | Full CRUD | Full CRUD |
| **Custom CSS** | No | No | No | Yes |
| **SSO/SAML** | No | No | No | Yes |
| **Priority support** | No | No | No | Yes |
| **SMS credits** | No | No | No | 200/mo |

### Competitor Comparison

| Provider | Cheapest Paid Tier | What You Get |
|---|---|---|
| **One Status** | **$4.99/mo** | 10 monitors, 1-min checks, custom domain, 500 subscribers |
| UptimeRobot | $7/mo | 10 monitors, 60s checks, no custom domain |
| Instatus | $15-20/mo | 50 monitors, 30s checks, custom domain |
| Better Stack | $21/mo | 50 monitors, 30s checks |
| HyperPing | $24/mo | 50 monitors, 2 seats |
| Atlassian Statuspage | $29/mo | 250 subscribers, 5 team members |
| PagerDuty | $89/mo add-on | 1K subscribers |

We're **6x cheaper** than Statuspage and **4x cheaper** than Better Stack for the features most teams actually need.

### Annual Billing

2 months free (17% discount):
- Starter: $4.99/mo → $49.90/year ($4.16/mo)
- Pro: $9.99/mo → $99.90/year ($8.33/mo)
- Business: $29.99/mo → $299.90/year ($24.99/mo)

### Margin Analysis

| | Free | Starter $4.99 | Pro $9.99 | Business $29.99 |
|---|---|---|---|---|
| CF infra cost/tenant | $0.10 | $0.30 | $0.50 | $1.00 |
| Email cost (Resend) | $0 | $0 | ~$0.50 | ~$2.50 |
| SMS cost (Twilio) | $0 | $0 | $0 | ~$1.50 |
| **Total cost** | **$0.10** | **$0.30** | **$1.00** | **$5.00** |
| **Gross margin** | **N/A** | **94%** | **90%** | **83%** |

Even at rock-bottom prices, margins are excellent because Cloudflare's free tiers cover most of the load.

### Billing Integration

**Use Polar** (already integrated in BundleNudge):
- Merchant of Record — handles global sales tax/VAT
- Usage-based metering via Events Ingestion API
- Built-in customer portal for self-service
- Subscription management (renewals, proration, dunning, trials)
- 4% + $0.40 per transaction

---

## Architecture

### Current State (Single-Tenant Prototype)

```
Vite + React 19 SPA (status.bundlenudge.com)
  → Cloudflare Worker (status-api.bundlenudge.com)
    → KV (health check data, config)
    → D1 (incidents, subscribers)
    → Cron (1-min health checks)
```

### Target State (Multi-Tenant SaaS)

```
Public Status Pages:       {slug}.onestatus.dev / status.customer.com
Customer Dashboard:        app.onestatus.dev
Marketing/Landing:         onestatus.dev

All served by single Cloudflare Worker:
  → Tenant resolution (Host header → slug → tenant lookup)
  → Shared D1 (tenant_id on all tables)
  → Shared KV (t:{tenantId}: key prefix)
  → Cloudflare Queues (fan-out health checks per tenant)
  → Better Auth (magic link, Neon Postgres for sessions)
  → Polar (billing, metering)
  → Cloudflare for SaaS (custom hostnames for customer domains)
```

### Multi-Tenancy Design

**Database: Shared D1 with `tenant_id` column**
- Single database, single migration path, simple operations
- 10GB limit is generous (~10M incident records)
- Every query scoped by `tenant_id` — enforced via helper/ORM layer

**KV: Shared namespace with tenant-prefixed keys**
- Pattern: `t:{tenantId}:health:{service}:latest`
- CF limit of 100 namespaces makes per-tenant KV impossible
- Shared KV has 100k reads/sec — more than enough

**Cron: Fan-out via Cloudflare Queues**
- Cron (every 1 min) reads all tenants → enqueues check messages
- Queue consumer runs health checks per tenant (own 30s CPU budget)
- Scales to 1,000+ tenants without hitting Worker CPU limits
- Phase 1 shortcut: direct cron works for <100 tenants

**Tenant routing: Subdomain + custom domain**
- Wildcard DNS `*.onestatus.dev` → Worker inspects Host header
- Custom domains via Cloudflare for SaaS (CNAME → auto SSL)
- First 100 custom hostnames free, $0.10/mo each after

### New Database Schema

```sql
-- Tenants
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  owner_id TEXT NOT NULL,
  custom_domain TEXT,
  custom_domain_status TEXT DEFAULT 'none',
  branding_logo_url TEXT,
  branding_color TEXT DEFAULT '#4F46E5',
  branding_show_badge INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Services to monitor (per tenant)
CREATE TABLE tenant_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  check_type TEXT NOT NULL DEFAULT 'head',
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, slug)
);

-- Team members
CREATE TABLE tenant_members (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  invited_by TEXT,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, user_id)
);

-- Team invitations
CREATE TABLE tenant_invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  token TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-tenant API keys
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '["admin"]',
  last_used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Existing tables get tenant_id added:
-- status_incidents + tenant_id
-- status_incident_updates + tenant_id
-- status_subscribers + tenant_id
```

---

## Onboarding Flow

### Goal: Live status page in under 2 minutes

```
Magic link signup (enter email → click link → authenticated)
  ↓
Create workspace (company name + subdomain)
  ↓
Add first service (URL + name → instant health check)
  ↓
Status page is LIVE at {slug}.onestatus.dev
  ↓
Dashboard with guided checklist for remaining setup
```

### Step 1: Signup (Magic Link)

- Single email input → "Check your email" → click link → authenticated
- Better Auth `magicLink` plugin (already using Resend for emails)
- No passwords to manage, no credential stuffing risk
- 5-minute expiry, rate limited to 3/email/hour

### Step 2: Create Workspace (30 seconds)

- **Company name** (required) — displayed on status page header
- **Subdomain** (required, auto-suggested) — `{slug}.onestatus.dev`
  - Real-time availability check
  - Regex: `^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$`
- **Logo** (optional, skip) — R2 upload, max 2MB

### Step 3: Add First Service (60 seconds)

- **Name** + **URL** — that's it
- "Test now" button pings URL immediately, shows result live
- Quick templates: "Web App" (HEAD), "API" (deep-health /health), "Docs" (HEAD)
- Minimum 1 service, maximum per plan (3 free, 10 starter, etc.)

### Step 4: Done — Page Is Live

- Redirect to dashboard with live status page preview
- Checklist sidebar for optional setup:
  - [x] Create workspace
  - [x] Add first service
  - [ ] Add more services
  - [ ] Set up custom domain (Starter+)
  - [ ] Connect Slack (Pro+)
  - [ ] Customize branding
  - [ ] Invite team members
  - [ ] Set up email notifications (Pro+)

### Custom Domain Setup (Starter+ / $4.99)

1. Tenant enters `status.customer.com` in Settings → Custom Domain
2. We call Cloudflare Custom Hostnames API
3. Dashboard shows: "Add this CNAME record at your DNS provider: `status.customer.com → custom.onestatus.dev`"
4. Status indicator: Pending → Validating → Active (5-15 min)
5. Auto SSL via Cloudflare (Let's Encrypt)
6. "Powered by One Status" badge required on Starter tier

---

## Customer Dashboard

### What Each Customer Manages

| Feature | Free | Starter | Pro | Business |
|---|---|---|---|---|
| Services (add/edit/remove monitors) | Yes | Yes | Yes | Yes |
| Incidents (create/update/resolve) | Yes | Yes | Yes | Yes |
| Subscribers (view/remove) | Yes | Yes | Yes | Yes |
| Status message (set/clear) | Yes | Yes | Yes | Yes |
| Custom domain | No | Yes | Yes | Yes |
| Notification channels | No | No | Slack + email | All |
| Branding (logo, colors) | No | No | Yes | Yes + CSS |
| Team members | No | Yes | Yes | Yes |
| API keys | No | No | Yes | Yes |

### Tech Stack (Customer Dashboard)

- `app.onestatus.dev` — Vite 6 + React 19 SPA
- react-router v7 for routing
- TanStack Query v5 for data fetching
- Better Auth (magic link) for authentication
- Tailwind CSS 3 for styling
- Reuse `shared-ui` component library from BundleNudge

### Team Roles (RBAC)

| Permission | Owner | Admin | Editor | Viewer |
|---|---|---|---|---|
| Billing & plan | Yes | No | No | No |
| Delete workspace | Yes | No | No | No |
| Manage team members | Yes | Yes | No | No |
| Manage API keys | Yes | Yes | No | No |
| Configure services | Yes | Yes | No | No |
| Custom domain | Yes | Yes | No | No |
| Branding settings | Yes | Yes | No | No |
| Create/update incidents | Yes | Yes | Yes | No |
| Set status message | Yes | Yes | Yes | No |
| View dashboard | Yes | Yes | Yes | Yes |

### Per-Tenant API Keys

- Format: `os_live_<random32>` / `os_test_<random32>`
- Stored as SHA-256 hash in D1
- Scoped permissions: `incidents:read`, `incidents:write`, `config:read`, `config:write`, `subscribers:read`
- Dashboard: generate, name, set scopes, view last-used, revoke
- Rate limited per key via KV

---

## Notification System

| Channel | Tier | Implementation |
|---|---|---|
| RSS feed | All | Already built (`/api/rss`) |
| Email to subscribers | Pro+ ($9.99) | Already built (Resend). Quota: 1K/mo Pro, 5K/mo Business |
| Slack alerts | Pro+ ($9.99) | Already built. Tenant pastes webhook URL |
| Discord alerts | Pro+ ($9.99) | Discord webhooks are near-identical to Slack format |
| Webhook (generic) | Pro+ ($9.99) | POST to customer URL on status change |
| PagerDuty | Business ($29.99) | PagerDuty Events API v2 integration |
| SMS alerts | Business ($29.99) | Twilio. 200 credits/mo included |
| Escalation rules | Pro+ ($9.99) | Already built. After N minutes → additional webhook |

### How Slack/Discord Alerts Work (Pro+)

1. Tenant connects Slack in Settings → Notifications → paste webhook URL
2. "Test" button sends a test message
3. When any monitored service changes status, Worker sends formatted alert:
   - Service name, old status → new status, timestamp
   - Link to status page
   - Severity-based formatting (red for down, yellow for degraded, green for recovered)

---

## Platform Operations (Super-Admin)

### What We Need to Manage

- **Tenant overview** — all tenants, plan, created date, service count, subscriber count
- **Usage metrics** — health checks/month, email sends, subscribers per tenant
- **Billing status** — plan tier, payment status, trial expiry (via Polar dashboard)
- **System health** — worker status, D1 size, KV usage, queue depth
- **Feature flags** — per-tenant toggles (beta features, custom domain access)
- **Impersonation** — view any tenant's dashboard as them (for support)

### Where to Build It

Extend the existing BundleNudge admin dashboard (`packages/admin-dashboard-v2/`) — it already has:
- Status page integration (4 pages, 19 hooks, full API client)
- Better Auth with emailOTP
- Sidebar nav with section groups
- All the UI patterns needed

Add a "One Status" nav section with: Tenants, Usage, System Health.

---

## Implementation Roadmap

### Phase 1 — Multi-Tenant Foundation (2-3 weeks)

- [ ] D1 schema: `tenants`, `tenant_services`, `tenant_members`, `api_keys` tables
- [ ] Add `tenant_id` to all existing tables + migrations
- [ ] Tenant resolution middleware (Host header → slug → DB lookup)
- [ ] Per-tenant API key auth (replace single ADMIN_API_KEY)
- [ ] Scope all existing routes by `tenant_id`
- [ ] Per-tenant KV key prefixing (`t:{tenantId}:`)
- [ ] Per-tenant cron health checks (read services from DB, not config)

### Phase 2 — Auth & Onboarding (1-2 weeks)

- [ ] Better Auth setup (magic link plugin + Resend)
- [ ] Signup → workspace creation → add first service flow
- [ ] Customer dashboard SPA (app.onestatus.dev)
- [ ] Service management UI (add/edit/delete monitors)
- [ ] Incident management UI (CRUD + timeline)
- [ ] Onboarding checklist component

### Phase 3 — Billing & Plans (1 week)

- [ ] Polar product setup (4 tiers)
- [ ] Plan enforcement middleware (monitor limits, check intervals, feature gates)
- [ ] Usage metering (monitors, subscribers, email sends)
- [ ] Upgrade/downgrade flow in dashboard
- [ ] Billing portal link (Polar hosted)

### Phase 4 — Custom Domains (1 week)

- [ ] Cloudflare for SaaS custom hostname API integration
- [ ] Domain settings page with DNS instructions + validation status
- [ ] Host header → tenant routing for custom domains
- [ ] KV lookup cache for custom domain → tenant mapping
- [ ] "Powered by One Status" badge on Starter tier

### Phase 5 — Notifications (1 week)

- [ ] Per-tenant Slack webhook configuration
- [ ] Per-tenant email notification settings
- [ ] Discord webhook support
- [ ] Generic webhook integration
- [ ] Notification quota enforcement per plan

### Phase 6 — Team & Polish (1 week)

- [ ] Team invitations (email invite → accept → join)
- [ ] RBAC middleware (owner/admin/editor/viewer)
- [ ] Branding settings (logo, colors, badge toggle)
- [ ] Cron scaling via Cloudflare Queues (for >100 tenants)
- [ ] Super-admin tenant management in BundleNudge admin dashboard

---

## Cloudflare Resource Limits

| Resource | Free Tier Included | Paid ($5/mo) | Concern |
|---|---|---|---|
| Worker requests | 100k/day | 10M/mo included | None |
| D1 reads | 5M rows/day | 25B rows/mo | None |
| D1 writes | 100k/day | 50M rows/mo | None |
| D1 database size | 500MB | 10GB | Low — text data is small |
| KV reads | 100k/day | 10M/mo | None |
| KV writes | 1k/day | 1M/mo | Medium at scale — cron writes |
| KV namespaces | 100 | 100 | Use shared (not per-tenant) |
| Custom hostnames | N/A | 100 free, $0.10/mo each | Low cost |
| Queues | N/A | Free (included) | None |
| Worker CPU (cron) | 10ms | 30s | Need Queues for >100 tenants |

**Bottom line:** Cloudflare's $5/mo paid plan covers a massive amount of usage. Our per-tenant cost is negligible until thousands of tenants.

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Database | Shared D1 + tenant_id | Simple ops, single migration path, 10GB is plenty |
| KV | Shared namespace + prefix | CF limit of 100 namespaces makes per-tenant impossible |
| Auth | Better Auth + magic link | Already in stack, no passwords, fast signup |
| Billing | Polar | Already integrated in BundleNudge, MoR, has metering |
| Custom domains | CF for SaaS (Custom Hostnames) | Auto SSL, first 100 free, same CF account |
| Cron scaling | Cloudflare Queues (Phase 6) | Direct cron for <100 tenants, Queues for scale |
| Frontend | Vite + React 19 SPA | Matches existing stack, fast, simple |
| Tenant routing | Subdomain (Host header) | Standard, works with custom domains too |

---

## Revenue Projections

Assuming bottom-up growth (developer tool, self-serve):

| Milestone | Tenants | Mix (F/S/P/B) | MRR | ARR |
|---|---|---|---|---|
| Month 3 | 100 | 70/20/8/2 | $280 | $3,360 |
| Month 6 | 500 | 60/25/12/3 | $1,775 | $21,300 |
| Month 12 | 2,000 | 55/25/15/5 | $8,750 | $105,000 |
| Month 24 | 10,000 | 50/25/18/7 | $53,400 | $640,800 |

Infrastructure cost at 10,000 tenants: ~$3,000/month (CF paid plan + Resend + Twilio). **94% gross margin.**

---

## Competitive Moat

1. **Price** — 4-6x cheaper than every competitor with comparable features
2. **Open source** — BSL 1.1 license, self-host option builds trust and community
3. **Cloudflare-native** — zero-ops, global edge, scale-to-zero, no servers to manage
4. **BundleNudge bundle** — cross-sell to existing OTA update customers (status page included/discounted)
5. **Speed to value** — 2-minute onboarding, magic link auth, instant first check
