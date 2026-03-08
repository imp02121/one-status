/**
 * Unified notification system — config-aware Slack + batched email
 *
 * Reads StatusPageConfig from KV to determine which channels to notify.
 * Supports escalation triggers for open incidents.
 */
import type { Env, StatusPageConfig, StatusChange, IncidentSeverity } from "../types";
import { KV_KEYS } from "../types";
import { fetchWithTimeout } from "./fetch-timeout";
import { sendStatusChangeEmails } from "./email";

const EMAIL_BATCH_SIZE = 50;
const EMAIL_TIMEOUT_MS = 10_000;
const SLACK_TIMEOUT_MS = 5_000;

/** Load config from KV, returns null if not set */
export async function loadConfig(env: Env): Promise<StatusPageConfig | null> {
  const raw = await env.STATUS_KV.get(KV_KEYS.config);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StatusPageConfig;
  } catch {
    return null;
  }
}

/** Send Slack notification with Block Kit formatting for incidents */
async function sendSlackIncidentBlock(
  webhookUrl: string,
  title: string,
  description: string,
  severity: string,
  affectedServices: string[],
  pageUrl: string,
  mention?: string,
): Promise<void> {
  if (!webhookUrl) return;

  const severityEmoji =
    severity === "critical" ? ":rotating_light:" :
    severity === "major" ? ":warning:" :
    severity === "maintenance" ? ":wrench:" :
    ":information_source:";

  const mentionText = mention ? `${mention} ` : "";

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${severityEmoji} Incident: ${title}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Severity:*\n${severity.toUpperCase()}` },
        { type: "mrkdwn", text: `*Services:*\n${affectedServices.join(", ") || "None"}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${mentionText}${description}`,
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `<${pageUrl}|View Status Page>` },
      ],
    },
  ];

  await fetchWithTimeout(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
    timeoutMs: SLACK_TIMEOUT_MS,
  });
}

/** Send Slack escalation notification */
async function sendSlackEscalation(
  webhookUrl: string,
  incidentTitle: string,
  severity: string,
  minutesOpen: number,
  pageUrl: string,
  mention?: string,
): Promise<void> {
  if (!webhookUrl) return;

  const mentionText = mention ? `${mention} ` : "";

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: ":rotating_light: Escalation Alert",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${mentionText}Incident *"${incidentTitle}"* (${severity}) has been open for *${String(minutesOpen)} minutes* without resolution.`,
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `<${pageUrl}|View Status Page>` },
      ],
    },
  ];

  await fetchWithTimeout(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
    timeoutMs: SLACK_TIMEOUT_MS,
  });
}

interface NotifyIncidentOptions {
  title: string;
  description: string;
  severity: string;
  affectedServices: string[];
  pageUrl: string;
}

/** Notify about a new incident using KV config */
export async function notifyIncidentViaConfig(
  env: Env,
  options: NotifyIncidentOptions,
): Promise<void> {
  const config = await loadConfig(env);
  if (!config) return;

  const { title, description, severity, affectedServices, pageUrl } = options;

  // Slack notification (if enabled and severity matches filter)
  if (config.notifications.slack.enabled && config.notifications.slack.webhookUrl) {
    const filter = config.notifications.slack.severityFilter;
    if (filter.length === 0 || filter.includes(severity as IncidentSeverity)) {
      try {
        await sendSlackIncidentBlock(
          config.notifications.slack.webhookUrl,
          title,
          description,
          severity,
          affectedServices,
          pageUrl,
        );
      } catch (err: unknown) {
        console.error("Config Slack notification failed:", err);
      }
    }
  }

  // Email notification (if enabled and onIncident is true)
  if (config.notifications.email.enabled && config.notifications.email.onIncident) {
    try {
      const subscribers = await env.STATUS_DB.prepare(
        "SELECT email FROM status_subscribers WHERE verified = 1",
      ).all<{ email: string }>();

      const emails = subscribers.results.map((s) => s.email);
      if (emails.length > 0) {
        const fromAddress = config.emailFromName
          ? `${config.emailFromName} <${config.emailFrom}>`
          : config.emailFrom;

        await sendBatchedEmails({
          apiKey: env.RESEND_API_KEY,
          from: fromAddress,
          emails,
          subject: `[Incident] ${title}`,
          html: buildIncidentNotificationHtml(title, description, severity, affectedServices, pageUrl),
        });
      }
    } catch (err: unknown) {
      console.error("Config email notification failed:", err);
    }
  }
}

interface NotifyStatusChangeOptions {
  changes: StatusChange[];
  pageUrl: string;
}

