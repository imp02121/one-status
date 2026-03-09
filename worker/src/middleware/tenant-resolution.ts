/**
 * Tenant resolution middleware — extracts tenant from Host header.
 *
 * Resolution order:
 * 1. Development: X-Tenant-Slug header
 * 2. Subdomain: {slug}.onestatus.dev → lookup by slug
 * 3. Custom domain: lookup by domain in D1
 *
 * Results are cached in KV for 5 minutes.
 */
import { createMiddleware } from "hono/factory";
import type { Env, Tenant } from "../types";
import { KV_KEYS } from "../types";
import { TABLES, COLUMNS } from "../schema";

const TENANT_CACHE_TTL = 300; // 5 minutes
const BASE_DOMAIN = "onestatus.dev";
const SKIP_PATHS = new Set(["/ping", "/api/ping"]);

interface TenantVariables {
  tenant: Tenant;
}

export const resolveTenant = createMiddleware<{
  Bindings: Env;
  Variables: TenantVariables;
}>(async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (SKIP_PATHS.has(path)) {
    return next();
  }

  // Development mode: allow explicit tenant slug header
  if (c.env.ENVIRONMENT === "development") {
    const slugHeader = c.req.header("X-Tenant-Slug");
    if (slugHeader) {
      const tenant = await resolveBySlug(slugHeader, c.env);
      if (!tenant) {
        return c.json({ error: "Status page not found" }, 404);
      }
      c.set("tenant", tenant);
      return next();
    }
  }

  const host = c.req.header("Host") ?? "";
  const hostname = host.split(":")[0]; // strip port

  // Check if this is a subdomain of the base domain
  if (hostname.endsWith(`.${BASE_DOMAIN}`)) {
    const slug = hostname.slice(0, hostname.length - BASE_DOMAIN.length - 1);
    if (!slug || slug.includes(".")) {
      return c.json({ error: "Status page not found" }, 404);
    }

    const tenant = await resolveBySlug(slug, c.env);
    if (!tenant) {
      return c.json({ error: "Status page not found" }, 404);
    }
    c.set("tenant", tenant);
    return next();
  }

  // Custom domain lookup
  const tenant = await resolveByDomain(hostname, c.env);
  if (!tenant) {
    return c.json({ error: "Status page not found" }, 404);
  }
  c.set("tenant", tenant);
  return next();
});

async function resolveBySlug(slug: string, env: Env): Promise<Tenant | null> {
  const cacheKey = KV_KEYS.tenantLookupBySlug(slug);

  // Check KV cache
  const cached = await env.STATUS_KV.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as Tenant;
  }

  // Query D1
  const col = COLUMNS.tenants;
  const row = await env.STATUS_DB.prepare(
    `SELECT ${col.id}, ${col.name}, ${col.slug}, ${col.plan}, ${col.ownerId},
            ${col.customDomain}, ${col.customDomainStatus},
            ${col.brandingLogoUrl}, ${col.brandingColor}, ${col.brandingShowBadge},
            ${col.createdAt}
     FROM ${TABLES.tenants} WHERE ${col.slug} = ?`,
  )
    .bind(slug)
    .first<Record<string, unknown>>();

  if (!row) return null;

  const tenant = mapRowToTenant(row);

  // Cache in KV
  await env.STATUS_KV.put(cacheKey, JSON.stringify(tenant), {
    expirationTtl: TENANT_CACHE_TTL,
  });

  return tenant;
}

async function resolveByDomain(
  domain: string,
  env: Env,
): Promise<Tenant | null> {
  const cacheKey = KV_KEYS.tenantLookupByDomain(domain);

  // Check KV cache
  const cached = await env.STATUS_KV.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as Tenant;
  }

  // Query D1
  const col = COLUMNS.tenants;
  const row = await env.STATUS_DB.prepare(
    `SELECT ${col.id}, ${col.name}, ${col.slug}, ${col.plan}, ${col.ownerId},
            ${col.customDomain}, ${col.customDomainStatus},
            ${col.brandingLogoUrl}, ${col.brandingColor}, ${col.brandingShowBadge},
            ${col.createdAt}
     FROM ${TABLES.tenants} WHERE ${col.customDomain} = ?`,
  )
    .bind(domain)
    .first<Record<string, unknown>>();

  if (!row) return null;

  const tenant = mapRowToTenant(row);

  // Cache in KV
  await env.STATUS_KV.put(cacheKey, JSON.stringify(tenant), {
    expirationTtl: TENANT_CACHE_TTL,
  });

  return tenant;
}

function mapRowToTenant(row: Record<string, unknown>): Tenant {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    slug: row["slug"] as string,
    plan: row["plan"] as Tenant["plan"],
    ownerId: row["owner_id"] as string,
    customDomain: (row["custom_domain"] as string) ?? null,
    customDomainStatus:
      (row["custom_domain_status"] as Tenant["customDomainStatus"]) ?? "none",
    brandingLogoUrl: (row["branding_logo_url"] as string) ?? null,
    brandingColor: (row["branding_color"] as string) ?? "#3B82F6",
    brandingShowBadge: Boolean(row["branding_show_badge"]),
    createdAt: row["created_at"] as string,
  };
}
