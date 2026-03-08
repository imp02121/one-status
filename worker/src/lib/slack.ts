/**
 * Slack notification via incoming webhook (Block Kit)
 */
import type { ServiceName, StatusChange } from "../types";
import { SERVICE_DISPLAY_NAMES } from "../types";
import { fetchWithTimeout } from "./fetch-timeout";

const SLACK_TIMEOUT_MS = 5_000;

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text: string; emoji?: boolean }>;
  fields?: Array<{ type: string; text: string }>;
}

function statusEmoji(status: string): string {
  switch (status) {
    case "operational":
      return ":large_green_circle:";
    case "degraded":
      return ":large_yellow_circle:";
    case "down":
      return ":red_circle:";
    default:
      return ":white_circle:";
  }
}

function buildStatusChangeBlocks(change: StatusChange, pageUrl: string): SlackBlock[] {
  const displayName = SERVICE_DISPLAY_NAMES[change.service];
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${statusEmoji(change.newStatus)} Service Status Change`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Service:*\n${displayName}`,
        },
        {
          type: "mrkdwn",
          text: `*Status:*\n${change.previousStatus} → ${change.newStatus}`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Time:* ${change.changedAt}`,
      },
    },
  ];

  if (change.error) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Error:* \`${change.error}\``,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `<${pageUrl}|View Status Page>`,
      },
    ],
  });

  return blocks;
}

export async function sendSlackNotification(
  webhookUrl: string,
  changes: StatusChange[],
  pageUrl: string,
): Promise<void> {
  if (!webhookUrl || changes.length === 0) return;

  for (const change of changes) {
    const blocks = buildStatusChangeBlocks(change, pageUrl);

    const response = await fetchWithTimeout(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
      timeoutMs: SLACK_TIMEOUT_MS,
    });

    if (!response.ok) {
      console.error(
        `Slack notification failed for ${change.service}: ${String(response.status)}`,
      );
    }
  }
}

export async function sendSlackIncidentNotification(
  webhookUrl: string,
  title: string,
  description: string,
  severity: string,
  affectedServices: ServiceName[],
  pageUrl: string,
): Promise<void> {
  if (!webhookUrl) return;

  const serviceList = affectedServices
    .map((s) => SERVICE_DISPLAY_NAMES[s])
    .join(", ");

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: ":warning: New Incident",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Title:*\n${title}` },
        { type: "mrkdwn", text: `*Severity:*\n${severity}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Affected:* ${serviceList}\n*Details:* ${description}`,
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
