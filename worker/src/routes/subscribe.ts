/**
 * POST /api/subscribe — subscribe to status notifications
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { fetchWithTimeout } from "../lib/fetch-timeout";
import { escapeHtml } from "../lib/html";
import { rateLimit } from "../middleware/rate-limit";

const subscribeSchema = z.object({
  email: z.string().email().max(320),
});

export const subscribeRoutes = new Hono<{ Bindings: Env }>();

subscribeRoutes.post(
  "/subscribe",
  rateLimit({ maxRequests: 3, windowSeconds: 3600 }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid email" }, 400);
    }

    const { email } = parsed.data;

    // Check if already subscribed
    const existing = await c.env.STATUS_DB.prepare(
      "SELECT id, verified FROM status_subscribers WHERE email = ?",
    )
      .bind(email)
      .first<{ id: number; verified: number }>();

    if (existing?.verified) {
      return c.json({ message: "Already subscribed" });
    }

    const verifyToken = crypto.randomUUID();
    const unsubscribeToken = crypto.randomUUID();

    if (existing) {
      // Re-send verification for unverified
      await c.env.STATUS_DB.prepare(
        "UPDATE status_subscribers SET verify_token = ?, unsubscribe_token = ? WHERE id = ?",
      )
        .bind(verifyToken, unsubscribeToken, existing.id)
        .run();
    } else {
      await c.env.STATUS_DB.prepare(
        "INSERT INTO status_subscribers (email, verify_token, unsubscribe_token) VALUES (?, ?, ?)",
      )
        .bind(email, verifyToken, unsubscribeToken)
        .run();
    }

    // Send verification email
    await sendVerificationEmail(c.env, email, verifyToken);

    return c.json({ message: "Subscription received. Check your email to verify." });
  },
);

/** GET /api/verify — verify email subscription */
subscribeRoutes.get(
  "/verify",
  rateLimit({ maxRequests: 10, windowSeconds: 3600 }),
  async (c) => {
    const token = c.req.query("token");
    if (!token) {
      return c.json({ error: "Missing verification token" }, 400);
    }

    const subscriber = await c.env.STATUS_DB.prepare(
      "SELECT id FROM status_subscribers WHERE verify_token = ?",
    )
      .bind(token)
      .first<{ id: number }>();

    if (!subscriber) {
      return c.json({ error: "Invalid or expired verification token" }, 404);
    }

    await c.env.STATUS_DB.prepare(
      "UPDATE status_subscribers SET verified = 1 WHERE id = ?",
    )
      .bind(subscriber.id)
      .run();

    return c.html(verifiedHtml());
  },
);

async function sendVerificationEmail(
  env: Env,
  email: string,
  verifyToken: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const verifyUrl = `${env.STATUS_PAGE_URL}/api/verify?token=${verifyToken}`;

  try {
    await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "BundleNudge Status <status@bundlenudge.com>",
        to: [email],
        subject: "Verify your BundleNudge status subscription",
        html: verificationEmailHtml(verifyUrl),
      }),
      timeoutMs: 10_000,
    });
  } catch (err: unknown) {
    console.error("Failed to send verification email:", err);
  }
}

function verificationEmailHtml(verifyUrl: string): string {
  const safeUrl = escapeHtml(verifyUrl);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">
    <h1 style="font-size:20px;margin:0 0 16px">BundleNudge Status</h1>
    <p>Confirm your subscription to receive status notifications.</p>
    <p style="margin:24px 0">
      <a href="${safeUrl}" style="background:#3b82f6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Verify Subscription</a>
    </p>
    <p style="color:#888;font-size:14px">If you did not request this, you can safely ignore this email.</p>
  </div>
</body>
</html>`;
}

function verifiedHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verified — BundleNudge Status</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa; }
    .card { text-align: center; padding: 2rem; border: 1px solid #333; border-radius: 12px; max-width: 400px; }
    .status { color: #22c55e; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>BundleNudge Status</h1>
    <p class="status">Your subscription has been verified.</p>
    <p>You will now receive email notifications when service status changes.</p>
    <p><a href="https://status.bundlenudge.com" style="color: #60a5fa;">Back to status page</a></p>
  </div>
</body>
</html>`;
}
