import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendSlackNotification, sendSlackIncidentNotification } from "./slack";
import type { StatusChange, ServiceName } from "../types";

describe("sendSlackNotification", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("sends POST to webhook URL with correct Content-Type", async () => {
    const changes: StatusChange[] = [
      {
        service: "api",
        previousStatus: "operational",
        newStatus: "down",
        changedAt: "2026-03-08T12:00:00.000Z",
      },
    ];

    await sendSlackNotification(
      "https://hooks.slack.com/test",
      changes,
      "https://status.bundlenudge.com",
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/test",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("sends Block Kit payload with header, section, and context blocks", async () => {
    const changes: StatusChange[] = [
      {
        service: "api",
        previousStatus: "operational",
        newStatus: "down",
        changedAt: "2026-03-08T12:00:00.000Z",
      },
    ];

    await sendSlackNotification(
      "https://hooks.slack.com/test",
      changes,
      "https://status.bundlenudge.com",
    );

    const body = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]?.body as string,
    );
    const types = body.blocks.map((b: { type: string }) => b.type);
    expect(types).toContain("header");
    expect(types).toContain("section");
    expect(types).toContain("context");
  });

  it("includes service display name and status transition in payload", async () => {
    const changes: StatusChange[] = [
      {
        service: "dashboard",
        previousStatus: "operational",
        newStatus: "degraded",
        changedAt: "2026-03-08T12:00:00.000Z",
      },
    ];

    await sendSlackNotification(
      "https://hooks.slack.com/test",
      changes,
      "https://status.bundlenudge.com",
    );

    const body = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]?.body as string,
    );
    const payload = JSON.stringify(body);
    expect(payload).toContain("Dashboard");
    expect(payload).toContain("operational");
    expect(payload).toContain("degraded");
  });

  it("includes error in payload when present", async () => {
    const changes: StatusChange[] = [
      {
        service: "api",
        previousStatus: "operational",
        newStatus: "down",
        changedAt: "2026-03-08T12:00:00.000Z",
        error: "HTTP 503",
      },
    ];

    await sendSlackNotification(
      "https://hooks.slack.com/test",
      changes,
      "https://status.bundlenudge.com",
    );

    const body = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]?.body as string,
    );
    const payload = JSON.stringify(body);
    expect(payload).toContain("HTTP 503");
  });

  it("sends one request per change", async () => {
    const changes: StatusChange[] = [
      {
        service: "api",
        previousStatus: "operational",
        newStatus: "down",
        changedAt: "2026-03-08T12:00:00.000Z",
      },
      {
        service: "documentation",
        previousStatus: "operational",
        newStatus: "degraded",
        changedAt: "2026-03-08T12:00:00.000Z",
      },
    ];

    await sendSlackNotification(
      "https://hooks.slack.com/test",
      changes,
      "https://status.bundlenudge.com",
    );

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("logs error on non-200 response but does not throw", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("error", { status: 500 }),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const changes: StatusChange[] = [
      {
        service: "api",
        previousStatus: "operational",
        newStatus: "down",
        changedAt: "2026-03-08T12:00:00.000Z",
      },
    ];

    await sendSlackNotification(
      "https://hooks.slack.com/test",
      changes,
      "https://status.bundlenudge.com",
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Slack notification failed"),
    );
    consoleSpy.mockRestore();
  });

  it("skips send when webhook URL is empty", async () => {
    const changes: StatusChange[] = [
      {
        service: "api",
        previousStatus: "operational",
        newStatus: "down",
        changedAt: "2026-03-08T12:00:00.000Z",
      },
    ];

    await sendSlackNotification("", changes, "https://status.bundlenudge.com");

    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips send when changes array is empty", async () => {
    await sendSlackNotification(
      "https://hooks.slack.com/test",
      [],
      "https://status.bundlenudge.com",
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  it("includes status page link in context block", async () => {
    const changes: StatusChange[] = [
      {
        service: "api",
        previousStatus: "operational",
        newStatus: "down",
        changedAt: "2026-03-08T12:00:00.000Z",
      },
    ];

    await sendSlackNotification(
      "https://hooks.slack.com/test",
      changes,
      "https://status.bundlenudge.com",
    );

    const body = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]?.body as string,
    );
    const payload = JSON.stringify(body);
    expect(payload).toContain("https://status.bundlenudge.com");
    expect(payload).toContain("View Status Page");
  });
});

describe("sendSlackIncidentNotification", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("sends incident notification with title and severity", async () => {
    await sendSlackIncidentNotification(
      "https://hooks.slack.com/test",
      "Database outage",
      "D1 is unreachable",
      "critical",
      ["api", "edge-delivery"] as ServiceName[],
      "https://status.bundlenudge.com",
    );

    const body = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]?.body as string,
    );
    const payload = JSON.stringify(body);
    expect(payload).toContain("Database outage");
    expect(payload).toContain("critical");
    expect(payload).toContain("API");
    expect(payload).toContain("Edge Delivery");
  });

  it("skips send when webhook URL is empty", async () => {
    await sendSlackIncidentNotification(
      "",
      "Test",
      "desc",
      "minor",
      ["api"] as ServiceName[],
      "https://status.bundlenudge.com",
    );

    expect(fetch).not.toHaveBeenCalled();
  });
});
