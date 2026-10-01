import { DelayedError, Job, UnrecoverableError, Worker } from "bullmq";
import { prisma } from "@/lib/db/client";
import {
  createFacebookInstagramStoryContainer,
  getActiveFacebookInstagramStories,
  getFacebookInstagramStoryContainerStatus,
  MetaApiError,
  PermissionError,
  publishFacebookInstagramStoryContainer,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getMediaPublicUrl } from "@/lib/media-assets";
import { resolveStoryPublishingPage } from "@/lib/instagram-stories/page-link";
import { getRedisConnection } from "@/lib/queue/client";
import {
  PublishStorySequenceJob,
  STORY_SEQUENCE_PREPUBLISH_LEAD_MS,
  STORY_SEQUENCE_QUEUE_NAME,
} from "@/lib/queue/story-sequences";

const CONTAINER_POLL_INTERVAL_MS = 10_000;
const MAX_CONTAINER_POLLS = 30;

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Falha desconhecida ao publicar Stories.";
}

function normalizeStoryError(error: unknown): Error {
  if (error instanceof PermissionError) {
    if (/business.{0,40}stories|stories.{0,40}business|only.{0,30}business|business account/i.test(error.message)) {
      return new UnrecoverableError(
        "A publicação automática de Stories exige uma conta Business do Instagram. Converta a conta ou selecione uma conta Business."
      );
    }
    return new UnrecoverableError(
      "A Meta recusou a publicação do Story. Confirme a permissão de publicar conteúdo e se a conta está qualificada para Stories."
    );
  }
  if (error instanceof MetaApiError && ![4, 17, 368].includes(error.code)) {
    return new UnrecoverableError(error.message);
  }
  return error instanceof Error ? error : new Error(errorMessage(error));
}

async function recoverPublishedStoryId(
  accessToken: string,
  instagramAccountId: string,
  since: Date
): Promise<string | null> {
  const stories = await getActiveFacebookInstagramStories(accessToken, instagramAccountId);
  const earliest = since.getTime() - 2 * 60 * 1000;
  const candidates = stories
    .filter((story) => Date.parse(story.timestamp) >= earliest)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return candidates[0]?.id ?? null;
}

async function markSlidePublished(slideId: string, instagramMediaId: string | null) {
  await prisma.storySlide.update({
    where: { id: slideId },
    data: {
      status: "PUBLISHED",
      instagramMediaId,
      publishedAt: new Date(),
      publishStartedAt: null,
      lastError: instagramMediaId
        ? null
        : "Publicado no Instagram. A Meta não retornou o identificador do Story.",
    },
  });
}

