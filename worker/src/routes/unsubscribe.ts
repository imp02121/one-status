/**
 * GET /api/unsubscribe — unsubscribe from status notifications
 */
import { Hono } from "hono";
import type { Env } from "../types";
import { escapeHtml } from "../lib/html";
import { rateLimit } from "../middleware/rate-limit";

export const unsubscribeRoutes = new Hono<{ Bindings: Env }>();

unsubscribeRoutes.get(
  "/unsubscribe",
  rateLimit({ maxRequests: 10, windowSeconds: 3600 }),
  async (c) => {
    const token = c.req.query("token");
    if (!token) {
      return c.html(unsubscribeHtml("Missing unsubscribe token.", false), 400);
    }

    const subscriber = await c.env.STATUS_DB.prepare(
      "SELECT id, email FROM status_subscribers WHERE unsubscribe_token = ?",
    )
      .bind(token)
      .first<{ id: number; email: string }>();

    if (!subscriber) {
      return c.html(unsubscribeHtml("Invalid or expired unsubscribe link.", false), 404);
    }

    await c.env.STATUS_DB.prepare("DELETE FROM status_subscribers WHERE id = ?")
      .bind(subscriber.id)
      .run();

    return c.html(unsubscribeHtml("You have been unsubscribed from BundleNudge status notifications.", true));
  },
);

function unsubscribeHtml(message: string, success: boolean): string {
  const color = success ? "#22c55e" : "#ef4444";
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribe — BundleNudge Status</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa; }
    .card { text-align: center; padding: 2rem; border: 1px solid #333; border-radius: 12px; max-width: 400px; }
    .status { color: ${color}; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>BundleNudge Status</h1>
    <p class="status">${safeMessage}</p>
    <p><a href="https://status.bundlenudge.com" style="color: #60a5fa;">Back to status page</a></p>
  </div>
</body>
</html>`;
}
