# API Reference

Base URL: `https://status-api.example.com` (production) or `http://localhost:8787` (dev)

All endpoints are prefixed with `/api`.

## Authentication

Admin endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <ADMIN_API_KEY>
```

Set `ADMIN_API_KEY` as a Cloudflare Worker secret. Optionally set `ADMIN_TOKEN_EXPIRES_AT` (ISO 8601) for token expiry.

---

## Public Endpoints

### GET /api/status

Current status of all services.

**Response:**

```json
{
  "status": "operational",
  "services": {
    "api": "operational",
    "dashboard": "degraded"
  },
  "updatedAt": "2026-03-08T12:00:00.000Z",
  "message": {
    "text": "Scheduled maintenance tomorrow at 06:00 UTC",
    "updatedAt": "2026-03-08T10:00:00.000Z"
  }
}
```

`message` is `null` when no custom status message is set.

---

### PUT /api/status/message

Set a custom status message. **Auth required.**

**Body:**

```json
{ "text": "Scheduled maintenance: March 10, 06:00-08:00 UTC" }
```

- `text` — required, max 500 characters

**Response:** `{ "success": true }`

**Status codes:** 200, 400, 401

---

### DELETE /api/status/message

Clear the custom status message. **Auth required.**

**Response:** `{ "success": true }`

---

### GET /api/uptime

Daily uptime percentages for a service.

| Param | Type | Required | Default | Description |
| ----- | ---- | -------- | ------- | ----------- |
| `service` | string | Yes | — | Service slug |
| `days` | number | No | 90 | Days of history (1-90) |

**Response:**

```json
{
  "service": "api",
  "days": 90,
  "entries": [
    {
      "date": "2026-03-08",
      "uptime": {
        "totalChecks": 288,
        "operationalChecks": 286,
        "degradedChecks": 2,
        "downChecks": 0,
        "uptimePercent": 100
      }
    },
    { "date": "2026-03-07", "uptime": null }
  ]
}
```

---

### GET /api/incidents

Paginated incident list.

| Param | Type | Required | Default | Description |
| ----- | ---- | -------- | ------- | ----------- |
| `page` | number | No | 1 | Page number |
| `limit` | number | No | 20 | Items per page (1-100) |

**Response:**

```json
{
  "incidents": [
    {
      "id": 1,
      "title": "API elevated error rates",
      "description": "Investigating increased 500 responses",
      "status": "resolved",
      "severity": "major",
      "affected_services": "[\"api\",\"ota-updates\"]",
      "created_at": "2026-03-07T14:30:00",
      "updated_at": "2026-03-07T15:45:00",
      "resolved_at": "2026-03-07T15:45:00"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

---

### GET /api/incidents/:id

Single incident with update timeline.

**Response:**

```json
{
  "incident": {
    "id": 1,
    "title": "API elevated error rates",
    "description": "...",
    "severity": "major",
    "status": "resolved",
    "affected_services": "[\"api\"]",
    "created_at": "2026-03-07T14:30:00",
    "updated_at": "2026-03-07T15:45:00",
    "resolved_at": "2026-03-07T15:45:00"
  },
  "updates": [
    {
      "id": 1,
      "incident_id": 1,
      "message": "Investigating elevated error rates on API",
      "status": "investigating",
      "created_at": "2026-03-07T14:30:00"
    },
    {
      "id": 2,
      "incident_id": 1,
      "message": "Root cause identified — bad deploy",
      "status": "identified",
      "created_at": "2026-03-07T14:45:00"
    }
  ]
}
```

**Status codes:** 200, 400, 404

---

### POST /api/subscribe

Subscribe to status notifications.

**Body:**

```json
{ "email": "user@example.com" }
```

**Response:** `{ "message": "Subscription received. Check your email to verify." }`

**Status codes:** 200, 400 (invalid email), 429 (rate limited)

---

### GET /api/verify

Verify email subscription (linked from verification email).

| Param | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `token` | string | Yes | Verification token (UUID) |

**Response:** HTML confirmation page.

**Status codes:** 200, 400, 404, 410 (expired token)

---

### GET /api/unsubscribe

Unsubscribe from notifications (linked from emails).

| Param | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `token` | string | Yes | Unsubscribe token (UUID) |

**Response:** HTML confirmation page.

---

### GET /api/ping

Simple health check.

**Response:**

```json
{ "ok": true, "timestamp": "2026-03-08T12:00:00.000Z" }
```

---

## Admin Endpoints

All admin endpoints require `Authorization: Bearer <ADMIN_API_KEY>`.

### POST /api/incidents

Create a new incident. Sends Slack + email notifications based on config.

**Body:**

```json
{
  "title": "API elevated error rates",
  "description": "Investigating increased 500 responses",
  "severity": "major",
  "status": "investigating",
  "affectedServices": ["api", "ota-updates"]
}
```

| Field | Type | Required | Default | Validation |
| ----- | ---- | -------- | ------- | ---------- |
| `title` | string | Yes | — | 1-200 chars |
| `description` | string | No | `""` | max 2000 chars |
| `severity` | string | Yes | — | `critical`, `major`, `minor`, `maintenance` |
| `status` | string | No | `investigating` | `investigating`, `identified`, `monitoring`, `resolved` |
| `affectedServices` | string[] | No | `[]` | max 20 items |

**Response:** `{ "id": 1, "message": "Incident created" }` (201)

---

### PUT/PATCH /api/incidents/:id

Update an incident. Auto-sets `resolved_at` when status transitions to `resolved`.

**Body:** Same fields as POST, all optional.

**Response:** `{ "message": "Incident updated" }`

**Status codes:** 200, 400, 401, 404

---

### DELETE /api/incidents/:id

Delete an incident and all its updates.

**Response:** `{ "message": "Incident deleted" }`

**Status codes:** 200, 400, 401, 404

---

### POST /api/incidents/:id/updates

Add a timeline update to an incident. Also updates the incident's status.

**Body:**

```json
{
  "message": "Root cause identified — rolling back deploy",
  "status": "identified"
}
```

**Response:** `{ "id": 1, "message": "Update added" }` (201)

---

### GET /api/admin/subscribers

List subscribers with pagination and optional verified filter.

| Param | Type | Required | Default | Description |
| ----- | ---- | -------- | ------- | ----------- |
| `page` | number | No | 1 | Page number |
| `limit` | number | No | 50 | Items per page (1-100) |
| `verified` | string | No | — | `true` or `false` |

**Response:**

```json
{
  "subscribers": [
    { "id": 1, "email": "user@example.com", "verified": true, "createdAt": "2026-03-07T14:30:00" }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1, "totalPages": 1 }
}
```

---

### GET /api/admin/subscribers/count

Subscriber count breakdown.

**Response:**

```json
{ "total": 150, "verified": 120, "unverified": 30 }
```

---

### DELETE /api/admin/subscribers/:id

Remove a subscriber.

**Response:** `{ "message": "Subscriber removed" }`

**Status codes:** 200, 400, 401, 404

---

### POST /api/admin/subscribers/notify

Send a custom notification to all verified subscribers. Rate limited to 5 per hour.

**Body:**

```json
{
  "subject": "Scheduled Maintenance Notice",
  "html": "<p>We will be performing maintenance on March 10...</p>"
}
```

**Response:** `{ "message": "Notifications sent", "sent": 120 }`

---

### GET /api/admin/config

Get current status page configuration from KV.

**Response:**

```json
{ "config": { ... } }
```

Returns `{ "config": null }` if no config is set (uses defaults).

---

### PUT /api/admin/config

Update status page configuration. Zod validated.

**Body:**

```json
{
  "services": [
    { "slug": "api", "name": "API", "url": "https://api.example.com/health", "checkType": "deep-health" },
    { "slug": "web", "name": "Web App", "url": "https://app.example.com", "checkType": "head" }
  ],
  "emailFrom": "status@example.com",
  "emailFromName": "Status Page",
  "notifications": {
    "slack": {
      "enabled": true,
      "webhookUrl": "https://hooks.slack.com/services/...",
      "channel": "#incidents",
      "severityFilter": ["critical", "major"],
      "escalation": [
        { "afterMinutes": 15, "webhookUrl": "https://hooks.slack.com/services/...", "mention": "@oncall" },
        { "afterMinutes": 60, "webhookUrl": "https://hooks.slack.com/services/...", "mention": "@channel" }
      ]
    },
    "email": {
      "enabled": true,
      "onStatusChange": true,
      "onIncident": true
    }
  }
}
```

| Field | Validation |
| ----- | ---------- |
| `services` | Array, max 50. Each: slug (1-50), name (1-100), url (valid URL), checkType (`head`/`deep-health`) |
| `emailFrom` | Valid email, max 320 chars |
| `emailFromName` | 1-100 chars |
| `notifications.slack.severityFilter` | Array of `critical`, `major`, `minor`, `maintenance` |
| `notifications.slack.escalation` | Array, max 10. afterMinutes (1-1440), valid webhookUrl |

**Response:** `{ "message": "Configuration updated" }`

**Status codes:** 200, 400, 401

---

## Valid Service Slugs (defaults)

| Slug | Display Name |
| ---- | ------------ |
| `api` | API |
| `dashboard` | Dashboard |
| `authentication` | Authentication |
| `edge-delivery` | Edge Delivery |
| `ota-updates` | OTA Updates |
| `build-service` | Build Service |
| `documentation` | Documentation |

Service slugs are configurable via the admin config endpoint.
