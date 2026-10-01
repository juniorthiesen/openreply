import { Job, Queue } from "bullmq";
import { prisma } from "@/lib/db/client";
import { getRedisConnection } from "@/lib/queue/client";

export const STORY_SEQUENCE_QUEUE_NAME = "instagram-story-sequences";
export const STORY_SEQUENCE_PREPUBLISH_LEAD_MS = 2 * 60 * 1000;
const STORY_SEQUENCE_JOB_PREFIX = "story-sequence-";
const MAX_DELAY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface PublishStorySequenceJob {
  storySequenceId: string;
  scheduledAt: string;
}

let storySequenceQueue: Queue<PublishStorySequenceJob> | null = null;

export function getStorySequenceQueue(): Queue<PublishStorySequenceJob> {
  if (!storySequenceQueue) {
    storySequenceQueue = new Queue<PublishStorySequenceJob>(
      STORY_SEQUENCE_QUEUE_NAME,
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
  return storySequenceQueue;
}

function getStorySequenceJobId(id: string): string {
  return `${STORY_SEQUENCE_JOB_PREFIX}${id}`;
}

export async function queueStorySequence(
  id: string,
  scheduledAt: Date,
  replace = false
): Promise<{ queued: boolean; deferred: boolean; active: boolean }> {
  const queue = getStorySequenceQueue();
  const jobId = getStorySequenceJobId(id);
  const scheduledAtIso = scheduledAt.toISOString();
  const prepareAt = new Date(scheduledAt.getTime() - STORY_SEQUENCE_PREPUBLISH_LEAD_MS);
  const existing = await queue.getJob(jobId);

  if (existing) {
    const state = await existing.getState();
    if (state === "active") return { queued: true, deferred: false, active: true };
    if (!replace && existing.data.scheduledAt === scheduledAtIso && state !== "failed") {
      return { queued: true, deferred: false, active: false };
    }
    await existing.remove();
  }

  const delay = prepareAt.getTime() - Date.now();
  if (delay > MAX_DELAY_WINDOW_MS) return { queued: false, deferred: true, active: false };

  await queue.add(
    "publish-story-sequence",
    { storySequenceId: id, scheduledAt: scheduledAtIso },
    { jobId, delay: Math.max(0, delay) }
  );
  return { queued: true, deferred: false, active: false };
}

export async function removeStorySequenceJob(id: string): Promise<boolean> {
  const job = await getStorySequenceQueue().getJob(getStorySequenceJobId(id));
  if (!job) return true;
  if ((await job.getState()) === "active") return false;
  await job.remove();
  return true;
}

/** PostgreSQL is authoritative; this repairs queue inserts and far-future schedules. */
export async function syncStorySequencesWithQueue(): Promise<void> {
  const queue = getStorySequenceQueue();
  const sequences = await prisma.storySequence.findMany({
    where: {
      status: { in: ["SCHEDULED", "PUBLISHING"] },
      scheduledAt: { not: null },
    },
    select: { id: true, scheduledAt: true },
    orderBy: { scheduledAt: "asc" },
    take: 500,
  });
  const now = Date.now();

  for (const sequence of sequences) {
    if (!sequence.scheduledAt) continue;
    const jobId = getStorySequenceJobId(sequence.id);
    const existing = await queue.getJob(jobId);
    const state = existing ? await existing.getState() : null;
    if (state === "active") continue;

    if (state === "failed") {
      const publishedCount = await prisma.storySlide.count({
        where: { sequenceId: sequence.id, status: "PUBLISHED" },
      });
      await prisma.storySequence.updateMany({
        where: { id: sequence.id, status: { in: ["SCHEDULED", "PUBLISHING"] } },
        data: {
          status: publishedCount > 0 ? "PARTIAL" : "FAILED",
          lastError: existing?.failedReason || "A publicação da sequência falhou.",
        },
      });
      continue;
    }

    const prepareAt = sequence.scheduledAt.getTime() - STORY_SEQUENCE_PREPUBLISH_LEAD_MS;
    if (prepareAt - now > MAX_DELAY_WINDOW_MS) {
      if (existing) await existing.remove();
      continue;
    }
    await queueStorySequence(sequence.id, sequence.scheduledAt, false);
  }
}

export type StorySequenceQueueJob = Job<PublishStorySequenceJob>;
