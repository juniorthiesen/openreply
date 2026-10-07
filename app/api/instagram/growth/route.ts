import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import {
  getAllUserMedia,
  getMediaInsights,
  PermissionError,
  type InstagramMedia,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { ensureFollowerHistory, getFollowerHistory } from "@/lib/reports/follower-history";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MEDIA_SCAN_LIMIT = 251;
const MEDIA_RESULT_LIMIT = MEDIA_SCAN_LIMIT - 1;
const INSIGHTS_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

function validTimeZone(value: string | null): string {
  if (!value || value.length > 100) return "America/Sao_Paulo";
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value });
    return value;
  } catch {
    return "America/Sao_Paulo";
  }
}

function mediaIsVideo(media: InstagramMedia): boolean {
  return media.media_product_type === "REELS" || media.media_type === "VIDEO";
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Sessão não autorizada." }, { status: 401 });
  }

  const requestedPeriod = Number(request.nextUrl.searchParams.get("periodDays"));
  const periodDays: 30 | 90 = requestedPeriod === 30 ? 30 : 90;
  const timeZone = validTimeZone(request.nextUrl.searchParams.get("timeZone"));
  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Conecte uma conta profissional do Instagram para ver o crescimento." },
      { status: 400 }
    );
  }

  const now = new Date();
  const periodStart = new Date(now.getTime() - periodDays * 86_400_000);

  try {
    const accessToken = decryptToken(account.accessToken);
    const [mediaPage, storyRows, keywordComments, sentDms, clicks, accounts] = await Promise.all([
      getAllUserMedia(accessToken, MEDIA_SCAN_LIMIT),
      prisma.storySlide.findMany({
        where: {
          status: "PUBLISHED",
          publishedAt: { gte: periodStart, lte: now },
          sequence: { workspaceId, instagramAccountId: account.id },
        },
        orderBy: { publishedAt: "desc" },
        select: {
          id: true,
          publishedAt: true,
          metrics: {
            orderBy: { capturedAt: "desc" },
            take: 1,
            select: {
              reach: true,
              views: true,
              replies: true,
              shares: true,
              totalInteractions: true,
            },
          },
        },
      }),
      prisma.dmLog.count({
        where: {
          workspaceId,
          instagramAccountId: account.id,
          matchedKeyword: { not: null },
          createdAt: { gte: periodStart, lte: now },
        },
      }),
      prisma.dmLog.count({
        where: {
          workspaceId,
          instagramAccountId: account.id,
          status: "SENT",
          dmSentAt: { gte: periodStart, lte: now },
        },
      }),
      prisma.linkClick.count({
        where: {
          workspaceId,
          instagramAccountId: account.id,
          createdAt: { gte: periodStart, lte: now },
        },
      }),
      prisma.instagramAccount.findMany({
        where: { workspaceId },
        orderBy: { connectedAt: "desc" },
        select: { id: true, username: true },
      }),
    ]);

    const periodMedia = mediaPage
      .filter((media) => {
        const timestamp = Date.parse(media.timestamp);
        return Number.isFinite(timestamp) && timestamp >= periodStart.getTime() && timestamp <= now.getTime();
      })
      .slice(0, MEDIA_RESULT_LIMIT);

    let insightsAvailable = false;
    let insightsPermissionDenied = false;
    const insights = await mapWithConcurrency(
      periodMedia,
      INSIGHTS_CONCURRENCY,
      async (media) => {
        if (insightsPermissionDenied) return null;
        const requestedMetrics = mediaIsVideo(media)
          ? ["views", "reach", "saved", "shares", "total_interactions"]
          : ["reach", "saved", "shares", "total_interactions"];
        try {
          const result = await getMediaInsights(accessToken, media.id, requestedMetrics);
          insightsAvailable = true;
          return result;
        } catch (error) {
          if (error instanceof PermissionError) insightsPermissionDenied = true;
          return null;
        }
      }
    );

    const followerCountPromise = ensureFollowerHistory(
      { id: account.id, instagramId: account.instagramId },
      { provider: "META", accessToken }
    ).catch((error) => {
      console.warn("[Instagram Growth] Histórico de seguidores indisponível:", error instanceof Error ? error.message : error);
      return null;
    });
    const [followers, followerHistory] = await Promise.all([
      followerCountPromise,
      getFollowerHistory(account.id, periodDays + 14).catch(() => []),
    ]);

    const mediaIds = periodMedia.map((media) => media.id);
    const automations = mediaIds.length
      ? await prisma.automation.findMany({
          where: {
            workspaceId,
            instagramAccountId: account.id,
            postId: { in: mediaIds },
          },
          select: { id: true, postId: true },
        })
      : [];
    const automationIds = automations.map((automation) => automation.id);
    const campaignDmRows = automationIds.length
      ? await prisma.dmLog.groupBy({
          by: ["automationId"],
          where: {
            workspaceId,
            instagramAccountId: account.id,
            automationId: { in: automationIds },
            status: "SENT",
            dmSentAt: { gte: periodStart, lte: now },
          },
          _count: { _all: true },
        })
      : [];
    const dmsByAutomation = new Map(campaignDmRows.map((row) => [row.automationId, row._count._all]));
    const dmsByPost = new Map<string, number>();
    for (const automation of automations) {
      if (!automation.postId) continue;
      dmsByPost.set(
        automation.postId,
        (dmsByPost.get(automation.postId) ?? 0) + (dmsByAutomation.get(automation.id) ?? 0)
      );
    }
    const hasAutomationByPost = new Set(automations.flatMap((automation) => automation.postId ? [automation.postId] : []));

    const posts = periodMedia.map((media, index) => {
      const metrics = insights[index];
      return {
        id: media.id,
        mediaType: media.media_product_type ?? media.media_type,
        timestamp: media.timestamp,
        reach: metrics?.reach ?? null,
        likes: media.like_count ?? null,
        comments: media.comments_count ?? null,
        saved: metrics?.saved ?? null,
        shares: metrics?.shares ?? null,
        totalInteractions: metrics?.total_interactions ?? null,
        campaignDms: hasAutomationByPost.has(media.id) ? dmsByPost.get(media.id) ?? 0 : null,
      };
    });
    const stories = storyRows.flatMap((story) => {
      if (!story.publishedAt) return [];
      const metrics = story.metrics[0];
      return [{
        id: story.id,
        publishedAt: story.publishedAt.toISOString(),
        reach: metrics?.reach ?? null,
        views: metrics?.views ?? null,
        replies: metrics?.replies ?? null,
        shares: metrics?.shares ?? null,
        totalInteractions: metrics?.totalInteractions ?? null,
      }];
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          account: { id: account.id, username: account.username },
          accounts,
          periodDays,
          timeZone,
          periodStart: periodStart.toISOString(),
          periodEnd: now.toISOString(),
          followers,
          followerHistory,
          insightsAvailable,
          insightsPermissionDenied,
          mediaLimitReached: mediaPage.length >= MEDIA_SCAN_LIMIT,
          posts,
          stories,
          activityTotals: { keywordComments, sentDms, clicks },
        },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[Instagram Growth] Erro ao carregar análise:", error);
    return NextResponse.json(
      { success: false, error: "Não foi possível carregar os dados de crescimento do Instagram." },
      { status: 500 }
    );
  }
}
