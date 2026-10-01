import { Job, Queue } from "bullmq";
import { rm } from "node:fs/promises";
import { prisma } from "@/lib/db/client";
import { getRedisConnection } from "@/lib/queue/client";
import {
  acquireMediaUploadLock,
  getMediaStoragePath,
  getMediaUploadLockPath,
} from "@/lib/media-assets";

export const SCHEDULED_POST_QUEUE_NAME = "scheduled-post-publishing";
export const SCHEDULED_POST_JOB_PREFIX = "scheduled-post-";
export const SCHEDULED_POST_PREPUBLISH_LEAD_MS = 15 * 60 * 1000;
const MAX_DELAY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface PublishScheduledPostJob {
  scheduledPostId: string;
  scheduledAt: string;
}

let scheduledPostQueue: Queue<PublishScheduledPostJob> | null = null;

export function getScheduledPostQueue(): Queue<PublishScheduledPostJob> {
  if (!scheduledPostQueue) {
    scheduledPostQueue = new Queue<PublishScheduledPostJob>(
      SCHEDULED_POST_QUEUE_NAME,
      {
        connection: getRedisConnection(),
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { age: 60 * 60 * 24 * 7, count: 1_000 },
        },
      }
    );
  }
  return scheduledPostQueue;
}

export function getScheduledPostJobId(id: string): string {
  return `${SCHEDULED_POST_JOB_PREFIX}${id}`;
}

export async function queueScheduledPost(
  id: string,
  scheduledAt: Date,
  replace = false
): Promise<{ queued: boolean; deferred: boolean; active: boolean }> {
  const queue = getScheduledPostQueue();
  const jobId = getScheduledPostJobId(id);
  const existing = await queue.getJob(jobId);
  const scheduledAtIso = scheduledAt.toISOString();
  const prepareAt = new Date(scheduledAt.getTime() - SCHEDULED_POST_PREPUBLISH_LEAD_MS);

  if (existing) {
    const state = await existing.getState();
    if (state === "active") return { queued: true, deferred: false, active: true };
    if (!replace && existing.data.scheduledAt === scheduledAtIso && state !== "failed") {
      return { queued: true, deferred: false, active: false };
    }
    await existing.remove();
  }

  const delay = prepareAt.getTime() - Date.now();
  if (delay > MAX_DELAY_WINDOW_MS) {
    return { queued: false, deferred: true, active: false };
  }

  await queue.add(
    "publish-scheduled-post",
    { scheduledPostId: id, scheduledAt: scheduledAtIso },
    { jobId, delay: Math.max(0, delay) }
  );
  return { queued: true, deferred: false, active: false };
}

export async function removeScheduledPostJob(id: string): Promise<boolean> {
  const job = await getScheduledPostQueue().getJob(getScheduledPostJobId(id));
  if (!job) return true;
  if ((await job.getState()) === "active") return false;
  await job.remove();
  return true;
}

async function cleanupAbandonedMediaUploads(): Promise<void> {
  const expiredBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const assets = await prisma.mediaAsset.findMany({
    where: { status: "UPLOADING", updatedAt: { lt: expiredBefore } },
    select: { id: true, storageKey: true },
    take: 100,
  });

  for (const asset of assets) {
    const lock = await acquireMediaUploadLock(asset.storageKey);
    if (!lock) continue;
    try {
      const deleted = await prisma.mediaAsset.deleteMany({
        where: { id: asset.id, status: "UPLOADING", updatedAt: { lt: expiredBefore } },
      });
      if (deleted.count === 1) {
        await rm(getMediaStoragePath(asset.storageKey), { force: true });
      }
    } finally {
      await lock.close().catch(() => {});
      await rm(getMediaUploadLockPath(asset.storageKey), { force: true }).catch(() => {});
    }
  }
}

/**
 * PostgreSQL is the source of truth. This reconciler repairs the small window
 * between saving a schedule and adding its Redis job, and only enqueues posts
 * within 24 hours so far-future dates do not consume delayed-job capacity.
 */
export async function syncScheduledPostsWithQueue(): Promise<void> {
  try {
    await cleanupAbandonedMediaUploads();
  } catch (error) {
    console.error("[Scheduled Posts] Failed to clean abandoned media uploads:", error);
  }
  const queue = getScheduledPostQueue();
  const posts = await prisma.scheduledPost.findMany({
    where: {
      status: { in: ["SCHEDULED", "PUBLISHING"] },
      scheduledAt: { not: null },
    },
    select: { id: true, scheduledAt: true },
    orderBy: { scheduledAt: "asc" },
    take: 1_000,
  });
  const now = Date.now();

  for (const post of posts) {
    if (!post.scheduledAt) continue;
    const jobId = getScheduledPostJobId(post.id);
    const existing = await queue.getJob(jobId);
    const state = existing ? await existing.getState() : null;
    if (state === "active") continue;

    if (state === "failed") {
      await prisma.scheduledPost.updateMany({
        where: { id: post.id, status: { in: ["SCHEDULED", "PUBLISHING"] } },
        data: {
          status: "FAILED",
          lastError: existing?.failedReason || "A tentativa de publicação falhou.",
        },
      });
      continue;
    }

    const prepareAt = post.scheduledAt.getTime() - SCHEDULED_POST_PREPUBLISH_LEAD_MS;
    if (prepareAt - now > MAX_DELAY_WINDOW_MS) {
      if (existing) await existing.remove();
      continue;
    }

    await queueScheduledPost(post.id, post.scheduledAt, false);
  }
}

export type ScheduledPostQueueJob = Job<PublishScheduledPostJob>;
