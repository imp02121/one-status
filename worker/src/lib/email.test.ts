import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendStatusChangeEmails, sendIncidentEmails } from "./email";
import type { StatusChange, ServiceName } from "../types";

describe("sendStatusChangeEmails", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: "email-123" }), { status: 200 }));
  });

  const subscribers = [
    { email: "user1@example.com", unsubscribeToken: "token-1" },
    { email: "user2@example.com", unsubscribeToken: "token-2" },
  ];

  const changes: StatusChange[] = [
    {
      service: "api",
      previousStatus: "operational",
      newStatus: "down",
      changedAt: "2026-03-08T12:00:00.000Z",
    },
  ];

  it("sends POST to Resend API URL", async () => {
    await sendStatusChangeEmails(
      "test-api-key",
      [subscribers[0]],
      changes,
      "https://status.bundlenudge.com",
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.any(Object),
    );
  });

  it("includes correct Authorization Bearer header", async () => {
    await sendStatusChangeEmails(
      "re_myapikey123",
      [subscribers[0]],
      changes,
      "https://status.bundlenudge.com",
    );

    const callOptions = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = callOptions.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer re_myapikey123");
  });

  it("sets from address to status@bundlenudge.com", async () => {
    await sendStatusChangeEmails(
      "test-key",
      [subscribers[0]],
      changes,
      "https://status.bundlenudge.com",
    );

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.from).toBe("BundleNudge Status <status@bundlenudge.com>");
  });

  it("sends to subscriber email as array", async () => {
    await sendStatusChangeEmails(
      "test-key",
      [subscribers[0]],
      changes,
      "https://status.bundlenudge.com",
    );

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.to).toEqual(["user1@example.com"]);
  });

  it("includes subject with [Down] prefix when service is down", async () => {
    await sendStatusChangeEmails(
      "test-key",
      [subscribers[0]],
      changes,
      "https://status.bundlenudge.com",
    );

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.subject).toContain("[Down]");
    expect(body.subject).toContain("API");
  });

  it("includes subject without [Down] when no services are down", async () => {
    const degradedChanges: StatusChange[] = [
      {
        service: "documentation",
        previousStatus: "operational",
        newStatus: "degraded",
        changedAt: "2026-03-08T12:00:00.000Z",
      },
    ];

    await sendStatusChangeEmails(
      "test-key",
      [subscribers[0]],
      degradedChanges,
      "https://status.bundlenudge.com",
    );

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.subject).toContain("Status Update");
    expect(body.subject).not.toContain("[Down]");
  });

  it("sends separate email to each subscriber", async () => {
    await sendStatusChangeEmails(
      "test-key",
      subscribers,
      changes,
      "https://status.bundlenudge.com",
    );

    expect(fetch).toHaveBeenCalledTimes(2);

    const body1 = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    const body2 = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string);
    expect(body1.to).toEqual(["user1@example.com"]);
    expect(body2.to).toEqual(["user2@example.com"]);
  });

  it("includes unsubscribe URL in HTML body", async () => {
    await sendStatusChangeEmails(
      "test-key",
      [subscribers[0]],
      changes,
      "https://status.bundlenudge.com",
    );

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.html).toContain("token-1");
    expect(body.html).toContain("unsubscribe");
  });

  it("includes status page link in HTML body", async () => {
    await sendStatusChangeEmails(
      "test-key",
      [subscribers[0]],
      changes,
      "https://status.bundlenudge.com",
    );

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.html).toContain("https://status.bundlenudge.com");
    expect(body.html).toContain("View Status Page");
  });

  it("skips send when apiKey is empty", async () => {
    await sendStatusChangeEmails(
      "",
      subscribers,
      changes,
      "https://status.bundlenudge.com",
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips send when subscribers array is empty", async () => {
    await sendStatusChangeEmails(
      "test-key",
      [],
      changes,
      "https://status.bundlenudge.com",
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips send when changes array is empty", async () => {
    await sendStatusChangeEmails(
      "test-key",
      subscribers,
      [],
      "https://status.bundlenudge.com",
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  it("logs error on API failure but does not throw", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Rate limited", { status: 429 }),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await sendStatusChangeEmails(
      "test-key",
      [subscribers[0]],
      changes,
      "https://status.bundlenudge.com",
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Resend API error"),
    );
    consoleSpy.mockRestore();
  });

  it("includes service display names in HTML", async () => {
    const multiChanges: StatusChange[] = [
      {
        service: "dashboard",
        previousStatus: "operational",
        newStatus: "down",
        changedAt: "2026-03-08T12:00:00.000Z",
      },
    ];

    await sendStatusChangeEmails(
      "test-key",
      [subscribers[0]],
      multiChanges,
      "https://status.bundlenudge.com",
    );

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.html).toContain("Dashboard");
  });
});

describe("sendIncidentEmails", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: "email-456" }), { status: 200 }));
  });

  const subscribers = [
    { email: "user@example.com", unsubscribeToken: "unsub-token" },
  ];

  it("sends incident email with title and severity", async () => {
    await sendIncidentEmails({
      apiKey: "test-key",
      subscribers,
      title: "Database outage",
      description: "D1 is unreachable for all queries",
      severity: "critical",
      affectedServices: ["api", "edge-delivery"] as ServiceName[],
      pageUrl: "https://status.bundlenudge.com",
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.subject).toContain("[Incident]");
    expect(body.subject).toContain("Database outage");
    expect(body.html).toContain("Database outage");
    expect(body.html).toContain("critical");
    expect(body.html).toContain("API");
    expect(body.html).toContain("Edge Delivery");
  });

  it("skips send when subscribers array is empty", async () => {
    await sendIncidentEmails({
      apiKey: "test-key",
      subscribers: [],
      title: "Test",
      description: "desc",
      severity: "minor",
      affectedServices: ["api"] as ServiceName[],
      pageUrl: "https://status.bundlenudge.com",
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("includes unsubscribe link in incident email", async () => {
    await sendIncidentEmails({
      apiKey: "test-key",
      subscribers,
      title: "Outage",
      description: "desc",
      severity: "major",
      affectedServices: ["api"] as ServiceName[],
      pageUrl: "https://status.bundlenudge.com",
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.html).toContain("unsub-token");
    expect(body.html).toContain("Unsubscribe");
  });
});
