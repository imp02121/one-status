/**
 * API key authentication middleware — SHA-256 hash lookup with scope checking.
 *
 * Flow:
 * 1. Extract Bearer token from Authorization header
 * 2. SHA-256 hash the token (Web Crypto API)
 * 3. Look up hash in D1 api_keys for the resolved tenant
 * 4. Verify not expired
 * 5. Update last_used_at in background
 * 6. Set scopes on context
 */
import { createMiddleware } from "hono/factory";
import type { Env, Tenant } from "../types";
import { TABLES, COLUMNS } from "../schema";

interface ApiKeyVariables {
  tenant: Tenant;
  apiKeyScopes: string[];
}

export const requireApiKey = createMiddleware<{
  Bindings: Env;
  Variables: ApiKeyVariables;
}>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const tenant = c.get("tenant");
  if (!tenant) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const keyHash = await hashToken(token);

  // Look up API key by hash and tenant
  const col = COLUMNS.apiKeys;
  const row = await c.env.STATUS_DB.prepare(
    `SELECT ${col.id}, ${col.tenantId}, ${col.name}, ${col.keyHash},
            ${col.keyPrefix}, ${col.scopes}, ${col.lastUsedAt},
            ${col.expiresAt}, ${col.createdAt}
     FROM ${TABLES.apiKeys}
     WHERE ${col.keyHash} = ? AND ${col.tenantId} = ?`,
  )
    .bind(keyHash, tenant.id)
    .first<Record<string, unknown>>();

  if (!row) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Constant-time comparison of the hash to prevent timing attacks
  const storedHash = row["key_hash"] as string;
  if (!timingSafeEqual(keyHash, storedHash)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Check expiry
  const expiresAt = row["expires_at"] as string | null;
  if (expiresAt) {
    const expiryDate = new Date(expiresAt);
    if (isNaN(expiryDate.getTime()) || new Date() > expiryDate) {
      return c.json({ error: "API key expired" }, 403);
    }
  }

  // Parse scopes from JSON string
  const rawScopes = row["scopes"] as string;
  let scopes: string[] = [];
  try {
    scopes = JSON.parse(rawScopes) as string[];
  } catch {
    scopes = [];
  }
  c.set("apiKeyScopes", scopes);

  // Update last_used_at in background (don't block response)
  const keyId = row["id"] as string;
  const updatePromise = c.env.STATUS_DB.prepare(
    `UPDATE ${TABLES.apiKeys} SET ${col.lastUsedAt} = ? WHERE ${col.id} = ?`,
  )
    .bind(new Date().toISOString(), keyId)
    .run();

  try {
    c.executionCtx.waitUntil(updatePromise);
  } catch {
    // executionCtx not available in tests — fire and forget
    void updatePromise;
  }

  return next();
});

/**
 * Middleware factory that checks if the authenticated API key has a required scope.
 * Must be used after `requireApiKey`.
 */
export function requireScope(scope: string) {
  return createMiddleware<{
    Bindings: Env;
    Variables: ApiKeyVariables;
  }>(async (c, next) => {
    const scopes = c.get("apiKeyScopes");
    if (!scopes || !scopes.includes(scope)) {
      return c.json(
        { error: "Forbidden", message: `Missing required scope: ${scope}` },
        403,
      );
    }
    return next();
  });
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < aBuf.length; i++) {
    result |= aBuf[i] ^ bBuf[i];
  }
  return result === 0;
}
