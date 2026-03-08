# Customization

How to rebrand and configure the status page for your own use.

## Logo

The logo appears in two places as a CSS gradient square with "BN" text:

**Header** — `src/components/Header.astro` (line 7-9):
```html
<span class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#4F46E5] to-[#7C3AED]">
  <span class="text-[10px] font-bold leading-none text-white">BN</span>
</span>
<span class="text-[15px] font-semibold tracking-tight text-slate-900">BundleNudge</span>
```

**Footer** — `src/components/Footer.astro` (line 45-52): same structure.

Replace the gradient span with an `<img>` tag or update the initials and colors.

## Colors

Edit `tailwind.config.mjs`:

```js
colors: {
  surface: '#F8FAFC',       // Page background
  accent: {
    start: '#4F46E5',        // Gradient start (indigo-600)
    end: '#7C3AED',          // Gradient end (violet-600)
  },
  cta: '#0F172A',            // CTA button color (slate-900)
},
```

Status colors are defined inline in components:
- **Operational:** green-500/600 (StatusBadge, ServiceRow)
- **Degraded:** yellow-400/500/600
- **Down/Outage:** red-500/600
- **Uptime bar:** indigo-500 (>=99.5%), yellow-400 (>=95%), red-500 (<95%), slate-200 (no data)

## Services

Services must be updated in **two files** — the worker (source of truth) and the frontend (display names for API client).

### 1. Worker — `worker/src/types.ts`

Update `ServiceName` type, `SERVICE_NAMES` array, and `SERVICE_DISPLAY_NAMES` map:

```typescript
export type ServiceName = "api" | "dashboard" | "my-new-service";

export const SERVICE_NAMES: readonly ServiceName[] = [
  "api", "dashboard", "my-new-service",
] as const;

export const SERVICE_DISPLAY_NAMES: Record<ServiceName, string> = {
  "api": "API",
  "dashboard": "Dashboard",
  "my-new-service": "My New Service",
};
```

### 2. Frontend — `src/lib/api.ts`

Update the `SERVICE_DISPLAY_NAMES` map (line 3-11):

```typescript
const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  api: 'API',
  dashboard: 'Dashboard',
  'my-new-service': 'My New Service',
};
```

### 3. Health Check URLs — `worker/src/cron/service-checks.ts`

Add a new check function or modify existing URLs in `runAllChecks()` (line 16-31):

```typescript
const checks = await Promise.all([
  checkApi(checkedAt),
  checkHead("dashboard", "https://app.example.com", checkedAt),
  checkHead("my-new-service", "https://my-service.example.com", checkedAt),
]);
```

Services can be:
- **Direct checks** — `checkHead()` sends a HEAD request to the URL
- **API-derived** — `deriveFromApi()` infers status from the API deep health check

## Footer Links

Edit `src/components/Footer.astro`. The `columns` array (line 2-38) defines all footer link columns:

```typescript
const columns = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: 'https://example.com/features' },
      // ...
    ],
  },
  // ...
];
```

## SLA Text

The SLA commitment text is in `src/pages/index.astro` (line 136-145):

```html
<p class="text-xs text-slate-400">
  We commit to 99.9% uptime.
  <a href="https://bundlenudge.com/sla">View our SLA</a>
</p>
```

## Fonts

Fonts are loaded in `src/layouts/BaseLayout.astro` (line 19-21) via Google Fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

And configured in `tailwind.config.mjs`:

```js
fontFamily: {
  sans: ['Geist', 'system-ui', 'sans-serif'],
  mono: ['Geist Mono', 'monospace'],
},
```

To change fonts: update both the Google Fonts `<link>` and the Tailwind config.

## Status Page URL

Update `STATUS_PAGE_URL` in `worker/wrangler.toml` — this URL is used in email verification links, unsubscribe links, and Slack notification "View Status Page" buttons.

## CORS Origins

Update allowed origins in `worker/src/index.ts` (line 23-27) to include your status page domain:

```typescript
origin: [
  "https://status.yourdomain.com",
  "http://localhost:4321",
],
```
