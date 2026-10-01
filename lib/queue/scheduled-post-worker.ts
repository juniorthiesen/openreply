import {
  DelayedError,
  Job,
  UnrecoverableError,
  Worker,
} from "bullmq";
import { prisma } from "@/lib/db/client";
import {
  createInstagramMediaContainer,
  createInstagramCarouselContainer,
  createInstagramCarouselItemContainer,
  getInstagramMediaContainerStatus,
  getInstagramMediaPermalink,
  getUserMedia,
  MetaApiError,
  PermissionError,
  publishInstagramMediaContainer,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getMediaPublicUrl } from "@/lib/media-assets";
import { classifyInstagramPublishError } from "@/lib/meta/publish-error";
import { getRedisConnection } from "@/lib/queue/client";
import {
  PublishScheduledPostJob,
  SCHEDULED_POST_PREPUBLISH_LEAD_MS,
  SCHEDULED_POST_QUEUE_NAME,
} from "@/lib/queue/scheduled-posts";

const CONTAINER_POLL_INTERVAL_MS = 10_000;
const MAX_CONTAINER_POLLS = 30;

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Falha desconhecida ao publicar.";
}

async function recoverPublishedMediaId(
  accessToken: string,
  caption: string,
  mediaType: "IMAGE" | "REEL" | "CAROUSEL",
  since: Date
): Promise<string | null> {
  const recent = await getUserMedia(accessToken, 50);
  const earliest = since.getTime() - 2 * 60 * 1000;
  const candidates = recent.filter((media) => {
    if (media.caption !== caption || Date.parse(media.timestamp) < earliest) return false;
    if (mediaType === "IMAGE") return media.media_type === "IMAGE";
    if (mediaType === "CAROUSEL") return media.media_type === "CAROUSEL_ALBUM";
    return media.media_type === "VIDEO" || media.media_product_type === "REELS";
  });
  candidates.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return candidates[0]?.id ?? null;
}

async function finishPublishedPost(
  post: {
    id: string;
    workspaceId: string;
    instagramAccountId: string;
    automationId: string | null;
  },
  instagramMediaId: string | null,
  permalink: string | null
) {
  await prisma.$transaction(async (tx) => {
    await tx.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: "PUBLISHED",
        instagramMediaId,
        permalink,
        publishedAt: new Date(),
        lastError: instagramMediaId ? null : "Publicado no Instagram. A Meta não retornou o identificador da publicação.",
      },
    });

    if (post.automationId && instagramMediaId) {
      await tx.automation.updateMany({
        where: {
          id: post.automationId,
          workspaceId: post.workspaceId,
          instagramAccountId: post.instagramAccountId,
        },
        data: {
          postId: instagramMediaId,
          postUrl: permalink,
          pendingNextReel: false,
        },
      });
    }
  });
}

