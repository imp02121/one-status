# Admin Dashboard: Status Page Management

## Status Message (Priority: High)

Add a "Status Page" section to the admin dashboard that lets admins set a custom status message displayed on status.bundlenudge.com.

### What it does
- Admins can write a short message (max 500 chars) like "We've identified the issue and are working on a fix"
- Message appears below the "All systems operational" badge on the status page
- Message can be cleared when the situation is resolved

### API Endpoints (already built in status worker)

```
PUT  /api/status/message   { text: "We're investigating increased latency..." }
DELETE /api/status/message  (clears the message)
```

These endpoints need auth protection (TODO in the worker code). Options:
1. Shared secret header (simplest): `Authorization: Bearer STATUS_ADMIN_SECRET`
2. Proxy through main API admin routes (more secure, uses existing admin auth)

### Admin Dashboard Changes

**File:** `packages/admin-dashboard-v2/`

1. Add a "Status Page" nav item in the sidebar
2. Create a StatusMessage page with:
   - Current message display (fetched from status worker)
   - Text input (textarea, 500 char limit, char counter)
   - "Update Message" button → PUT /api/status/message
   - "Clear Message" button → DELETE /api/status/message
   - Timestamp of when message was last updated
3. Optionally: quick-action buttons for common messages:
   - "Investigating increased latency"
   - "Identified the issue, working on a fix"
   - "Fix deployed, monitoring"
   - "Scheduled maintenance in progress"

### Main API Proxy Option (Recommended)

Add to `packages/api/src/routes/admin/`:

```typescript
// admin/status.ts
export const adminStatusRouter = new Hono<{ Bindings: Env }>();

adminStatusRouter.put("/status/message", async (c) => {
  const { text } = await c.req.json();
  // Proxy to status worker
  const res = await fetch("https://status-api.bundlenudge.com/api/status/message", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${c.env.STATUS_ADMIN_SECRET}` },
    body: JSON.stringify({ text }),
  });
  return c.json(await res.json(), res.status);
});

adminStatusRouter.delete("/status/message", async (c) => {
  const res = await fetch("https://status-api.bundlenudge.com/api/status/message", {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${c.env.STATUS_ADMIN_SECRET}` },
  });
  return c.json(await res.json(), res.status);
});
```

Mount behind `authMiddleware` + `requireAdminMiddleware` in admin routes.

### Incident Management (Priority: Medium)

Also add to the admin dashboard:
- Create incident (title, severity, affected services, description)
- Update incident status (investigating → identified → monitoring → resolved)
- View active incidents
- This writes to STATUS_DB's `status_incidents` table

### Environment Variables Needed
- `STATUS_ADMIN_SECRET` — shared secret between admin API and status worker
- Add to both `packages/api/wrangler.toml` and `_prototype-status/worker/wrangler.toml`
