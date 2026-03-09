/**
 * RSS feed endpoint (tenant-scoped)
 *
 * GET /rss — Returns an RSS 2.0 XML feed of recent incidents.
 */
import { Hono } from "hono";
import type { Env, Incident, Tenant } from "../types";

export const rssRoutes = new Hono<{
  Bindings: Env;
  Variables: { tenant: Tenant };
}>();

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** GET /rss — RSS 2.0 feed of recent incidents (scoped by tenant) */
rssRoutes.get("/rss", async (c) => {
  const tenant = c.get("tenant");
  const rows = await c.env.STATUS_DB.prepare(
    "SELECT * FROM status_incidents WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50",
  )
    .bind(tenant.id)
    .all<Incident>();

  const pageUrl = c.env.STATUS_PAGE_URL || "https://status.bundlenudge.com";
  const now = new Date().toUTCString();

  const items = rows.results.map((incident) => {
    const pubDate = new Date(incident.createdAt).toUTCString();
    const link = `${pageUrl}/incident/${incident.id}`;
    const severityTag = `[${incident.severity.toUpperCase()}]`;

    return `    <item>
      <title>${escapeXml(`${severityTag} ${incident.title}`)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(incident.description || `Status: ${incident.status}`)}</description>
      <category>${escapeXml(incident.severity)}</category>
    </item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>One Status — Incident Feed</title>
    <link>${escapeXml(pageUrl)}</link>
    <description>Real-time status updates and incident reports.</description>
    <language>en</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${escapeXml(`${pageUrl}/api/rss`)}" rel="self" type="application/rss+xml"/>
${items.join("\n")}
  </channel>
</rss>`;

  return c.body(xml, 200, {
    "Content-Type": "application/rss+xml; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
});
