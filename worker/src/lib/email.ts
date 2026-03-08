/**
 * Email notifications via Resend API
 */
import type { StatusChange, ServiceName } from "../types";
import { SERVICE_DISPLAY_NAMES } from "../types";
import { fetchWithTimeout } from "./fetch-timeout";

const RESEND_API_URL = "https://api.resend.com/emails";
const EMAIL_TIMEOUT_MS = 10_000;
const FROM_ADDRESS = "BundleNudge Status <status@bundlenudge.com>";

interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
}

async function sendEmail(
  apiKey: string,
  payload: ResendPayload,
): Promise<void> {
  const response = await fetchWithTimeout(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    timeoutMs: EMAIL_TIMEOUT_MS,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown");
    console.error(`Resend API error: ${String(response.status)} ${body}`);
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "operational":
      return "#22c55e";
    case "degraded":
      return "#eab308";
    case "down":
      return "#ef4444";
    default:
      return "#6b7280";
  }
}

function buildStatusChangeHtml(
  changes: StatusChange[],
  pageUrl: string,
  unsubscribeUrl: string,
): string {
  const rows = changes
    .map((c) => {
      const displayName = SERVICE_DISPLAY_NAMES[c.service];
      const color = statusColor(c.newStatus);
      return `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #222">${displayName}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #222">${c.previousStatus}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #222;color:${color};font-weight:600">${c.newStatus}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">
    <h1 style="font-size:20px;margin:0 0 24px">BundleNudge Status Update</h1>
    <table style="width:100%;border-collapse:collapse;background:#111;border-radius:8px;overflow:hidden">
      <thead>
        <tr style="background:#1a1a1a">
          <th style="padding:12px 16px;text-align:left;font-weight:600;border-bottom:1px solid #333">Service</th>
          <th style="padding:12px 16px;text-align:left;font-weight:600;border-bottom:1px solid #333">Previous</th>
          <th style="padding:12px 16px;text-align:left;font-weight:600;border-bottom:1px solid #333">Current</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin:24px 0">
      <a href="${pageUrl}" style="color:#60a5fa;text-decoration:none">View Status Page</a>
    </p>
    <p style="color:#666;font-size:12px;margin:32px 0 0">
      <a href="${unsubscribeUrl}" style="color:#666">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;
}

interface IncidentHtmlOptions {
  title: string;
  description: string;
  severity: string;
  affectedServices: ServiceName[];
  pageUrl: string;
  unsubscribeUrl: string;
}

function buildIncidentHtml(options: IncidentHtmlOptions): string {
  const { title, description, severity, affectedServices, pageUrl, unsubscribeUrl } = options;
  const serviceList = affectedServices
    .map((s) => SERVICE_DISPLAY_NAMES[s])
    .join(", ");

  const severityColor =
    severity === "critical"
      ? "#ef4444"
      : severity === "major"
        ? "#eab308"
        : "#6b7280";

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
      <p style="color:#888;margin:0;font-size:14px"><strong>Affected:</strong> ${serviceList}</p>
    </div>
    <p style="margin:24px 0">
      <a href="${pageUrl}" style="color:#60a5fa;text-decoration:none">View Status Page</a>
    </p>
    <p style="color:#666;font-size:12px;margin:32px 0 0">
      <a href="${unsubscribeUrl}" style="color:#666">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;
}

export async function sendStatusChangeEmails(
  apiKey: string,
  subscribers: Array<{ email: string; unsubscribeToken: string }>,
  changes: StatusChange[],
  pageUrl: string,
): Promise<void> {
  if (!apiKey || subscribers.length === 0 || changes.length === 0) return;

  const serviceNames = changes
    .map((c) => SERVICE_DISPLAY_NAMES[c.service])
    .join(", ");
  const hasDown = changes.some((c) => c.newStatus === "down");
  const subject = hasDown
    ? `[Down] ${serviceNames}`
    : `Status Update: ${serviceNames}`;

  for (const sub of subscribers) {
    const unsubscribeUrl = `${pageUrl}/api/unsubscribe?token=${sub.unsubscribeToken}`;
    const html = buildStatusChangeHtml(changes, pageUrl, unsubscribeUrl);

    await sendEmail(apiKey, {
      from: FROM_ADDRESS,
      to: [sub.email],
      subject,
      html,
    });
  }
}

interface SendIncidentEmailsOptions {
  apiKey: string;
  subscribers: Array<{ email: string; unsubscribeToken: string }>;
  title: string;
  description: string;
  severity: string;
  affectedServices: ServiceName[];
  pageUrl: string;
}

export async function sendIncidentEmails(
  options: SendIncidentEmailsOptions,
): Promise<void> {
  const { apiKey, subscribers, title, description, severity, affectedServices, pageUrl } = options;
  if (!apiKey || subscribers.length === 0) return;

  const subject = `[Incident] ${title}`;

  for (const sub of subscribers) {
    const unsubscribeUrl = `${pageUrl}/api/unsubscribe?token=${sub.unsubscribeToken}`;
    const html = buildIncidentHtml({
      title,
      description,
      severity,
      affectedServices,
      pageUrl,
      unsubscribeUrl,
    });

    await sendEmail(apiKey, {
      from: FROM_ADDRESS,
      to: [sub.email],
      subject,
      html,
    });
  }
}