/** Notify about status changes using KV config */
export async function notifyStatusChangeViaConfig(
  env: Env,
  options: NotifyStatusChangeOptions,
): Promise<void> {
  const config = await loadConfig(env);
  if (!config) return;

  const { changes, pageUrl } = options;

  // Email notification (if enabled and onStatusChange is true)
  if (config.notifications.email.enabled && config.notifications.email.onStatusChange) {
    try {
      const subscribers = await env.STATUS_DB.prepare(
        "SELECT email, unsubscribe_token as unsubscribeToken FROM status_subscribers WHERE verified = 1",
      ).all<{ email: string; unsubscribeToken: string }>();

      if (subscribers.results.length > 0) {
        await sendStatusChangeEmails(
          env.RESEND_API_KEY,
          subscribers.results,
          changes,
          pageUrl,
        );
      }
    } catch (err: unknown) {
      console.error("Config email status change notification failed:", err);
    }
  }
}

/** Check for escalation triggers on open incidents */
export async function checkEscalationTriggers(env: Env): Promise<void> {
  const config = await loadConfig(env);
  if (!config) return;
  if (!config.notifications.slack.enabled) return;

  const escalationRules = config.notifications.slack.escalation;
  if (escalationRules.length === 0) return;

  const openIncidents = await env.STATUS_DB.prepare(
    "SELECT id, title, severity, created_at as createdAt FROM status_incidents WHERE status != 'resolved' ORDER BY created_at ASC",
  ).all<{ id: number; title: string; severity: string; createdAt: string }>();

  if (openIncidents.results.length === 0) return;

  const now = Date.now();
  const pageUrl = env.STATUS_PAGE_URL;

  for (const incident of openIncidents.results) {
    const createdMs = new Date(incident.createdAt).getTime();
    const minutesOpen = Math.floor((now - createdMs) / 60_000);

    for (const rule of escalationRules) {
      if (minutesOpen >= rule.afterMinutes) {
        const escalationKey = `escalation:${String(incident.id)}:${String(rule.afterMinutes)}`;
        const alreadyFired = await env.STATUS_KV.get(escalationKey);
        if (alreadyFired) continue;

        try {
          await sendSlackEscalation(
            rule.webhookUrl,
            incident.title,
            incident.severity,
            minutesOpen,
            pageUrl,
            rule.mention,
          );

          // Mark as fired with 24h TTL
          await env.STATUS_KV.put(escalationKey, "1", { expirationTtl: 86400 });
        } catch (err: unknown) {
          console.error(`Escalation failed for incident ${String(incident.id)}:`, err);
        }
      }
    }
  }
}

interface BatchedEmailOptions {
  apiKey: string;
  from: string;
  emails: string[];
  subject: string;
  html: string;
}

/** Send emails in batches of EMAIL_BATCH_SIZE */
export async function sendBatchedEmails(options: BatchedEmailOptions): Promise<number> {
  const { apiKey, from, emails, subject, html } = options;
  if (!apiKey || emails.length === 0) return 0;

  let sent = 0;

  for (let i = 0; i < emails.length; i += EMAIL_BATCH_SIZE) {
    const batch = emails.slice(i, i + EMAIL_BATCH_SIZE);

    const promises = batch.map(async (email) => {
      try {
        const response = await fetchWithTimeout("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from, to: [email], subject, html }),
          timeoutMs: EMAIL_TIMEOUT_MS,
        });

        if (response.ok) {
          sent++;
        } else {
          const body = await response.text().catch(() => "unknown");
          console.error(`Email send failed: ${String(response.status)} ${body}`);
        }
      } catch (err: unknown) {
        console.error("Email send error:", err);
      }
    });

    await Promise.all(promises);
  }

  return sent;
}

function buildIncidentNotificationHtml(
  title: string,
  description: string,
  severity: string,
  affectedServices: string[],
  pageUrl: string,
): string {
  const severityColor =
    severity === "critical" ? "#ef4444" :
    severity === "major" ? "#eab308" :
    severity === "maintenance" ? "#3b82f6" :
    "#6b7280";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">
    <h1 style="font-size:20px;margin:0 0 8px">BundleNudge Incident</h1>
    <p style="color:${severityColor};font-weight:600;margin:0 0 24px;text-transform:uppercase">${severity}</p>
    <div style="background:#111;border-radius:8px;padding:20px;margin-bottom:16px">
      <h2 style="font-size:16px;margin:0 0 8px">${title}</h2>
      <p style="color:#aaa;margin:0 0 12px">${description}</p>
      <p style="color:#888;margin:0;font-size:14px"><strong>Affected:</strong> ${affectedServices.join(", ") || "None"}</p>
    </div>
    <p style="margin:24px 0">
      <a href="${pageUrl}" style="color:#60a5fa;text-decoration:none">View Status Page</a>
    </p>
  </div>
</body>
</html>`;
}
