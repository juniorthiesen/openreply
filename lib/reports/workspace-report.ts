/**
 * Period reports for the MCP server: one campaign, or the whole workspace.
 *
 * Unlike the public share page (lib/reports/data.ts) these are keyed by
 * workspace and need no share link — the caller already holds a workspace
 * token — and cover a chosen number of days instead of a fixed week.
 */

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  calculateCtr,
  CLICK_ROW_SELECT,
  countUniqueClicks,
  countUniqueClicksBy,
  normalizeTopKeywords,
  summarizeDmStatuses,
} from "@/lib/tracking/analytics";
import { buildReportUrl } from "@/lib/reports/share";
import { buildTrackedUrl } from "@/lib/tracking/message";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";

/** Days are cut in this zone, so "today" matches what the account owner sees. */
export const REPORT_TIME_ZONE = "America/Sao_Paulo";

export const MAX_REPORT_DAYS = 90;
const MAX_CAMPAIGNS_IN_RANKING = 20;

export interface DailyPoint {
  date: string; // YYYY-MM-DD in REPORT_TIME_ZONE
  sent: number;
  clicks: number;
}

export function clampDays(days: number | undefined, fallback = 30): number {
  const value = Number.isFinite(days) ? Math.trunc(days as number) : fallback;
  return Math.min(Math.max(value, 1), MAX_REPORT_DAYS);
}

function dayKey(date: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIME_ZONE }).format(date);
}

/** Every day of the window, oldest first, so a quiet day shows as zero. */
export function buildDailySeries(
  days: number,
  sentByDay: Map<string, number>,
  clicksByDay: Map<string, number>,
  now: Date = new Date()
): DailyPoint[] {
  const series: DailyPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const key = dayKey(new Date(now.getTime() - offset * 86_400_000));
    series.push({ date: key, sent: sentByDay.get(key) ?? 0, clicks: clicksByDay.get(key) ?? 0 });
  }
  return series;
}

async function sentPerDay(
  workspaceId: string,
  since: Date,
  automationId?: string
): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ day: Date; sent: bigint }[]>(Prisma.sql`
    SELECT date_trunc('day', "createdAt" AT TIME ZONE ${REPORT_TIME_ZONE}) AS day,
           COUNT(*) AS sent
    FROM "DmLog"
    WHERE "workspaceId" = ${workspaceId}
      AND "status" = 'SENT'
      AND "createdAt" >= ${since}
      ${automationId ? Prisma.sql`AND "automationId" = ${automationId}` : Prisma.empty}
    GROUP BY 1
  `);
  // date_trunc on a zone-converted value is a naive timestamp: its UTC fields
  // are already the local calendar date.
  return new Map(rows.map((row) => [row.day.toISOString().slice(0, 10), Number(row.sent)]));
}

function clicksPerDay(rows: { createdAt: Date; automationId: string; recipientHash: string | null; ipHash: string | null; id: string }[]) {
  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = dayKey(row.createdAt);
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }
  return new Map([...byDay].map(([key, dayRows]) => [key, countUniqueClicks(dayRows)]));
}

