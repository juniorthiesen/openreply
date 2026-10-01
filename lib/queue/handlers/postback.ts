import type { Job } from "bullmq";
import type { ProcessPostbackJob } from "../client";
import { prisma } from "@/lib/db/client";
import { getUserFollowStatus } from "@/lib/meta/client";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";
import {
  AUTOMATION_INCLUDE,
  FOLLOW_PROMPT_DEFAULTS,
  directMessageChannel,
  dmLogWhere,
  formatError,
  resolveAccessToken,
  scheduleFollowUp,
  sendFollowPrompt,
  sendLinkMessage,
} from "./shared";

/**
 * Deliver the reveal message after a user taps an opening DM's button.
 * The postback payload is `reveal:<automationId>`; the sender is the user's
 * IGSID (same id as their comment author id), which we DM directly.
 */
export async function processPostback(job: Job<ProcessPostbackJob>): Promise<void> {
  const { instagramAccountId, userId, payload, fallback } = job.data;

  const isFollowCheck = payload.startsWith("followcheck:");
  if (!isFollowCheck && !payload.startsWith("reveal:")) return;
  const automationId = payload.slice(
    isFollowCheck ? "followcheck:".length : "reveal:".length
  );

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true },
    include: AUTOMATION_INCLUDE,
  });

  if (
    !automation ||
    automation.instagramAccount.instagramId !== instagramAccountId ||
    !automation.instagramAccount.accessToken
  ) {
    return;
  }

  // Duplicate sends are enabled: every button tap re-sends the reveal
  // instead of only firing once per person.
  const dedupeId = `reveal:${userId}`;
  const where = dmLogWhere(automation.id, dedupeId);

  if (fallback) {
    const existingReveal = await prisma.dmLog.findUnique({ where });
    if (existingReveal?.status === "SENT") return;
  }

  // Personalize {username} from the opening DM log for this user, if present.
  const openingLog = await prisma.dmLog.findFirst({
    where: { automationId: automation.id, commenterId: userId },
    select: { commenterName: true },
  });
  const commenterName = openingLog?.commenterName ?? null;

  const auth = resolveAccessToken(automation.instagramAccount.accessToken);
  if ("error" in auth) return;
  const accessToken = auth.token;

  const channel = directMessageChannel(
    accessToken,
    automation.instagramAccount.instagramId,
    userId
  );

  // Follow-gate: before revealing the link, verify the user follows. On a
  // `followcheck:` tap a non-follower gets the prompt again (no quota spent);
  // on a read fallback a non-follower is silently skipped — the gate must not
  // be bypassable by just reading the DM and waiting. Following, or
  // unverifiable (null), falls through and delivers the link — fail-open so a
  // real follower is never trapped.
  if ((isFollowCheck || fallback) && automation.requireFollow) {
    const follows = await getUserFollowStatus(accessToken, userId);
    if (follows === false) {
      if (fallback) return;
      try {
        await sendFollowPrompt(
          channel,
          automation,
          commenterName,
          FOLLOW_PROMPT_DEFAULTS
        );
      } catch (error) {
        console.log(
          "[DM Worker] Failed to re-send follow prompt:",
          formatError(error)
        );
      }
      return;
    }
  }

  const logFields = {
    workspaceId: automation.workspaceId,
    automationId: automation.id,
    instagramAccountId: automation.instagramAccountId,
    commenterId: userId,
    commenterName,
    commentText: "(button tap)",
    commentId: dedupeId,
  };

  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  if (!usage.allowed) {
    await prisma.dmLog.upsert({
      where,
      create: {
        ...logFields,
        status: "SKIPPED_PLAN_LIMIT",
        errorMessage: `Monthly DM limit reached (${usage.limit})`,
      },
      update: { status: "SKIPPED_PLAN_LIMIT" },
    });
    return;
  }

  try {
    await sendLinkMessage(channel, automation, commenterName, "postback");
    await scheduleFollowUp(automation, userId, commenterName);
    await prisma.dmLog.upsert({
      where,
      create: { ...logFields, status: "SENT", dmSentAt: new Date() },
      update: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
    });
  } catch (error) {
    await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);

    // The read fallback is speculative: it only runs when the user read the
    // opening DM and never tapped the button, which means they never messaged
    // us, which means the 24-hour window is closed and Meta rejects the send
    // ("outside of allowed window"). That is the expected outcome here, not a
    // failure the user can act on — so don't log it as FAILED and don't retry
    // it against a window that cannot reopen on its own. It still delivers in
    // the case that does work: the user replied by typing instead of tapping.
    if (fallback) {
      console.log(
        "[DM Worker] Read fallback not delivered (messaging window closed):",
        formatError(error)
      );
      return;
    }

    await prisma.dmLog.upsert({
      where,
      create: { ...logFields, status: "FAILED", errorMessage: formatError(error) },
      update: { status: "FAILED", errorMessage: formatError(error) },
    });
    throw error;
  }
}
