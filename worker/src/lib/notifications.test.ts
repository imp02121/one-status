import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadConfig,
  notifyIncidentViaConfig,
  notifyStatusChangeViaConfig,
  checkEscalationTriggers,
  sendBatchedEmails,
} from "./notifications";
import { createMockEnv } from "../test-helpers";
import { KV_KEYS } from "../types";
import type { Env, StatusPageConfig } from "../types";

// Mock fetch globally for Slack/Resend calls
vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("ok", { status: 200 }))));

function validConfig(): StatusPageConfig {
  return {
    services: [
      { slug: "api", name: "API", url: "https://api.bundlenudge.com", checkType: "head" },
    ],
    emailFrom: "status@bundlenudge.com",
    emailFromName: "BundleNudge Status",
    notifications: {
      slack: {
        enabled: true,
        webhookUrl: "https://hooks.slack.com/services/T/B/X",
        channel: "#ops",
        severityFilter: ["critical", "major"],
        escalation: [],
      },
      email: {
        enabled: true,
        onStatusChange: true,
        onIncident: true,
      },
    },
  };
}

describe("loadConfig", () => {
  let env: Env;

  beforeEach(() => {
    env = createMockEnv();
  });

  it("returns config from KV when valid JSON is stored", async () => {
    const config = validConfig();
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(JSON.stringify(config));

    const result = await loadConfig(env);

    expect(result).toEqual(config);
    expect(env.STATUS_KV.get).toHaveBeenCalledWith(KV_KEYS.config);
  });

  it("returns null when no config in KV", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(null);

    const result = await loadConfig(env);

    expect(result).toBeNull();
  });

  it("returns null when KV contains invalid JSON", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce("not-json{{{");

    const result = await loadConfig(env);

    expect(result).toBeNull();
  });
});

describe("sendBatchedEmails", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 0 when no emails provided", async () => {
    const sent = await sendBatchedEmails({
      apiKey: "test-key",
      from: "test@test.com",
      emails: [],
      subject: "Test",
      html: "<p>Hi</p>",
    });

    expect(sent).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 0 when apiKey is empty", async () => {
    const sent = await sendBatchedEmails({
      apiKey: "",
      from: "test@test.com",
      emails: ["a@test.com"],
      subject: "Test",
      html: "<p>Hi</p>",
    });

    expect(sent).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends emails and returns count of successful sends", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));

    const sent = await sendBatchedEmails({
      apiKey: "test-key",
      from: "status@test.com",
      emails: ["a@test.com", "b@test.com", "c@test.com"],
      subject: "Test Subject",
      html: "<p>Hello</p>",
    });

    expect(sent).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not count failed sends", async () => {
    let callNum = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callNum++;
      if (callNum === 2) {
        return new Response("error", { status: 500 });
      }
      return new Response("ok", { status: 200 });
    });

    const sent = await sendBatchedEmails({
      apiKey: "test-key",
      from: "status@test.com",
      emails: ["a@test.com", "b@test.com", "c@test.com"],
      subject: "Test",
      html: "<p>Hi</p>",
    });

    expect(sent).toBe(2);
  });

  it("handles fetch errors gracefully without throwing", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    const sent = await sendBatchedEmails({
      apiKey: "test-key",
      from: "status@test.com",
      emails: ["a@test.com"],
      subject: "Test",
      html: "<p>Hi</p>",
    });

    expect(sent).toBe(0);
  });

  it("batches emails in groups of 50", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
    const emails = Array.from({ length: 75 }, (_, i) => `user${String(i)}@test.com`);

    const sent = await sendBatchedEmails({
      apiKey: "test-key",
      from: "status@test.com",
      emails,
      subject: "Test",
      html: "<p>Hi</p>",
    });

    expect(sent).toBe(75);
    expect(fetch).toHaveBeenCalledTimes(75);
  });

  it("sends correct Resend API payload", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));

    await sendBatchedEmails({
      apiKey: "re_test123",
      from: "status@bundlenudge.com",
      emails: ["user@test.com"],
      subject: "Incident Alert",
      html: "<p>Alert</p>",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test123",
          "Content-Type": "application/json",
        }),
      }),
    );
  });
});