function windowStart(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

export async function getCampaignPerformance(
  workspaceId: string,
  campaignId: string,
  requestedDays?: number
) {
  const days = clampDays(requestedDays);
  const since = windowStart(days);

  const campaign = await prisma.automation.findFirst({
    where: { id: campaignId, workspaceId },
    select: {
      id: true,
      name: true,
      goal: true,
      postUrl: true,
      keywords: true,
      matchAnyWord: true,
      matchAnyPost: true,
      isActive: true,
      createdAt: true,
      reportShareSlug: true,
      reportShareEnabled: true,
      instagramAccount: { select: { username: true } },
      trackedLinks: {
        select: { id: true, slug: true, destinationUrl: true },
        orderBy: TRACKED_LINK_ORDER,
      },
    },
  });
  if (!campaign) return null;

  const [statusRows, keywordRows, clickRows, sentDaily] = await Promise.all([
    prisma.dmLog.groupBy({
      by: ["status"],
      where: { workspaceId, automationId: campaignId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.dmLog.groupBy({
      by: ["matchedKeyword"],
      where: {
        workspaceId,
        automationId: campaignId,
        matchedKeyword: { not: null },
        createdAt: { gte: since },
      },
      _count: { _all: true },
    }),
    prisma.linkClick.findMany({
      where: { workspaceId, automationId: campaignId, createdAt: { gte: since } },
      select: { ...CLICK_ROW_SELECT, trackedLinkId: true, createdAt: true },
    }),
    sentPerDay(workspaceId, since, campaignId),
  ]);

  const totals = summarizeDmStatuses(
    statusRows.map((row) => ({ status: row.status, _count: row._count._all }))
  );
  const clicks = countUniqueClicks(clickRows);
  const clicksByLink = countUniqueClicksBy(clickRows, (row) => row.trackedLinkId ?? "");

  return {
    period: { days, since: since.toISOString(), timeZone: REPORT_TIME_ZONE },
    campaign: {
      id: campaign.id,
      name: campaign.name,
      goal: campaign.goal,
      isActive: campaign.isActive,
      instagram: campaign.instagramAccount.username,
      trigger: campaign.matchAnyPost
        ? "any post"
        : (campaign.postUrl ?? "a specific post or the next reel"),
      keywords: campaign.matchAnyWord ? "any comment" : campaign.keywords,
      createdAt: campaign.createdAt.toISOString(),
      publicReportUrl:
        campaign.reportShareSlug && campaign.reportShareEnabled
          ? buildReportUrl(campaign.reportShareSlug)
          : null,
    },
    totals: { ...totals, clicks, ctr: calculateCtr(clicks, totals.sent) },
    topKeywords: normalizeTopKeywords(
      keywordRows.map((row) => ({ matchedKeyword: row.matchedKeyword, _count: row._count._all })),
      10
    ),
    daily: buildDailySeries(days, sentDaily, clicksPerDay(clickRows)),
    links: campaign.trackedLinks.map((link) => ({
      url: buildTrackedUrl(link.slug),
      destination: link.destinationUrl,
      clicks: clicksByLink.get(link.id) ?? 0,
    })),
  };
}

export async function getWorkspacePerformance(workspaceId: string, requestedDays?: number) {
  const days = clampDays(requestedDays);
  const since = windowStart(days);

  const [campaigns, statusRows, keywordRows, clickRows, sentDaily, facebookRows] =
    await Promise.all([
      prisma.automation.findMany({
        where: { workspaceId },
        select: { id: true, name: true, isActive: true },
      }),
      prisma.dmLog.groupBy({
        by: ["automationId", "status"],
        where: { workspaceId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.dmLog.groupBy({
        by: ["matchedKeyword"],
        where: { workspaceId, matchedKeyword: { not: null }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.linkClick.findMany({
        where: { workspaceId, createdAt: { gte: since } },
        select: { ...CLICK_ROW_SELECT, createdAt: true },
      }),
      sentPerDay(workspaceId, since),
      prisma.facebookCommentLog.groupBy({
        by: ["status"],
        where: { automation: { workspaceId }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);

  const clickCounts = countUniqueClicksBy(clickRows, (row) => row.automationId);
  const rowsByCampaign = new Map<string, { status: string; _count: number }[]>();
  for (const row of statusRows) {
    rowsByCampaign.set(row.automationId, [
      ...(rowsByCampaign.get(row.automationId) ?? []),
      { status: row.status, _count: row._count._all },
    ]);
  }

  const ranking = campaigns
    .map((campaign) => {
      const summary = summarizeDmStatuses(rowsByCampaign.get(campaign.id) ?? []);
      const clicks = clickCounts.get(campaign.id) ?? 0;
      return {
        id: campaign.id,
        name: campaign.name,
        isActive: campaign.isActive,
        sent: summary.sent,
        failed: summary.failed,
        clicks,
        ctr: calculateCtr(clicks, summary.sent),
      };
    })
    .filter((campaign) => campaign.sent > 0 || campaign.failed > 0 || campaign.clicks > 0)
    .sort((a, b) => b.sent - a.sent || b.clicks - a.clicks)
    .slice(0, MAX_CAMPAIGNS_IN_RANKING);

  const totals = summarizeDmStatuses(
    statusRows.map((row) => ({ status: row.status, _count: row._count._all }))
  );
  const clicks = countUniqueClicks(clickRows);
  const facebook = summarizeDmStatuses(
    facebookRows.map((row) => ({ status: row.status, _count: row._count._all }))
  );

  return {
    period: { days, since: since.toISOString(), timeZone: REPORT_TIME_ZONE },
    totals: { ...totals, clicks, ctr: calculateCtr(clicks, totals.sent) },
    campaignsActive: campaigns.filter((campaign) => campaign.isActive).length,
    campaignsTotal: campaigns.length,
    topCampaigns: ranking,
    topKeywords: normalizeTopKeywords(
      keywordRows.map((row) => ({ matchedKeyword: row.matchedKeyword, _count: row._count._all })),
      10
    ),
    daily: buildDailySeries(days, sentDaily, clicksPerDay(clickRows)),
    facebookComments: { repliesSent: facebook.sent, failed: facebook.failed },
  };
}