async function processScheduledPost(job: Job<PublishScheduledPostJob>, token?: string) {
  const { scheduledPostId, scheduledAt } = job.data;
  const post = await prisma.scheduledPost.findUnique({
    where: { id: scheduledPostId },
    include: {
      instagramAccount: true,
      mediaAsset: true,
      mediaItems: { orderBy: { position: "asc" }, include: { mediaAsset: true } },
    },
  });

  if (!post || !["SCHEDULED", "PUBLISHING"].includes(post.status)) return;
  if (!post.scheduledAt) return;
  if (post.scheduledAt.toISOString() !== scheduledAt) return;
  if (post.scheduledAt.getTime() > Date.now() + SCHEDULED_POST_PREPUBLISH_LEAD_MS + 60_000) return;

  if (post.status === "SCHEDULED") {
    const claimed = await prisma.scheduledPost.updateMany({
      where: {
        id: post.id,
        status: "SCHEDULED",
        scheduledAt: new Date(scheduledAt),
      },
      data: { status: "PUBLISHING", attempts: { increment: 1 }, lastError: null },
    });
    if (claimed.count !== 1) return;
  } else {
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { attempts: { increment: 1 } },
    });
  }

  if (!post.instagramAccount.publishingPermissionGranted) {
    throw new UnrecoverableError(
      "Reconecte o Instagram e conceda a permissão para publicar conteúdo."
    );
  }
  if (post.mediaAsset.status !== "READY" || post.mediaItems.some((item) => item.mediaAsset.status !== "READY")) {
    throw new UnrecoverableError("O arquivo de mídia não está pronto para publicação.");
  }
  if (post.trialGraduationStrategy && (
    post.mediaType !== "REEL" ||
    !post.mediaAsset.contentType.startsWith("video/") ||
    post.mediaItems.length > 1
  )) {
    throw new UnrecoverableError("Um Reel de teste precisa conter apenas um vídeo.");
  }

  const accessToken = decryptToken(post.instagramAccount.accessToken);
  let containerId = post.containerId;
  if (!containerId) {
    try {
      let container: { id: string };
      if (post.mediaType === "CAROUSEL") {
        if (post.mediaItems.length < 2 || post.mediaItems.length > 10) {
          throw new UnrecoverableError("O carrossel precisa ter de 2 a 10 mídias.");
        }
        const itemContainerIds: string[] = [];
        for (const item of post.mediaItems) {
          let itemContainerId = item.containerId;
          if (!itemContainerId) {
            const createdItem = await createInstagramCarouselItemContainer(
              accessToken,
              post.instagramAccount.instagramId,
              {
                mediaUrl: getMediaPublicUrl(item.mediaAsset.id),
                mediaType: item.mediaAsset.contentType === "image/jpeg" ? "IMAGE" : "VIDEO",
              }
            );
            itemContainerId = createdItem.id;
            await prisma.scheduledPostMediaItem.update({
              where: { id: item.id },
              data: { containerId: itemContainerId },
            });
          }
          itemContainerIds.push(itemContainerId);
        }

        for (let attempt = 0; attempt < MAX_CONTAINER_POLLS; attempt += 1) {
          const statuses = await Promise.all(itemContainerIds.map((id) => getInstagramMediaContainerStatus(accessToken, id)));
          const failedIndex = statuses.findIndex((status) => status.status_code === "ERROR" || status.status_code === "EXPIRED");
          if (failedIndex >= 0) {
            await prisma.scheduledPostMediaItem.update({
              where: { id: post.mediaItems[failedIndex].id },
              data: { containerId: null },
            });
            throw new UnrecoverableError(
              statuses[failedIndex].status || `A Meta não conseguiu processar um item do carrossel (${statuses[failedIndex].status_code}).`
            );
          }
          if (statuses.every((status) => status.status_code === "FINISHED")) break;
          if (attempt === MAX_CONTAINER_POLLS - 1) {
            throw new Error("A Meta ainda está processando as mídias do carrossel. A publicação será tentada novamente.");
          }
          await pause(CONTAINER_POLL_INTERVAL_MS);
        }

        container = await createInstagramCarouselContainer(
          accessToken,
          post.instagramAccount.instagramId,
          { childContainerIds: itemContainerIds, caption: post.caption }
        );
      } else {
        container = await createInstagramMediaContainer(
          accessToken,
          post.instagramAccount.instagramId,
          {
            mediaUrl: getMediaPublicUrl(post.mediaAsset.id),
            mediaType: post.mediaType,
            caption: post.caption,
            shareToFeed: post.shareToFeed,
            trialGraduationStrategy: post.trialGraduationStrategy,
          }
        );
      }
      containerId = container.id;
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { containerId, publishStartedAt: null },
      });
    } catch (error) {
      if (error instanceof PermissionError) {
        const failure = classifyInstagramPublishError(error.code, error.message);
        if (failure.permissionRevoked) {
          await prisma.instagramAccount.updateMany({
            where: { id: post.instagramAccountId },
            data: { publishingPermissionGranted: false },
          });
        }
        throw new UnrecoverableError(failure.message);
      }
      if (error instanceof MetaApiError && !(error.code === 4 || error.code === 17 || error.code === 368)) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }

  let containerStatus: Awaited<ReturnType<typeof getInstagramMediaContainerStatus>> | null = null;
  for (let attempt = 0; attempt < MAX_CONTAINER_POLLS; attempt += 1) {
    containerStatus = await getInstagramMediaContainerStatus(accessToken, containerId);
    if (containerStatus.status_code === "FINISHED") break;
    if (containerStatus.status_code === "PUBLISHED") {
      const mediaId = await recoverPublishedMediaId(
        accessToken,
        post.caption,
        post.mediaType,
        post.publishStartedAt ?? post.scheduledAt
      ).catch(() => null);
      const permalink = mediaId
        ? await getInstagramMediaPermalink(accessToken, mediaId)
            .then((media) => media.permalink ?? null)
            .catch(() => null)
        : null;
      await finishPublishedPost(post, mediaId, permalink);
      return;
    }
    if (containerStatus.status_code === "ERROR" || containerStatus.status_code === "EXPIRED") {
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { containerId: null, publishStartedAt: null },
      });
      throw new UnrecoverableError(
        containerStatus.status || `A Meta não conseguiu processar o arquivo (${containerStatus.status_code}).`
      );
    }
    await pause(CONTAINER_POLL_INTERVAL_MS);
  }

  if (containerStatus?.status_code !== "FINISHED") {
    throw new Error("A Meta ainda está processando o vídeo. A publicação será tentada novamente.");
  }

  const publishAt = post.scheduledAt.getTime();
  if (publishAt > Date.now() + 1_000) {
    if (!token) throw new Error("Não foi possível adiar a publicação até o horário escolhido.");
    await job.moveToDelayed(publishAt, token);
    throw new DelayedError();
  }

  let instagramMediaId: string;
  try {
    await prisma.scheduledPost.updateMany({
      where: { id: post.id, status: "PUBLISHING", publishStartedAt: null },
      data: { publishStartedAt: new Date() },
    });
    const published = await publishInstagramMediaContainer(
      accessToken,
      post.instagramAccount.instagramId,
      containerId
    );
    instagramMediaId = published.id;
  } catch (error) {
    if (error instanceof PermissionError) {
      const failure = classifyInstagramPublishError(error.code, error.message);
      if (failure.permissionRevoked) {
        await prisma.instagramAccount.updateMany({
          where: { id: post.instagramAccountId },
          data: { publishingPermissionGranted: false },
        });
      }
      throw new UnrecoverableError(failure.message);
    }

    // A timeout can happen after Meta has accepted the publish request. Reuse
    // the same container on retry and check its state before another publish.
    if (error instanceof MetaApiError && !(error.code === 4 || error.code === 17 || error.code === 368)) {
      const status = await getInstagramMediaContainerStatus(accessToken, containerId).catch(() => null);
      if (status?.status_code === "PUBLISHED") {
        const mediaId = await recoverPublishedMediaId(
          accessToken,
          post.caption,
          post.mediaType,
          post.publishStartedAt ?? new Date()
        ).catch(() => null);
        const permalink = mediaId
          ? await getInstagramMediaPermalink(accessToken, mediaId)
              .then((media) => media.permalink ?? null)
              .catch(() => null)
          : null;
        await finishPublishedPost(post, mediaId, permalink);
        return;
      }
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }

  const permalink = await getInstagramMediaPermalink(accessToken, instagramMediaId)
    .then((media) => media.permalink ?? null)
    .catch((error) => {
      console.warn("[Post Publisher] Couldn't load the new media permalink:", errorMessage(error));
      return null;
    });
  await finishPublishedPost(post, instagramMediaId, permalink);
}

export function createScheduledPostWorker(): Worker<PublishScheduledPostJob> {
  const worker = new Worker<PublishScheduledPostJob>(
    SCHEDULED_POST_QUEUE_NAME,
    processScheduledPost,
    {
      connection: getRedisConnection(),
      concurrency: 2,
      lockDuration: 60_000,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[Post Publisher] Scheduled post ${job.data.scheduledPostId} completed`);
  });

  worker.on("failed", (job, error) => {
    if (!job) return;
    console.error(
      `[Post Publisher] Scheduled post ${job.data.scheduledPostId} failed (attempt ${job.attemptsMade}):`,
      error.message
    );

    if (error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void prisma.scheduledPost.updateMany({
        where: {
          id: job.data.scheduledPostId,
          status: { in: ["SCHEDULED", "PUBLISHING"] },
        },
        data: { status: "FAILED", lastError: error.message.slice(0, 2_000) },
      });
    }
  });

  worker.on("error", (error) => {
    console.error("[Post Publisher] Worker error:", error.message);
  });

  return worker;
}
