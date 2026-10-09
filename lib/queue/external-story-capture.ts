import { prisma } from "@/lib/db/client";
import { getInstagramStoryInsights, getLiveInstagramStories, type MetaGraphHost } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { resolveStoryPublishingPage } from "@/lib/instagram-stories/page-link";
import { filterExternalStories, needsMetricsRefresh } from "@/lib/instagram-stories/external";
import { downloadStoryMedia, purgeExpiredExternalStoryMedia } from "@/lib/instagram-stories/external-media";

type StoryCredential = { accessToken: string; host: MetaGraphHost };

/**
 * Tokens that can read the account's Stories, best first: the account's own
 * token (Instagram Login needs no Facebook Page), then the linked Page's.
 */
async function storyCredentials(account: {
  id: string;
  workspaceId: string;
  accessToken: string;
  authProvider: string;
  provider: string;
}): Promise<StoryCredential[]> {
  const credentials: StoryCredential[] = [];
  if (account.provider === "META") {
    credentials.push({
      accessToken: decryptToken(account.accessToken),
      host: account.authProvider === "INSTAGRAM_LOGIN" ? "instagram" : "facebook",
    });
  }
  const page = await resolveStoryPublishingPage(account.workspaceId, account.id);
  if (page) credentials.push({ accessToken: decryptToken(page.accessToken), host: "facebook" });
  return credentials;
}

/** Live Stories through the first credential Meta accepts. */
async function fetchLiveStories(credentials: StoryCredential[], instagramId: string) {
  let lastError: unknown = null;
  for (const credential of credentials) {
    try {
      const live = await getLiveInstagramStories(credential.accessToken, instagramId, credential.host);
      return { live, credential };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

/**
 * Save Stories posted straight from the Instagram app while Meta still returns
 * them (about 24 hours), with periodic metric snapshots. Stories Fisga
 * published itself are tracked through StorySlide and skipped here.
 */
export async function captureExternalStories(): Promise<void> {
  const accounts = await prisma.instagramAccount.findMany({
    select: {
      id: true,
      workspaceId: true,
      instagramId: true,
      username: true,
      accessToken: true,
      authProvider: true,
      provider: true,
    },
  });

  for (const account of accounts) {
    try {
      const fetched = await fetchLiveStories(await storyCredentials(account), account.instagramId);
      if (!fetched || fetched.live.length === 0) continue;
      const { live, credential } = fetched;

      const fisgaSlides = await prisma.storySlide.findMany({
        where: { instagramMediaId: { in: live.map((story) => story.id) } },
        select: { instagramMediaId: true },
      });
      const fisgaMediaIds = new Set(
        fisgaSlides.flatMap((slide) => (slide.instagramMediaId ? [slide.instagramMediaId] : []))
      );

      for (const story of filterExternalStories(live, fisgaMediaIds)) {
        const saved = await prisma.externalStory.upsert({
          where: { instagramMediaId: story.id },
          create: {
            workspaceId: account.workspaceId,
            instagramAccountId: account.id,
            instagramMediaId: story.id,
            mediaType: story.media_type ?? null,
            caption: story.caption ?? null,
            permalink: story.permalink ?? null,
            mediaUrl: story.media_url ?? null,
            postedAt: new Date(story.timestamp),
          },
          update: {
            lastSeenAt: new Date(),
            ...(story.media_url ? { mediaUrl: story.media_url } : {}),
            ...(story.permalink ? { permalink: story.permalink } : {}),
          },
          include: { metrics: { orderBy: { capturedAt: "desc" }, take: 1 } },
        });

        // Keep a copy of the media: Instagram stops serving it once the Story expires.
        if (!saved.mediaStorageKey && !saved.mediaPurgedAt) {
          const mediaUrl = story.media_url ?? saved.mediaUrl;
          const stored = mediaUrl ? await downloadStoryMedia(saved.id, mediaUrl) : null;
          if (stored) {
            await prisma.externalStory.update({
              where: { id: saved.id },
              data: {
                mediaStorageKey: stored.storageKey,
                mediaContentType: stored.contentType,
                mediaByteSize: stored.byteSize,
                mediaStoredAt: new Date(),
              },
            });
          }
        }

        if (!needsMetricsRefresh(saved.metrics[0]?.capturedAt)) continue;

        try {
          const insights = await getInstagramStoryInsights(credential.accessToken, story.id, credential.host);
          await prisma.externalStoryMetricSnapshot.create({
            data: {
              externalStoryId: saved.id,
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
          console.warn(`[External Stories] Métricas indisponíveis para ${story.id}: ${message.slice(0, 240)}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "falha desconhecida";
      console.warn(`[External Stories] Conta @${account.username} ignorada: ${message.slice(0, 240)}`);
    }
  }

  try {
    await purgeExpiredExternalStoryMedia();
  } catch (error) {
    const message = error instanceof Error ? error.message : "falha desconhecida";
    console.warn(`[External Stories] Limpeza de mídia falhou: ${message.slice(0, 240)}`);
  }
}