describe("notifyIncidentViaConfig", () => {
  let env: Env;

  beforeEach(() => {
    env = createMockEnv();
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when no config is set", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(null);

    await notifyIncidentViaConfig(env, {
      title: "Test",
      description: "Desc",
      severity: "critical",
      affectedServices: ["api"],
      pageUrl: "https://status.bundlenudge.com",
    });

    // Only KV.get should have been called (to load config)
    expect(env.STATUS_KV.get).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends Slack notification when enabled and severity matches filter", async () => {
    const config = validConfig();
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(JSON.stringify(config));

    await notifyIncidentViaConfig(env, {
      title: "API Down",
      description: "500 errors",
      severity: "critical",
      affectedServices: ["api"],
      pageUrl: "https://status.bundlenudge.com",
    });

    // Should call fetch for Slack webhook
    expect(fetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T/B/X",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("skips Slack notification when severity does not match filter", async () => {
    const config = validConfig();
    config.notifications.slack.severityFilter = ["critical"];
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(JSON.stringify(config));

    // Mock D1 for email subscriber query
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [] }),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
      raw: vi.fn().mockResolvedValue([]),
    } as unknown as D1PreparedStatement));

    await notifyIncidentViaConfig(env, {
      title: "Minor Issue",
      description: "Small problem",
      severity: "minor",
      affectedServices: [],
      pageUrl: "https://status.bundlenudge.com",
    });

    // Slack webhook should NOT have been called
    const slackCalls = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("hooks.slack.com"),
    );
    expect(slackCalls).toHaveLength(0);
  });

  it("skips Slack notification when Slack is disabled", async () => {
    const config = validConfig();
    config.notifications.slack.enabled = false;
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(JSON.stringify(config));
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [] }),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
      raw: vi.fn().mockResolvedValue([]),
    } as unknown as D1PreparedStatement));

    await notifyIncidentViaConfig(env, {
      title: "Test",
      description: "Desc",
      severity: "critical",
      affectedServices: [],
      pageUrl: "https://status.bundlenudge.com",
    });

    const slackCalls = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("hooks.slack.com"),
    );
    expect(slackCalls).toHaveLength(0);
  });

  it("sends email notification when enabled and onIncident is true", async () => {
    const config = validConfig();
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(JSON.stringify(config));
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({
        results: [{ email: "user@test.com" }],
      }),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
      raw: vi.fn().mockResolvedValue([]),
    } as unknown as D1PreparedStatement));

    await notifyIncidentViaConfig(env, {
      title: "Outage",
      description: "Everything is down",
      severity: "critical",
      affectedServices: ["api"],
      pageUrl: "https://status.bundlenudge.com",
    });

    // Should have called fetch for both Slack and Resend
    const resendCalls = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("resend.com"),
    );
    expect(resendCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("skips email when onIncident is false", async () => {
    const config = validConfig();
    config.notifications.email.onIncident = false;
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(JSON.stringify(config));

    await notifyIncidentViaConfig(env, {
      title: "Test",
      description: "Desc",
      severity: "critical",
      affectedServices: [],
      pageUrl: "https://status.bundlenudge.com",
    });

    // Should NOT have called Resend API
    const resendCalls = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("resend.com"),
    );
    expect(resendCalls).toHaveLength(0);
  });
});

