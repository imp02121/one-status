/**
 * Admin subscriber management endpoints
 *
 *   GET    /admin/subscribers        — list all subscribers (paginated)
 *   DELETE /admin/subscribers/:id    — remove a subscriber
 *   POST   /admin/subscribers/notify — send notification to all verified subscribers
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { requireAdmin } from "../middleware/admin-auth";
import { rateLimit } from "../middleware/rate-limit";
import { sendBatchedEmails } from "../lib/notifications";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  verified: z.enum(["true", "false"]).optional(),
});

const notifySchema = z.object({
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(50_000),
});

export const adminSubscriberRoutes = new Hono<{ Bindings: Env }>();

/** GET /admin/subscribers — list subscribers with optional verified filter (admin) */
adminSubscriberRoutes.get("/admin/subscribers", requireAdmin, async (c) => {
  const parsed = listQuerySchema.safeParse({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
    verified: c.req.query("verified"),
  });

  if (!parsed.success) {
    return c.json({ error: "Invalid parameters" }, 400);
  }

  const { page, limit, verified } = parsed.data;
  const offset = (page - 1) * limit;

  const whereClause = verified !== undefined
    ? `WHERE verified = ${verified === "true" ? 1 : 0}`
    : "";

  const [countResult, rows] = await Promise.all([
    c.env.STATUS_DB.prepare(`SELECT COUNT(*) as total FROM status_subscribers ${whereClause}`).first<{ total: number }>(),
    c.env.STATUS_DB.prepare(
      `SELECT id, email, verified, created_at as createdAt FROM status_subscribers ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all<{ id: number; email: string; verified: number; createdAt: string }>(),
  ]);

  const total = countResult?.total ?? 0;

  return c.json({
    subscribers: rows.results.map((s) => ({
      ...s,
      verified: s.verified === 1,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/** GET /admin/subscribers/count — subscriber counts (admin) */
adminSubscriberRoutes.get("/admin/subscribers/count", requireAdmin, async (c) => {
  const result = await c.env.STATUS_DB.prepare(
    "SELECT COUNT(*) as total, SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as verifiedCount, SUM(CASE WHEN verified = 0 THEN 1 ELSE 0 END) as unverifiedCount FROM status_subscribers",
  ).first<{ total: number; verifiedCount: number; unverifiedCount: number }>();

  return c.json({
    total: result?.total ?? 0,
    verified: result?.verifiedCount ?? 0,
    unverified: result?.unverifiedCount ?? 0,
  });
});

/** DELETE /admin/subscribers/:id — remove subscriber (admin) */
adminSubscriberRoutes.delete("/admin/subscribers/:id", requireAdmin, async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) {
    return c.json({ error: "Invalid subscriber ID" }, 400);
  }

  const existing = await c.env.STATUS_DB.prepare("SELECT id FROM status_subscribers WHERE id = ?")
    .bind(id)
    .first<{ id: number }>();

  if (!existing) {
    return c.json({ error: "Subscriber not found" }, 404);
  }

  await c.env.STATUS_DB.prepare("DELETE FROM status_subscribers WHERE id = ?")
    .bind(id)
    .run();

  return c.json({ message: "Subscriber removed" });
});

/** POST /admin/subscribers/notify — send notification to all verified subscribers (admin) */
adminSubscriberRoutes.post(
  "/admin/subscribers/notify",
  requireAdmin,
  rateLimit({ maxRequests: 5, windowSeconds: 3600 }),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = notifySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid parameters", details: parsed.error.flatten().fieldErrors }, 400);
    }

    const { subject, html } = parsed.data;

    const subscribersResult = await c.env.STATUS_DB.prepare(
      "SELECT email FROM status_subscribers WHERE verified = 1",
    ).all<{ email: string }>();

    const emails = subscribersResult.results.map((s) => s.email);
    if (emails.length === 0) {
      return c.json({ message: "No verified subscribers", sent: 0 });
    }

    const sent = await sendBatchedEmails({
      apiKey: c.env.RESEND_API_KEY,
      from: "BundleNudge Status <status@bundlenudge.com>",
      emails,
      subject,
      html,
    });

    return c.json({ message: "Notifications sent", sent });
  },
);
