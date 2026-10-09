import { createDMWorker } from "@/lib/queue/dm-worker";
import { createScheduledPostWorker } from "@/lib/queue/scheduled-post-worker";
import { syncScheduledPostsWithQueue } from "@/lib/queue/scheduled-posts";
import { createStorySequenceWorker } from "@/lib/queue/story-sequence-worker";
import { syncStorySequencesWithQueue } from "@/lib/queue/story-sequences";
import { captureRecentStoryInsights } from "@/lib/queue/story-insights";
import { captureExternalStories } from "@/lib/queue/external-story-capture";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import { attachPendingNextReels } from "@/lib/automation/attach-next-reel";
import os from "node:os";

const worker = createDMWorker();
const scheduledPostWorker = createScheduledPostWorker();
const storySequenceWorker = createStorySequenceWorker();
const startedAt = new Date().toISOString();
const HEARTBEAT_INTERVAL_MS = 30_000;
const SCHEDULE_RECONCILE_INTERVAL_MS = 60_000;
const STORY_METRICS_INTERVAL_MS = 15 * 60_000;
// Polling safety net for comments that webhooks miss. Runs in the worker because
// it must fire every few minutes and Vercel's free crons only run once a day.
const POLL_INTERVAL_MS = Number(
  process.env.COMMENT_POLL_INTERVAL_MS ?? 5 * 60_000
);

console.log("[DM Worker] Started");

async function reconcileScheduledPosts() {
  try {
    await syncScheduledPostsWithQueue();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Scheduled post reconciliation failed:", message);
  }
}

async function reconcileStorySequences() {
  try { await syncStorySequencesWithQueue(); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Story sequence reconciliation failed:", message);
  }
}

async function pollStoryInsights() {
  try { await captureRecentStoryInsights(); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Story insights polling failed:", message);
  }
  try { await captureExternalStories(); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] External Stories capture failed:", message);
  }
}

void reconcileScheduledPosts();
void reconcileStorySequences();
const scheduleReconcileTimer = setInterval(
  () => void reconcileScheduledPosts(),
  SCHEDULE_RECONCILE_INTERVAL_MS
);
const storyReconcileTimer = setInterval(() => void reconcileStorySequences(), SCHEDULE_RECONCILE_INTERVAL_MS);
const storyMetricsTimer = setInterval(() => void pollStoryInsights(), STORY_METRICS_INTERVAL_MS);
setTimeout(() => void pollStoryInsights(), 20_000);

async function heartbeat() {
  try {
    await recordWorkerHeartbeat({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Heartbeat failed:", message);
  }
}

void heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

async function poll() {
  try {
    const attached = await attachPendingNextReels();
    if (attached.bound > 0 || attached.failedAccounts > 0) {
      console.log("[DM Worker] Next-reel attachment:", attached);
    }
    await reconcileComments();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Comment reconciliation failed:", message);
  }
}

// Kick off one sweep shortly after boot, then on a fixed interval.
setTimeout(() => void poll(), 10_000);
const pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);

async function shutdown(signal: string) {
  console.log(`[DM Worker] ${signal} received, closing worker`);
  clearInterval(heartbeatTimer);
  clearInterval(pollTimer);
  clearInterval(scheduleReconcileTimer);
  clearInterval(storyReconcileTimer);
  clearInterval(storyMetricsTimer);
  await Promise.all([worker.close(), scheduledPostWorker.close(), storySequenceWorker.close()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
