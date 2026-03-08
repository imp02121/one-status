# @bundlenudge/status-sdk

TypeScript client for the BundleNudge Status Page API. Zero runtime dependencies.

## Installation

```bash
npm install @bundlenudge/status-sdk
```

## Quick Start

### Public API (no auth required)

```typescript
import { StatusPageClient } from "@bundlenudge/status-sdk";

const client = new StatusPageClient({
  baseUrl: "https://status-api.bundlenudge.com",
});

// Get current status of all services
const status = await client.getStatus();
console.log(status.status); // "operational" | "degraded" | "down" | "unknown"

// Get uptime history for a service (last 90 days by default)
const uptime = await client.getUptime("api");
const uptime7d = await client.getUptime("api", 7);

// List recent incidents
const { incidents, pagination } = await client.getIncidents({ page: 1, limit: 10 });

// Get a specific incident with its updates
const { incident, updates } = await client.getIncident(1);

// Subscribe to status notifications
await client.subscribe("user@example.com");
```

### Admin API (requires admin token)

```typescript
import { StatusPageClient } from "@bundlenudge/status-sdk";

const admin = new StatusPageClient({
  baseUrl: "https://status-api.bundlenudge.com",
  adminToken: process.env.STATUS_ADMIN_TOKEN,
});

// Create an incident
const { id } = await admin.createIncident({
  title: "API Degraded Performance",
  description: "Increased latency on API endpoints",
  severity: "major",
  status: "investigating",
  affectedServices: ["api", "dashboard"],
});

// Add an update
await admin.addIncidentUpdate(id, {
  message: "Root cause identified — database connection pool exhausted",
  status: "identified",
});

// Resolve the incident
await admin.updateIncident(id, { status: "resolved" });

// Delete an incident
await admin.deleteIncident(id);

// Manage subscribers
const { subscribers } = await admin.listSubscribers({ verified: true });
const counts = await admin.getSubscriberCount();
await admin.removeSubscriber(subscriberId);

// Send notification to all verified subscribers
await admin.notifySubscribers({
  subject: "Scheduled Maintenance",
  html: "<p>We will be performing maintenance on 2026-03-15.</p>",
});

// Manage config
const { config } = await admin.getConfig();
await admin.updateConfig({
  services: [
    { slug: "api", name: "API", url: "https://api.bundlenudge.com", checkType: "deep-health" },
  ],
  emailFrom: "status@bundlenudge.com",
  emailFromName: "BundleNudge Status",
  notifications: {
    slack: {
      enabled: true,
      webhookUrl: "https://hooks.slack.com/...",
      channel: "#ops",
      severityFilter: ["critical", "major"],
      escalation: [],
    },
    email: { enabled: true, onStatusChange: true, onIncident: true },
  },
});
```

## Error Handling

The SDK throws typed errors you can catch:

```typescript
import {
  StatusPageError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
} from "@bundlenudge/status-sdk";

try {
  await client.getIncident(999);
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log("Incident not found");
  } else if (error instanceof AuthenticationError) {
    console.log("Invalid or missing admin token");
  } else if (error instanceof ValidationError) {
    console.log("Validation failed:", error.details);
  } else if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter}s`);
  } else if (error instanceof StatusPageError) {
    console.log(`API error ${error.status}: ${error.message}`);
  }
}
```

Admin methods called without an `adminToken` throw `AuthenticationError` immediately without making a network request.

## API Reference

### Constructor

```typescript
new StatusPageClient(options: {
  baseUrl: string;        // API base URL (required)
  adminToken?: string;    // Admin API token (optional)
  timeout?: number;       // Request timeout in ms (default: 30000)
})
```

### Public Methods

| Method | Description |
|--------|-------------|
| `getStatus()` | Current status of all services |
| `getUptime(service, days?)` | Daily uptime entries for a service |
| `getIncidents(options?)` | Paginated incident list |
| `getIncident(id)` | Single incident with updates |
| `subscribe(email)` | Subscribe to status notifications |

### Admin Methods

| Method | Description |
|--------|-------------|
| `createIncident(data)` | Create a new incident |
| `updateIncident(id, data)` | Update an existing incident |
| `deleteIncident(id)` | Delete an incident |
| `addIncidentUpdate(id, data)` | Add an update to an incident |
| `listSubscribers(options?)` | List subscribers (paginated) |
| `removeSubscriber(id)` | Remove a subscriber |
| `getSubscriberCount()` | Get subscriber counts |
| `notifySubscribers(data)` | Email all verified subscribers |
| `getConfig()` | Get status page configuration |
| `updateConfig(config)` | Update status page configuration |

## Types

All request/response types are exported:

```typescript
import type {
  StatusResponse,
  Incident,
  IncidentUpdate,
  CreateIncidentInput,
  UpdateIncidentInput,
  Subscriber,
  StatusPageConfig,
  ServiceStatus,
  IncidentSeverity,
  IncidentStatus,
} from "@bundlenudge/status-sdk";
```

## License

BSL-1.1
