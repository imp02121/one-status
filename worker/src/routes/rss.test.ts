import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../index";
import { createMockEnv } from "../test-helpers";

describe("RSS feed", () => {
  let env: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    env = createMockEnv();
    vi.clearAllMocks();
  });

  it("returns valid RSS XML with correct content-type", async () => {
    env.STATUS_DB.prepare = vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({
        results: [
          {
            id: 1,
            title: "API Outage",
            description: "API is down",
            severity: "critical",
            status: "investigating",
            affectedServices: '["api"]',
            createdAt: "2026-03-01T12:00:00Z",
            updatedAt: "2026-03-01T12:30:00Z",
            resolvedAt: null,
          },
        ],
      }),
    });

    const res = await app.request("/api/rss", {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/rss+xml");

    const body = await res.text();
    expect(body).toContain('<?xml version="1.0"');
    expect(body).toContain("<rss version=\"2.0\"");
    expect(body).toContain("[CRITICAL] API Outage");
    expect(body).toContain("/incident/1");
    expect(body).toContain("<category>critical</category>");
  });

  it("returns empty feed when no incidents exist", async () => {
    env.STATUS_DB.prepare = vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({ results: [] }),
    });

    const res = await app.request("/api/rss", {}, env);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<channel>");
    expect(body).not.toContain("<item>");
  });

  it("escapes XML special characters", async () => {
    env.STATUS_DB.prepare = vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({
        results: [
          {
            id: 2,
            title: 'Test <script> & "injection"',
            description: "A <b>bold</b> description",
            severity: "minor",
            status: "resolved",
            affectedServices: "[]",
            createdAt: "2026-03-01T10:00:00Z",
            updatedAt: "2026-03-01T11:00:00Z",
            resolvedAt: "2026-03-01T11:00:00Z",
          },
        ],
      }),
    });

    const res = await app.request("/api/rss", {}, env);
    const body = await res.text();

    expect(body).toContain("&lt;script&gt;");
    expect(body).toContain("&amp;");
    expect(body).toContain("&quot;injection&quot;");
    expect(body).not.toContain("<script>");
  });

  it("sets cache-control header", async () => {
    env.STATUS_DB.prepare = vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({ results: [] }),
    });

    const res = await app.request("/api/rss", {}, env);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });
});
