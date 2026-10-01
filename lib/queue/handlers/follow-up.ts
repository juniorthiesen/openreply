import type { Job } from "bullmq";
import type { ProcessFollowUpJob } from "../client";
import { prisma } from "@/lib/db/client";
import { sendDirectMessage } from "@/lib/meta/client";
import { renderMessageWithoutLink } from "@/lib/tracking/message";
import { formatError, resolveAccessToken } from "./shared";

/**
 * Send the scheduled appreciation follow-up. Runs after its delay elapses.
 * Best-effort: if the message can't be delivered (e.g. the 24-hour messaging
 * window closed because the delay was long), it is logged, not retried forever.
 */
export async function processFollowUp(job: Job<ProcessFollowUpJob>): Promise<void> {
  const { instagramAccountId, userId, automationId, commenterName } = job.data;

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true },
    include: { instagramAccount: true },
  });

  if (
    !automation ||
    !automation.followUpEnabled ||
    !automation.followUpMessage?.trim() ||
    automation.instagramAccount.instagramId !== instagramAccountId
  ) {
    return;
  }

  const auth = resolveAccessToken(automation.instagramAccount.accessToken);
  if ("error" in auth) return;

  try {
    await sendDirectMessage(
      auth.token,
      automation.instagramAccount.instagramId,
      userId,
      renderMessageWithoutLink({
        message: automation.followUpMessage,
        commenterName: commenterName ?? null,
      })
    );
  } catch (error) {
    console.log(
      "[DM Worker] Failed to send follow-up message:",
      formatError(error)
    );
  }
}
