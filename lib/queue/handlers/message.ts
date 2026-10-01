import type { Job } from "bullmq";
import type { ProcessMessageJob } from "../client";
import { prisma } from "@/lib/db/client";
import { getUserFollowStatus } from "@/lib/meta/client";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";
import {
  AUTOMATION_INCLUDE,
  DM_TRIGGER_FOLLOW_PROMPT_DEFAULTS,
  directMessageChannel,
  dmLogWhere,
  formatError,
  matchAutomation,
  resolveAccessToken,
  scheduleFollowUp,
  sendFollowPrompt,
  sendLinkMessage,
} from "./shared";

/**
 * Reply to an inbound DM whose text matches a campaign's keywords.
 *
 * The user has messaged us, so the conversation is already open: this path
 * skips the opening DM (which exists to work around private-reply limits from
 * comments) and delivers the reveal directly, honouring the follow gate.
 * Dedup is per inbound message id, so each message triggers at most one reply.
 */
export async function processMessage(job: Job<ProcessMessageJob>): Promise<void> {
  const { instagramAccountId, messageId, messageText, senderId } = job.data;
  const attempts = job.attemptsMade + 1;

  const automations = await prisma.automation.findMany({
    where: {
      dmTriggerEnabled: true,
      isActive: true,
      instagramAccount: { instagramId: instagramAccountId },
    },
    include: AUTOMATION_INCLUDE,
    orderBy: { createdAt: "asc" },
  });

  const dedupeId = `dm:${messageId}`;

  for (const automation of automations) {
    const matchResult = matchAutomation(automation, messageText);
    if (!matchResult.matched) continue;

    const where = dmLogWhere(automation.id, dedupeId);
    const existingLog = await prisma.dmLog.findUnique({ where });

    // Already replied to this message (or deliberately skipped it) — a retry
    // of the job must not send a second DM.
    if (
      existingLog?.status === "SENT" ||
      existingLog?.status === "SKIPPED_PLAN_LIMIT"
    ) {
      continue;
    }

    const logBase = {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      instagramAccountId: automation.instagramAccountId,
      commenterId: senderId,
      commentText: messageText,
      commentId: dedupeId,
      matchedKeyword: matchResult.matchedKeyword,
    };

    const auth = resolveAccessToken(automation.instagramAccount.accessToken);
    if ("error" in auth) {
      await prisma.dmLog.upsert({
        where,
        create: { ...logBase, status: "FAILED", errorMessage: auth.error },
        update: { status: "FAILED", errorMessage: auth.error },
      });
      continue;
    }
    const accessToken = auth.token;

    // Reuse a name captured on an earlier interaction so {username} still
    // renders — the messages webhook carries only the sender's IGSID.
    const priorLog = await prisma.dmLog.findFirst({
      where: { automationId: automation.id, commenterId: senderId },
      select: { commenterName: true },
    });
    const commenterName = priorLog?.commenterName ?? null;

    // Follow gate: anyone not confirmed as a follower gets the prompt instead of
    // the link, with the same `followcheck:` button that re-verifies on tap.
    // `null` (unverifiable) prompts too — this is first contact, exactly like a
    // comment, so it follows processComment's fail-closed rule rather than the
    // postback path's fail-open one. Fail-open is only safe after a tap, where
    // the user has already claimed to follow; here it would hand the link to
    // anyone whose status the API happens not to resolve.
    let promptForFollow = false;
    if (automation.requireFollow) {
      const follows = await getUserFollowStatus(accessToken, senderId);
      promptForFollow = follows !== true;
    }

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      const errorMessage = `Monthly DM limit reached (${usage.limit})`;
      await prisma.dmLog.upsert({
        where,
        create: { ...logBase, status: "SKIPPED_PLAN_LIMIT", errorMessage },
        update: { status: "SKIPPED_PLAN_LIMIT", errorMessage },
      });
      continue;
    }

    const channel = directMessageChannel(
      accessToken,
      automation.instagramAccount.instagramId,
      senderId
    );

    try {
      if (promptForFollow) {
        await sendFollowPrompt(
          channel,
          automation,
          commenterName,
          DM_TRIGGER_FOLLOW_PROMPT_DEFAULTS
        );
      } else {
        await sendLinkMessage(channel, automation, commenterName, "message trigger");
        // The link has been delivered, so the appreciation follow-up applies
        // here exactly as it does after a button tap. Not scheduled behind the
        // follow prompt — no link went out yet in that branch.
        await scheduleFollowUp(automation, senderId, commenterName);
      }

      await prisma.dmLog.upsert({
        where,
        create: { ...logBase, commenterName, status: "SENT", dmSentAt: new Date() },
        update: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
      });
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      const errorMessage = formatError(error);
      await prisma.dmLog.upsert({
        where,
        create: { ...logBase, commenterName, status: "FAILED", attempts, errorMessage },
        update: { status: "FAILED", attempts, errorMessage },
      });
      throw error;
    }
  }
}
