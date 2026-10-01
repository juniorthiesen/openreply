import type { Job } from "bullmq";
import type { Prisma } from "@/app/generated/prisma/client";
import { getDMQueue, type ProcessCommentJob } from "../client";
import { prisma } from "@/lib/db/client";
import { getUserFollowStatus, sendCommentReply } from "@/lib/meta/client";
import { reserveDMSlot } from "@/lib/utils/rate-limiter";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";
import { renderMessageWithTracking } from "@/lib/tracking/message";
import {
  AUTOMATION_INCLUDE,
  FOLLOW_PROMPT_DEFAULTS,
  dmLogWhere,
  formatError,
  matchAutomation,
  privateReplyChannel,
  resolveAccessToken,
  sendFollowPrompt,
  sendLinkMessage,
} from "./shared";

export async function processComment(job: Job<ProcessCommentJob>): Promise<void> {
  const {
    instagramAccountId,
    commentId,
    commentText,
    commenterId,
    commenterName,
    mediaId,
    originalMediaId,
  } = job.data;
  const requeueAttempt = job.data.requeueAttempt ?? 0;
  const attempts = job.attemptsMade + 1;

  const automations = await prisma.automation.findMany({
    where: {
      // Match campaigns bound to this specific post, plus any-post campaigns.
      // A comment left on an ad carries the ad's own media id, while the
      // campaign is bound to the post the ad was created from, so both ids
      // have to be considered or the comment is dropped without a trace.
      OR: [
        { postId: mediaId },
        ...(originalMediaId ? [{ postId: originalMediaId }] : []),
        { matchAnyPost: true },
      ],
      isActive: true,
      instagramAccount: {
        instagramId: instagramAccountId,
      },
    },
    include: AUTOMATION_INCLUDE,
    orderBy: { createdAt: "asc" },
  });

  for (const automation of automations) {
    const matchResult = matchAutomation(automation, commentText);
    if (!matchResult.matched) {
      continue;
    }

    const where = dmLogWhere(automation.id, commentId);
    const updateLog = (data: Prisma.DmLogUpdateInput) =>
      prisma.dmLog.update({ where, data });

    const existingLog = await prisma.dmLog.findUnique({ where });

    const alreadyDmd = existingLog?.status === "SENT";
    const alreadyPublicReplied = Boolean(existingLog?.publicReplySentAt);
    const needsDm = !alreadyDmd;

    // Skip only when there is genuinely nothing left to do. A comment whose DM
    // already sent but whose public reply never posted (e.g. it hit a rate
    // limit) must still come back so the public reply can be retried.
    if (existingLog?.status === "SKIPPED_PLAN_LIMIT") continue;
    if (alreadyDmd && (alreadyPublicReplied || !automation.publicReplyEnabled)) {
      continue;
    }

    const logFields = {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      instagramAccountId: automation.instagramAccountId,
      commenterId,
      commenterName,
      commentText,
      commentId,
      matchedKeyword: matchResult.matchedKeyword,
    };

    const auth = resolveAccessToken(automation.instagramAccount.accessToken);
    if ("error" in auth) {
      await prisma.dmLog.upsert({
        where,
        create: { ...logFields, status: "FAILED", errorMessage: auth.error },
        update: { status: "FAILED", errorMessage: auth.error },
      });
      continue;
    }
    const accessToken = auth.token;

    // Ensure a log row exists before the public reply leg (which updates it).
    // Only (re)set PENDING when the DM will actually be attempted, so a prior
    // SENT is never clobbered while we come back just to retry the public reply.
    if (!existingLog) {
      await prisma.dmLog.create({
        data: { ...logFields, status: "PENDING", attempts },
      });
    } else if (needsDm) {
      await updateLog({
        status: "PENDING",
        attempts,
        matchedKeyword: matchResult.matchedKeyword,
        errorMessage: null,
      });
    }

    // Public reply leg — decoupled from the DM and posted first so a DM failure
    // (e.g. a non-follower whose messaging is restricted) never suppresses it.
    // Idempotent across retries via publicReplySentAt.
    const replyPool =
      automation.publicReplyMessages.length > 0
        ? automation.publicReplyMessages
        : automation.publicReplyMessage
          ? [automation.publicReplyMessage]
          : [];
    if (
      automation.publicReplyEnabled &&
      replyPool.length > 0 &&
      !existingLog?.publicReplySentAt
    ) {
      try {
        const chosen = replyPool[Math.floor(Math.random() * replyPool.length)];
        const publicReply = renderMessageWithTracking({
          message: chosen,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        await sendCommentReply(accessToken, commentId, publicReply);
        await updateLog({ publicReplySentAt: new Date(), publicReplyError: null });
      } catch (error) {
        console.error(
          "[DM Worker] Public comment reply failed:",
          formatError(error)
        );
        await updateLog({ publicReplyError: formatError(error) }).catch(() => {});
      }
    }

    // DM already sent on an earlier pass; the public reply retry above was all
    // this run needed. Don't re-send the DM.
    if (!needsDm) continue;

    // Meta allows exactly ONE private reply per comment, ever — across every
    // campaign. When several campaigns match the same comment (duplicated
    // campaigns, or an any-post campaign overlapping a post-specific one), only
    // the first can deliver; the rest would fail with "The comment is invalid
    // for a private reply". Skip them explicitly instead of burning an API call
    // and logging a failure the user can do nothing about. The public reply
    // above still goes out per campaign — only the DM leg is deduped.
    const privateReplyUsedBy = await prisma.dmLog.findFirst({
      where: {
        commentId,
        status: "SENT",
        automationId: { not: automation.id },
      },
      select: { automation: { select: { name: true } } },
    });
    if (privateReplyUsedBy) {
      await updateLog({
        status: "SKIPPED_DEDUP",
        matchedKeyword: matchResult.matchedKeyword,
        errorMessage: `Another campaign (${privateReplyUsedBy.automation?.name ?? "unknown"}) already sent the one private reply Instagram allows for this comment`,
      });
      continue;
    }

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await updateLog({
        status: "SKIPPED_PLAN_LIMIT",
        matchedKeyword: matchResult.matchedKeyword,
        errorMessage: `Monthly DM limit reached (${usage.limit})`,
      });
      continue;
    }

    let rateLimit;
    try {
      rateLimit = await reserveDMSlot(instagramAccountId, requeueAttempt);
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      await updateLog({
        status: "FAILED",
        attempts,
        errorMessage: formatError(error),
      });
      throw error;
    }

    if (!rateLimit.allowed) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      if (rateLimit.shouldSkip) {
        await updateLog({
          status: "SKIPPED_RATE_LIMIT",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: "Hourly Instagram DM rate limit reached",
        });
        continue;
      }

      if (rateLimit.shouldRequeue) {
        await updateLog({
          status: "PENDING",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: "Hourly rate limit hit; retry scheduled",
        });

        await getDMQueue().add(
          "process-comment",
          {
            ...job.data,
            requeueAttempt: requeueAttempt + 1,
          },
          {
            delay: rateLimit.requeueDelayMs,
            jobId: `comment_${instagramAccountId}_${commentId}_retry_${requeueAttempt + 1}`,
          }
        );
        continue;
      }
    }

    // With an opening DM, the private reply is a button message; tapping it
    // fires a postback that delivers the reveal (see processPostback). Without
    // one, we send the reveal text directly.
    const useOpeningDm =
      automation.openingDmEnabled &&
      Boolean(automation.openingDmMessage) &&
      Boolean(automation.openingDmButtonLabel);

    // Follow-gating: the link is revealed only after a follow. When an opening
    // DM is enabled it comes FIRST, and its button routes into the follow check
    // (opening DM → follow gate → link). Without an opening DM, we check follow
    // status at comment time: confirmed followers get the link now, everyone
    // else gets the "follow me first" prompt (re-verified on tap).
    let promptForFollow = false;
    if (automation.requireFollow && !useOpeningDm) {
      const alreadyFollows = await getUserFollowStatus(accessToken, commenterId);
      promptForFollow = alreadyFollows !== true;
    }

    const channel = privateReplyChannel(
      accessToken,
      automation.instagramAccount.instagramId,
      commentId
    );

    try {
      if (useOpeningDm) {
        const openingText = renderMessageWithTracking({
          message: automation.openingDmMessage as string,
          commenterName,
          trackedLinks: [],
        });
        await channel.sendPostbackButton(
          openingText,
          automation.openingDmButtonLabel as string,
          automation.requireFollow
            ? `followcheck:${automation.id}`
            : `reveal:${automation.id}`
        );
      } else if (promptForFollow) {
        await sendFollowPrompt(
          channel,
          automation,
          commenterName,
          FOLLOW_PROMPT_DEFAULTS
        );
      } else {
        await sendLinkMessage(channel, automation, commenterName, "private reply");
      }

      await updateLog({
        status: "SENT",
        dmSentAt: new Date(),
        errorMessage: null,
      });
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      await updateLog({
        status: "FAILED",
        attempts,
        errorMessage: formatError(error),
      });
      throw error;
    }
  }
}
