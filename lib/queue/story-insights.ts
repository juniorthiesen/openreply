import { prisma } from "@/lib/db/client";
import { getInstagramStoryInsights } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { resolveStoryPublishingPage } from "@/lib/instagram-stories/page-link";

const STORY_ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
const METRICS_REFRESH_INTERVAL_MS = 20 * 60 * 1000;

/** Capture periodic snapshots while Meta still exposes a Story's insights. */
export async function captureRecentStoryInsights(): Promise<void> {
  const since = new Date(Date.now() - STORY_ACTIVE_WINDOW_MS);
  const slides = await prisma.storySlide.findMany({
    where: {
      status: "PUBLISHED",
      publishedAt: { gte: since },
      instagramMediaId: { not: null },
      sequence: { status: { in: ["PUBLISHED", "PARTIAL"] } },
      OR: [
        { metrics: { none: {} } },
        { metrics: { every: { capturedAt: { lt: new Date(Date.now() - METRICS_REFRESH_INTERVAL_MS) } } } },
      ],
    },
    include: {
      sequence: { include: { instagramAccount: true } },
      metrics: { orderBy: { capturedAt: "desc" }, take: 1 },
    },
    orderBy: { publishedAt: "desc" },
    take: 100,
  });

  for (const slide of slides) {
    if (!slide.instagramMediaId) continue;
    if (slide.metrics[0] && Date.now() - slide.metrics[0].capturedAt.getTime() < METRICS_REFRESH_INTERVAL_MS) continue;
    try {
      const page = await resolveStoryPublishingPage(slide.sequence.workspaceId, slide.sequence.instagramAccountId);
      if (!page) continue;
      const accessToken = decryptToken(page.accessToken);
      const insights = await getInstagramStoryInsights(accessToken, slide.instagramMediaId);
      await prisma.storyMetricSnapshot.create({
        data: {
          storySlideId: slide.id,
          reach: insights.reach ?? null,
          views: insights.views ?? null,
          replies: insights.replies ?? null,
          shares: insights.shares ?? null,
          follows: insights.follows ?? null,
          profileVisits: insights.profile_visits ?? null,
          totalInteractions: insights.total_interactions ?? null,
          navigation: insights.navigation ?? undefined,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "falha desconhecida";
      console.warn(`[Story Insights] Não foi possível atualizar métricas do Story ${slide.id}: ${message.slice(0, 240)}`);
    }
  }
}
