# Deployment

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) v4+
- Cloudflare account with Workers, D1, and KV access

## Worker Deployment

### 1. Create Resources

```bash
cd worker

# Create KV namespace
wrangler kv namespace create STATUS_KV
# Output: { binding = "STATUS_KV", id = "abc123..." }

# Create D1 database
wrangler d1 create bundlenudge-status-db
# Output: database_id = "def456..."
```

### 2. Update wrangler.toml

Replace the placeholder IDs:

```toml
[[kv_namespaces]]
binding = "STATUS_KV"
id = "abc123..."          # <-- your KV namespace ID

[[d1_databases]]
binding = "STATUS_DB"
database_name = "bundlenudge-status-db"
database_id = "def456..."  # <-- your D1 database ID
```

### 3. Run Migrations

```bash
wrangler d1 execute bundlenudge-status-db --remote --file=migrations/0001_init.sql
```

### 4. Set Secrets

```bash
wrangler secret put SLACK_WEBHOOK_URL_OPS
# Paste your Slack incoming webhook URL

wrangler secret put RESEND_API_KEY
# Paste your Resend API key
```

### 5. Deploy

```bash
npm run deploy
# or: wrangler deploy
```

The worker will start running cron health checks every 5 minutes automatically.

### 6. Verify

```bash
# Check the API is responding
curl https://your-worker.your-subdomain.workers.dev/api/status

# Check cron logs in Cloudflare dashboard:
# Workers & Pages > bundlenudge-status > Logs > Cron
```

## Frontend Deployment

The Astro frontend can be deployed to Cloudflare Pages or any static host.

### Cloudflare Pages

#### Option A: Direct Upload

```bash
# Build the site
npm run build

# Deploy to Pages
wrangler pages deploy dist/ --project-name=bundlenudge-status
```

#### Option B: Git Integration

1. Connect your repository in Cloudflare Pages dashboard
2. Set build configuration:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Environment variable:** `PUBLIC_STATUS_API_URL` = `https://status-api.bundlenudge.com`

### Environment Variables

Set `PUBLIC_STATUS_API_URL` to point to your deployed worker:

```bash
# At build time (Astro uses it during SSG)
PUBLIC_STATUS_API_URL=https://status-api.bundlenudge.com npm run build
```

### Custom Domain

1. In Cloudflare Pages, go to your project > Custom domains
2. Add `status.bundlenudge.com` (or your domain)
3. DNS will be configured automatically if using Cloudflare DNS

## Production Checklist

- [ ] KV namespace created and ID in wrangler.toml
- [ ] D1 database created and ID in wrangler.toml
- [ ] Migration `0001_init.sql` applied to remote D1
- [ ] `SLACK_WEBHOOK_URL_OPS` secret set
- [ ] `RESEND_API_KEY` secret set
- [ ] Worker deployed and cron running (check logs)
- [ ] Frontend built with correct `PUBLIC_STATUS_API_URL`
- [ ] Frontend deployed to Pages
- [ ] Custom domain configured
- [ ] CORS origins in `worker/src/index.ts` updated to include your domain
