import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { fetchIncidents } from '../lib/api';

export async function GET(context: APIContext) {
  const incidentsData = await fetchIncidents(1, 50);

  return rss({
    title: 'BundleNudge Status Updates',
    description: 'Status updates and incident reports for BundleNudge services',
    site: context.site?.toString() ?? 'https://status.bundlenudge.com',
    items: incidentsData.incidents.map((incident) => ({
      title: `[${incident.severity.toUpperCase()}] ${incident.title}`,
      description: incident.description,
      pubDate: new Date(incident.startTime * 1000),
      link: `/incident/${incident.id}`,
      categories: incident.affectedServices,
    })),
    customData: '<language>en-us</language>',
  });
}