async function processStorySequence(
  job: Job<PublishStorySequenceJob>,
  token?: string
): Promise<void> {
  const { storySequenceId, scheduledAt } = job.data;
  const sequence = await prisma.storySequence.findUnique({
    where: { id: storySequenceId },
    include: {
      instagramAccount: true,
      slides: {
        orderBy: { position: "asc" },
        include: { mediaAsset: true },
      },
    },
  });

  if (!sequence || !["SCHEDULED", "PUBLISHING"].includes(sequence.status)) return;
  if (!sequence.scheduledAt || sequence.scheduledAt.toISOString() !== scheduledAt) return;
  if (sequence.scheduledAt.getTime() > Date.now() + STORY_SEQUENCE_PREPUBLISH_LEAD_MS + 60_000) return;

  if (sequence.status === "SCHEDULED") {
    const claimed = await prisma.storySequence.updateMany({
      where: {
        id: sequence.id,
        status: "SCHEDULED",
        scheduledAt: new Date(scheduledAt),
      },
      data: { status: "PUBLISHING", attempts: { increment: 1 }, lastError: null },
    });
    if (claimed.count !== 1) return;
  } else {
    await prisma.storySequence.update({
      where: { id: sequence.id },
      data: { attempts: { increment: 1 } },
    });
  }

  if (sequence.slides.length === 0) {
    throw new UnrecoverableError("Adicione pelo menos um arquivo à sequência de Stories.");
  }
  if (sequence.slides.some((slide) => slide.mediaAsset.status !== "READY")) {
    throw new UnrecoverableError("Um dos arquivos da sequência ainda não está pronto para publicação.");
  }

  const page = await resolveStoryPublishingPage(sequence.workspaceId, sequence.instagramAccountId);
  if (!page) {
    throw new UnrecoverableError(
      "Para publicar Stories, conecte em Configurações a Página do Facebook vinculada a uma conta Business do Instagram."
    );
  }
  const accessToken = decryptToken(page.accessToken);
  let activeSlideId: string | null = null;

  try {
    for (const slide of sequence.slides) {
      activeSlideId = slide.id;
      if (slide.status === "PUBLISHED") continue;

      let containerId = slide.containerId;
      if (!containerId) {
        const created = await createFacebookInstagramStoryContainer(
          accessToken,
          sequence.instagramAccount.instagramId,
          {
            mediaUrl: getMediaPublicUrl(slide.mediaAsset.id),
            mediaType: slide.mediaAsset.contentType === "image/jpeg" ? "IMAGE" : "VIDEO",
          }
        );
        containerId = created.id;
        await prisma.storySlide.update({
          where: { id: slide.id },
          data: { containerId, status: "PUBLISHING", lastError: null },
        });
      }

      let containerStatus: Awaited<ReturnType<typeof getFacebookInstagramStoryContainerStatus>> | null = null;
      for (let attempt = 0; attempt < MAX_CONTAINER_POLLS; attempt += 1) {
        containerStatus = await getFacebookInstagramStoryContainerStatus(accessToken, containerId);
        if (containerStatus.status_code === "FINISHED") break;

        if (containerStatus.status_code === "PUBLISHED") {
          const mediaId = await recoverPublishedStoryId(
            accessToken,
            sequence.instagramAccount.instagramId,
            slide.publishStartedAt ?? sequence.scheduledAt
          ).catch(() => null);
          await markSlidePublished(slide.id, mediaId);
          containerId = null;
          break;
        }

        if (containerStatus.status_code === "ERROR" || containerStatus.status_code === "EXPIRED") {
          await prisma.storySlide.update({
            where: { id: slide.id },
            data: { containerId: null, status: "PENDING" },
          });
          throw new UnrecoverableError(
            containerStatus.status || `A Meta não conseguiu processar o Story (${containerStatus.status_code}).`
          );
        }

        if (attempt === MAX_CONTAINER_POLLS - 1) {
          throw new Error("A Meta ainda está processando este Story. A publicação será retomada automaticamente.");
        }
        await pause(CONTAINER_POLL_INTERVAL_MS);
      }

      if (containerId === null) continue;
      if (containerStatus?.status_code !== "FINISHED") {
        throw new Error("A Meta ainda está processando este Story. A publicação será retomada automaticamente.");
      }

      if (sequence.scheduledAt.getTime() > Date.now() + 1_000) {
        if (!token) throw new Error("Não foi possível aguardar o horário escolhido para publicar Stories.");
        await job.moveToDelayed(sequence.scheduledAt.getTime(), token);
        throw new DelayedError();
      }

      await prisma.storySlide.updateMany({
        where: { id: slide.id, status: { not: "PUBLISHED" } },
        data: { status: "PUBLISHING", publishStartedAt: new Date() },
      });

      let publishedId: string;
      try {
        const published = await publishFacebookInstagramStoryContainer(
          accessToken,
          sequence.instagramAccount.instagramId,
          containerId
        );
        publishedId = published.id;
      } catch (error) {
        const status = await getFacebookInstagramStoryContainerStatus(accessToken, containerId).catch(() => null);
        if (status?.status_code === "PUBLISHED") {
          const mediaId = await recoverPublishedStoryId(
            accessToken,
            sequence.instagramAccount.instagramId,
            slide.publishStartedAt ?? new Date()
          ).catch(() => null);
          await markSlidePublished(slide.id, mediaId);
          continue;
        }
        throw normalizeStoryError(error);
      }

      await markSlidePublished(slide.id, publishedId);
    }
  } catch (error) {
    const publishError = normalizeStoryError(error);
    if (!(publishError instanceof DelayedError) && activeSlideId) {
      await prisma.storySlide.updateMany({
        where: { id: activeSlideId, status: { not: "PUBLISHED" } },
        data: { status: "FAILED", lastError: publishError.message.slice(0, 2_000) },
      }).catch((recordError) => {
        console.error("[Story Publisher] Could not record slide failure:", errorMessage(recordError));
      });
    }
    throw publishError;
  }

  await prisma.storySequence.update({
    where: { id: sequence.id },
    data: { status: "PUBLISHED", publishedAt: new Date(), lastError: null },
  });
}

async function finalizeFailedSequence(job: Job<PublishStorySequenceJob>, error: Error) {
  const sequence = await prisma.storySequence.findUnique({
    where: { id: job.data.storySequenceId },
    select: { id: true },
  });
  if (!sequence) return;

  const publishedCount = await prisma.storySlide.count({
    where: { sequenceId: sequence.id, status: "PUBLISHED" },
  });
  await prisma.storySlide.updateMany({
    where: { sequenceId: sequence.id, status: { not: "PUBLISHED" } },
    data: { status: "FAILED", lastError: error.message.slice(0, 2_000) },
  });
  await prisma.storySequence.updateMany({
    where: { id: sequence.id, status: { in: ["SCHEDULED", "PUBLISHING"] } },
    data: {
      status: publishedCount > 0 ? "PARTIAL" : "FAILED",
      lastError: error.message.slice(0, 2_000),
    },
  });
}

export function createStorySequenceWorker(): Worker<PublishStorySequenceJob> {
  const worker = new Worker<PublishStorySequenceJob>(
    STORY_SEQUENCE_QUEUE_NAME,
    processStorySequence,
    {
      connection: getRedisConnection(),
      concurrency: 1,
      lockDuration: 60_000,
    }
  );

  worker.on("ready", () => console.log("[Story Publisher] Worker ready"));

  worker.on("completed", (job) => {
    console.log(`[Story Publisher] Sequence ${job.data.storySequenceId} completed`);
  });

  worker.on("failed", (job, error) => {
    if (!job) return;
    console.error(
      `[Story Publisher] Sequence ${job.data.storySequenceId} failed (attempt ${job.attemptsMade}):`,
      error.message
    );
    if (error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void finalizeFailedSequence(job, error).catch((recordError) => {
        console.error("[Story Publisher] Could not finalize failed sequence:", errorMessage(recordError));
      });
    }
  });

  worker.on("error", (error) => {
    console.error("[Story Publisher] Worker error:", error.message);
  });

  return worker;
}
