/**
 * Incident CRUD endpoints
 *
 * Public:
 *   GET  /incidents          — paginated incident list
 *   GET  /incidents/:id      — single incident with updates
 *
 * Admin:
 *   POST   /incidents            — create incident
 *   PUT    /incidents/:id        — update incident
 *   DELETE /incidents/:id        — delete incident
 *   POST   /incidents/:id/updates — add incident update
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Incident, IncidentUpdate, ServiceName } from "../types";
import { requireAdmin } from "../middleware/admin-auth";
import { sendSlackIncidentNotification } from "../lib/slack";
import { notifyIncidentViaConfig } from "../lib/notifications";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const SEVERITY_VALUES = ["critical", "major", "minor", "maintenance"] as const;
const STATUS_VALUES = ["investigating", "identified", "monitoring", "resolved"] as const;

const createIncidentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  severity: z.enum(SEVERITY_VALUES),
  status: z.enum(STATUS_VALUES).default("investigating"),
  affectedServices: z.array(z.string().min(1).max(50)).max(20).default([]),
});

const updateIncidentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  status: z.enum(STATUS_VALUES).optional(),
  affectedServices: z.array(z.string().min(1).max(50)).max(20).optional(),
});

const incidentUpdateSchema = z.object({
  message: z.string().min(1).max(2000),
  status: z.enum(STATUS_VALUES),
});

export const incidentRoutes = new Hono<{ Bindings: Env }>();

/** GET /incidents — paginated incident list */
incidentRoutes.get("/incidents", async (c) => {
  const parsed = listQuerySchema.safeParse({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
  });

  if (!parsed.success) {
    return c.json({ error: "Invalid parameters" }, 400);
  }

  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const [countResult, rows] = await Promise.all([
    c.env.STATUS_DB.prepare("SELECT COUNT(*) as total FROM status_incidents").first<{ total: number }>(),
    c.env.STATUS_DB.prepare(
      "SELECT * FROM status_incidents ORDER BY created_at DESC LIMIT ? OFFSET ?",
    )
      .bind(limit, offset)
      .all<Incident>(),
  ]);

  const total = countResult?.total ?? 0;

  return c.json({
    incidents: rows.results,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/** GET /incidents/:id — single incident with updates */
incidentRoutes.get("/incidents/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) {
    return c.json({ error: "Invalid incident ID" }, 400);
  }

  const [incident, updates] = await Promise.all([
    c.env.STATUS_DB.prepare("SELECT * FROM status_incidents WHERE id = ?")
      .bind(id)
      .first<Incident>(),
    c.env.STATUS_DB.prepare(
      "SELECT * FROM status_incident_updates WHERE incident_id = ? ORDER BY created_at ASC",
    )
      .bind(id)
      .all<IncidentUpdate>(),
  ]);

  if (!incident) {
    return c.json({ error: "Incident not found" }, 404);
  }

  return c.json({ incident, updates: updates.results });
});

/** POST /incidents — create incident (admin) */
incidentRoutes.post("/incidents", requireAdmin, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = createIncidentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid parameters", details: parsed.error.flatten().fieldErrors }, 400);
  }

  const { title, description, severity, status, affectedServices } = parsed.data;
  const now = new Date().toISOString();
  const resolvedAt = status === "resolved" ? now : null;

  const result = await c.env.STATUS_DB.prepare(
    `INSERT INTO status_incidents (title, description, severity, status, affected_services, created_at, updated_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(title, description, severity, status, JSON.stringify(affectedServices), now, now, resolvedAt)
    .run();

  const incidentId = result.meta.last_row_id;

  // Send notifications in the background
  const pageUrl = c.env.STATUS_PAGE_URL;

  // Notify via config-based notifications (Slack + email)
  try {
    await notifyIncidentViaConfig(c.env, {
      title,
      description,
      severity,
      affectedServices,
      pageUrl,
    });
  } catch (err: unknown) {
    console.error("Config-based incident notification failed:", err);
  }

  // Fallback: also send via hardcoded Slack webhook if configured
  try {
    await sendSlackIncidentNotification(
      c.env.SLACK_WEBHOOK_URL_OPS,
      title,
      description,
      severity,
      affectedServices as ServiceName[],
      pageUrl,
    );
  } catch (err: unknown) {
    console.error("Slack incident notification failed:", err);
  }

  return c.json({ id: incidentId, message: "Incident created" }, 201);
});

/** PUT|PATCH /incidents/:id — update incident (admin) */
incidentRoutes.on(["PUT", "PATCH"], "/incidents/:id", requireAdmin, async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) {
    return c.json({ error: "Invalid incident ID" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = updateIncidentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid parameters", details: parsed.error.flatten().fieldErrors }, 400);
  }

  const existing = await c.env.STATUS_DB.prepare("SELECT * FROM status_incidents WHERE id = ?")
    .bind(id)
    .first<Incident>();

  if (!existing) {
    return c.json({ error: "Incident not found" }, 404);
  }

  const data = parsed.data;
  const now = new Date().toISOString();
  const newStatus = data.status ?? existing.status;
  const resolvedAt = newStatus === "resolved" && existing.status !== "resolved" ? now : existing.resolvedAt;

  await c.env.STATUS_DB.prepare(
    `UPDATE status_incidents
     SET title = ?, description = ?, severity = ?, status = ?,
         affected_services = ?, updated_at = ?, resolved_at = ?
     WHERE id = ?`,
  )
    .bind(
      data.title ?? existing.title,
      data.description ?? existing.description,
      data.severity ?? existing.severity,
      newStatus,
      data.affectedServices ? JSON.stringify(data.affectedServices) : existing.affectedServices,
      now,
      resolvedAt,
      id,
    )
    .run();

  return c.json({ message: "Incident updated" });
});

/** DELETE /incidents/:id — delete incident (admin) */
incidentRoutes.delete("/incidents/:id", requireAdmin, async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) {
    return c.json({ error: "Invalid incident ID" }, 400);
  }

  const existing = await c.env.STATUS_DB.prepare("SELECT id FROM status_incidents WHERE id = ?")
    .bind(id)
    .first<{ id: number }>();

  if (!existing) {
    return c.json({ error: "Incident not found" }, 404);
  }

  // Delete updates first, then incident
  await c.env.STATUS_DB.prepare("DELETE FROM status_incident_updates WHERE incident_id = ?")
    .bind(id)
    .run();
  await c.env.STATUS_DB.prepare("DELETE FROM status_incidents WHERE id = ?")
    .bind(id)
    .run();

  return c.json({ message: "Incident deleted" });
});

/** POST /incidents/:id/updates — add incident update (admin) */
incidentRoutes.post("/incidents/:id/updates", requireAdmin, async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) {
    return c.json({ error: "Invalid incident ID" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = incidentUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid parameters", details: parsed.error.flatten().fieldErrors }, 400);
  }

  const existing = await c.env.STATUS_DB.prepare("SELECT id, status FROM status_incidents WHERE id = ?")
    .bind(id)
    .first<{ id: number; status: string }>();

  if (!existing) {
    return c.json({ error: "Incident not found" }, 404);
  }

  const { message, status } = parsed.data;
  const now = new Date().toISOString();

  // Insert the update
  const result = await c.env.STATUS_DB.prepare(
    "INSERT INTO status_incident_updates (incident_id, message, status, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, message, status, now)
    .run();

  // Update the incident status and resolved_at if status changed
  const resolvedAt = status === "resolved" && existing.status !== "resolved" ? now : null;
  if (resolvedAt) {
    await c.env.STATUS_DB.prepare(
      "UPDATE status_incidents SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?",
    )
      .bind(status, now, resolvedAt, id)
      .run();
  } else {
    await c.env.STATUS_DB.prepare(
      "UPDATE status_incidents SET status = ?, updated_at = ? WHERE id = ?",
    )
      .bind(status, now, id)
      .run();
  }

  return c.json({ id: result.meta.last_row_id, message: "Update added" }, 201);
});