describe("checkEscalationTriggers", () => {
  let env: Env;

  beforeEach(() => {
    env = createMockEnv();
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when no config is set", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(null);

    await checkEscalationTriggers(env);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("does nothing when Slack is disabled", async () => {
    const config = validConfig();
    config.notifications.slack.enabled = false;
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(JSON.stringify(config));

    await checkEscalationTriggers(env);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("does nothing when no escalation rules defined", async () => {
    const config = validConfig();
    config.notifications.slack.escalation = [];
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(JSON.stringify(config));

    await checkEscalationTriggers(env);

    // Should not query for incidents if no rules
    expect(env.STATUS_DB.prepare).not.toHaveBeenCalled();
  });

  it("fires escalation when incident has been open long enough", async () => {
    const config = validConfig();
    config.notifications.slack.escalation = [
      { afterMinutes: 30, webhookUrl: "https://hooks.slack.com/escalate" },
    ];
    vi.mocked(env.STATUS_KV.get).mockImplementation(async (key: string) => {
      if (key === KV_KEYS.config) return JSON.stringify(config);
      // escalation key not yet fired
      return null;
    });

    // Incident created 60 minutes ago
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({
        results: [{ id: 1, title: "API Down", severity: "critical", createdAt: sixtyMinutesAgo }],
      }),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
      raw: vi.fn().mockResolvedValue([]),
    } as unknown as D1PreparedStatement));

    await checkEscalationTriggers(env);

    // Should have sent escalation webhook
    const slackCalls = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("hooks.slack.com/escalate"),
    );
    expect(slackCalls).toHaveLength(1);

    // Should have marked escalation as fired in KV
    expect(env.STATUS_KV.put).toHaveBeenCalledWith(
      "escalation:1:30",
      "1",
      expect.objectContaining({ expirationTtl: 86400 }),
    );
  });

  it("does not re-fire escalation that was already triggered", async () => {
    const config = validConfig();
    config.notifications.slack.escalation = [
      { afterMinutes: 30, webhookUrl: "https://hooks.slack.com/escalate" },
    ];
    vi.mocked(env.STATUS_KV.get).mockImplementation(async (key: string) => {
      if (key === KV_KEYS.config) return JSON.stringify(config);
      if (key === "escalation:1:30") return "1"; // already fired
      return null;
    });

    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({
        results: [{ id: 1, title: "API Down", severity: "critical", createdAt: sixtyMinutesAgo }],
      }),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
      raw: vi.fn().mockResolvedValue([]),
    } as unknown as D1PreparedStatement));

    await checkEscalationTriggers(env);

    // Slack should NOT have been called
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips incidents that have not been open long enough", async () => {
    const config = validConfig();
    config.notifications.slack.escalation = [
      { afterMinutes: 60, webhookUrl: "https://hooks.slack.com/escalate" },
    ];
    vi.mocked(env.STATUS_KV.get).mockImplementation(async (key: string) => {
      if (key === KV_KEYS.config) return JSON.stringify(config);
      return null;
    });

    // Incident created 10 minutes ago — should not trigger 60-minute rule
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({
        results: [{ id: 1, title: "Slow API", severity: "minor", createdAt: tenMinutesAgo }],
      }),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
      raw: vi.fn().mockResolvedValue([]),
    } as unknown as D1PreparedStatement));

    await checkEscalationTriggers(env);

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("notifyStatusChangeViaConfig", () => {
  let env: Env;

  beforeEach(() => {
    env = createMockEnv();
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when no config is set", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(null);

    await notifyStatusChangeViaConfig(env, {
      changes: [{ service: "api", previousStatus: "operational", newStatus: "down", changedAt: "2026-03-08" }],
      pageUrl: "https://status.bundlenudge.com",
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends email when onStatusChange is true", async () => {
    const config = validConfig();
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(JSON.stringify(config));
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({
        results: [{ email: "user@test.com", unsubscribeToken: "tok1" }],
      }),
      run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
      raw: vi.fn().mockResolvedValue([]),
    } as unknown as D1PreparedStatement));

    await notifyStatusChangeViaConfig(env, {
      changes: [{ service: "api", previousStatus: "operational", newStatus: "down", changedAt: "2026-03-08" }],
      pageUrl: "https://status.bundlenudge.com",
    });

    const resendCalls = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("resend.com"),
    );
    expect(resendCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("skips email when onStatusChange is false", async () => {
    const config = validConfig();
    config.notifications.email.onStatusChange = false;
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(JSON.stringify(config));

    await notifyStatusChangeViaConfig(env, {
      changes: [{ service: "api", previousStatus: "operational", newStatus: "down", changedAt: "2026-03-08" }],
      pageUrl: "https://status.bundlenudge.com",
    });

    expect(fetch).not.toHaveBeenCalled();
  });
});
