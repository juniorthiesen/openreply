/**
 * Answers comments on a Facebook Page: a private reply to the commenter's
 * Messenger inbox and/or a public reply under the comment.
 *
 * Idempotency comes from FacebookCommentLog's unique (automation, comment) key:
 * the row is inserted *before* anything is sent, and a second webhook delivery
 * for the same comment loses the insert and stops. That favours "never send
 * twice" over "always send once" — a send that failed is logged FAILED and not
 * retried by redelivery, because a private reply Meta reports as failed may
 * still have reached the person.
 */

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { MetaApiError } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import {
  commentIsOnVideo,
  parseFacebookCommentEvents,
  renderFacebookMessage,
  type FacebookCommentEvent,
} from "./comment-events";
import {
  sendFacebookCommentReply,
  sendFacebookPrivateReply,
} from "./page-api";

function describeError(error: unknown): string {
  if (error instanceof MetaApiError) return `${error.name} ${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : "Unknown error";
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function pickReply(messages: string[]): string | null {
  const usable = messages.map((message) => message.trim()).filter(Boolean);
  if (!usable.length) return null;
  return usable[Math.floor(Math.random() * usable.length)];
}

// Meta refuses a button template for some Pages/conversations with a code 100
// that names the template; a plain text with the URL still gets through.
function isTemplateRejection(error: unknown): boolean {
  return (
    error instanceof MetaApiError &&
    error.code === 100 &&
    /template|button/i.test(error.message) &&
    !/outside of allowed window|invalid for a private reply/i.test(error.message)
  );
}

type RuleForSend = {
  dmMessage: string;
  linkUrl: string | null;
  linkButtonLabel: string | null;
  publicReplyEnabled: boolean;
  publicReplyMessages: string[];
};

async function sendPrivateReply(
  token: string,
  pageId: string,
  event: FacebookCommentEvent,
  rule: RuleForSend
) {
  const text = renderFacebookMessage(rule.dmMessage, event.commenterName) || "Olá!";
  if (!rule.linkUrl) {
    await sendFacebookPrivateReply(token, pageId, event.commentId, text);
    return;
  }
  const button = { title: rule.linkButtonLabel || "Abrir link", url: rule.linkUrl };
  try {
    await sendFacebookPrivateReply(token, pageId, event.commentId, text, button);
  } catch (error) {
    if (!isTemplateRejection(error)) throw error;
    await sendFacebookPrivateReply(token, pageId, event.commentId, `${text}\n${rule.linkUrl}`);
  }
}

export async function handleFacebookCommentEvent(event: FacebookCommentEvent): Promise<void> {
  const page = await prisma.facebookPage.findUnique({
    where: { facebookPageId: event.pageId },
    select: { id: true, facebookPageId: true, accessToken: true },
  });
  if (!page) return;

  const rules = await prisma.facebookAutomation.findMany({
    where: { facebookPageId: page.id, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  for (const rule of rules) {
    if (!commentIsOnVideo(rule, event)) continue;
    const match = rule.matchAnyWord
      ? { matched: true, matchedKeyword: null }
      : matchKeywords(event.commentText, rule.keywords, rule.wholeWordMatch);
    if (!match.matched) continue;

    let logId: string;
    try {
      const log = await prisma.facebookCommentLog.create({
        data: {
          automationId: rule.id,
          commentId: event.commentId,
          postId: event.postId,
          commenterId: event.commenterId,
          commenterName: event.commenterName,
          commentText: event.commentText.slice(0, 2000),
          matchedKeyword: match.matchedKeyword,
        },
        select: { id: true },
      });
      logId = log.id;
    } catch (error) {
      if (isUniqueViolation(error)) continue; // already handled: webhook redelivery
      throw error;
    }

    const token = decryptToken(page.accessToken);
    let dmError: string | null = null;
    let dmSent = false;
    try {
      await sendPrivateReply(token, page.facebookPageId, event, rule);
      dmSent = true;
    } catch (error) {
      dmError = describeError(error);
    }

    let publicSentAt: Date | null = null;
    let publicError: string | null = null;
    const publicText = rule.publicReplyEnabled ? pickReply(rule.publicReplyMessages) : null;
    if (publicText) {
      try {
        await sendFacebookCommentReply(
          token,
          event.commentId,
          renderFacebookMessage(publicText, event.commenterName)
        );
        publicSentAt = new Date();
      } catch (error) {
        publicError = describeError(error);
      }
    }

    await prisma.facebookCommentLog.update({
      where: { id: logId },
      data: {
        status: dmSent ? "SENT" : "FAILED",
        dmSentAt: dmSent ? new Date() : null,
        errorMessage: dmError,
        publicReplySentAt: publicSentAt,
        publicReplyError: publicError,
      },
    });
  }
}

/** Entry point from the shared webhook route. Resolves once every comment is handled. */
export async function processFacebookWebhook(payload: unknown): Promise<void> {
  const events = parseFacebookCommentEvents(
    payload as Parameters<typeof parseFacebookCommentEvents>[0]
  );
  for (const event of events) {
    try {
      await handleFacebookCommentEvent(event);
    } catch (error) {
      // One bad comment must not stop the rest of the batch.
      console.error("[Facebook Webhook] Comment handling failed:", describeError(error));
    }
  }
}
