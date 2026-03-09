/**
 * BundleNudge Status Page Worker
 *
 * Cron-based health checker with API endpoints for the status frontend.
 * Runs every 5 minutes, stores results in KV + D1.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { handleHealthCheck } from "./cron/health-check";
import { statusRoutes } from "./routes/status";
import { uptimeRoutes } from "./routes/uptime";
import { incidentRoutes } from "./routes/incidents";
import { subscribeRoutes } from "./routes/subscribe";
import { unsubscribeRoutes } from "./routes/unsubscribe";
import { adminSubscriberRoutes } from "./routes/admin-subscribers";
import { adminConfigRoutes } from "./routes/admin-config";
import { pingRoutes } from "./routes/ping";
import { rssRoutes } from "./routes/rss";
import { resolveTenant } from "./middleware/tenant-resolution";

const app = new Hono<{ Bindings: Env }>();

// Security response headers
app.use("/api/*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  c.res.headers.set("Referrer-Policy", "no-referrer");
});

// Content-Type validation for POST/PUT requests
app.use("/api/*", async (c, next) => {
  const method = c.req.method;
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    const contentType = c.req.header("Content-Type");
    if (!contentType || !contentType.includes("application/json")) {
      return c.json({ error: "Content-Type must be application/json" }, 415);
    }
  }
  return next();
});

// CORS — allow status page frontend
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      const allowed = [
        "https://status.bundlenudge.com",
        "http://localhost:5173",
        "http://localhost:4321",
        "http://localhost:3000",
      ];
      // Allow *.one-status.pages.dev (Cloudflare Pages preview/prod)
      if (origin.endsWith(".one-status.pages.dev") || origin === "https://one-status.pages.dev") {
        return origin;
      }
      return allowed.includes(origin) ? origin : allowed[0];
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowHeaders: ["Content-Type", "Authorization", "X-Tenant-Slug"],
    maxAge: 86400,
  }),
);

// Tenant resolution — extract tenant from Host/subdomain/header
app.use("/api/*", resolveTenant);

// Mount API routes
app.route("/api", statusRoutes);
app.route("/api", uptimeRoutes);
app.route("/api", incidentRoutes);
app.route("/api", subscribeRoutes);
app.route("/api", unsubscribeRoutes);
app.route("/api", adminSubscriberRoutes);
app.route("/api", adminConfigRoutes);
app.route("/api", pingRoutes);
app.route("/api", rssRoutes);

// Catch-all 404
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err.message);
  return c.json({ error: "Internal server error" }, 500);
});

export { app };

const worker: ExportedHandler<Env> = {
  fetch: app.fetch,

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(handleHealthCheck(env));
  },
};

export default worker;
