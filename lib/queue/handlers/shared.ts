import type { Prisma } from "@/app/generated/prisma/client";
import {
  MetaApiError,
  RateLimitError,
  TokenExpiredError,
  sendDirectMessage,
  sendDirectMessageWithButton,
  sendDirectMessageWithLinkButton,
  sendPrivateReply,
  sendPrivateReplyWithButton,
  sendPrivateReplyWithLinkButton,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { getDMQueue, FOLLOWUP_JOB_NAME } from "../client";
import {
  buildTrackedUrl,
  renderMessageWithTracking,
  renderMessageWithoutLink,
} from "@/lib/tracking/message";

export function formatError(error: unknown): string {
  if (error instanceof MetaApiError) {
    return `Meta API Error ${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

// Meta rejections that a plain-text retry cannot fix: the send was refused for
// the conversation, not for the button template. Retrying as text just burns
// the attempt and — worse — overwrites the real error with a misleading one
// ("invalid for a private reply", because the first attempt already used up the
// comment's single allowed private reply).
const NON_TEMPLATE_REJECTIONS = [
  /outside of allowed window/i,
  /invalid for a private reply/i,
  /requested user cannot be found/i,
];

function isTemplateRejection(error: unknown): boolean {
  if (error instanceof TokenExpiredError || error instanceof RateLimitError) {
    return false;
  }
  const message = error instanceof Error ? error.message : "";
  return !NON_TEMPLATE_REJECTIONS.some((pattern) => pattern.test(message));
}

// Fallback copy for a follow-gated campaign that leaves the prompt blank. The
// comment and button-tap paths share one text; the DM keyword trigger has
// always used its own.
export const FOLLOW_PROMPT_DEFAULTS = {
  message:
    "quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over",
  buttonLabel: "i'm following",
};

export const DM_TRIGGER_FOLLOW_PROMPT_DEFAULTS = {
  message: "Almost there! Follow me and tap the button below to grab your link 💛",
  buttonLabel: "I'm following ✅",
};

// Relations every job handler needs to render and send a campaign's DM.
export const AUTOMATION_INCLUDE = {
  instagramAccount: true,
  workspace: true,
  trackedLinks: {
    select: { slug: true, label: true, destinationUrl: true },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.AutomationInclude;

export function dmLogWhere(automationId: string, commentId: string) {
  return { automationId_commentId: { automationId, commentId } };
}

export function matchAutomation(
  automation: { matchAnyWord: boolean; keywords: string[]; wholeWordMatch: boolean },
  text: string
): { matched: boolean; matchedKeyword: string | null } {
  // "Any word" campaigns fire on every message; otherwise require a keyword hit.
  return automation.matchAnyWord
    ? { matched: true, matchedKeyword: null }
    : matchKeywords(text, automation.keywords, automation.wholeWordMatch);
}

/**
 * Decrypt the account's stored token. Returns the reason instead of throwing
 * so each handler decides whether to log it or drop the job quietly.
 */
export function resolveAccessToken(
  encrypted: string | null
): { token: string } | { error: string } {
  if (!encrypted) return { error: "No Instagram access token available" };
  try {
    return { token: decryptToken(encrypted) };
  } catch {
    return { error: "Failed to decrypt Instagram access token" };
  }
}

/**
 * Queue the optional appreciation follow-up once a link has been delivered. It
 * runs as its own delayed job so it can go out some minutes later
 * (followUpDelayMinutes); the deterministic job id dedupes repeat triggers to
 * one follow-up per user.
 */
export async function scheduleFollowUp(
  automation: {
    id: string;
    followUpEnabled: boolean;
    followUpMessage: string | null;
    followUpDelayMinutes: number | null;
    instagramAccount: { instagramId: string };
  },
  userId: string,
  commenterName: string | null
): Promise<void> {
  if (!automation.followUpEnabled || !automation.followUpMessage?.trim()) return;

  await getDMQueue().add(
    FOLLOWUP_JOB_NAME,
    {
      instagramAccountId: automation.instagramAccount.instagramId,
      userId,
      automationId: automation.id,
      commenterName,
    },
    {
      delay: Math.max(0, automation.followUpDelayMinutes ?? 0) * 60_000,
      jobId: `followup_${automation.id}_${userId}`,
    }
  );
}

type LinkButton = { title: string; url: string };

/**
 * Where a message goes: a comment's one private reply, or a DM to a user who
 * already has an open conversation with the account.
 */
export type MessageChannel = {
  sendText(text: string): Promise<unknown>;
  sendLinkButtons(text: string, buttons: LinkButton[]): Promise<unknown>;
  sendPostbackButton(text: string, buttonTitle: string, payload: string): Promise<unknown>;
};

export function privateReplyChannel(
  accessToken: string,
  instagramId: string,
  commentId: string
): MessageChannel {
  return {
    sendText: (text) => sendPrivateReply(accessToken, instagramId, commentId, text),
    sendLinkButtons: (text, buttons) =>
      sendPrivateReplyWithLinkButton(accessToken, instagramId, commentId, text, buttons),
    sendPostbackButton: (text, buttonTitle, payload) =>
      sendPrivateReplyWithButton(accessToken, instagramId, commentId, text, buttonTitle, payload),
  };
}

export function directMessageChannel(
  accessToken: string,
  instagramId: string,
  userId: string
): MessageChannel {
  return {
    sendText: (text) => sendDirectMessage(accessToken, instagramId, userId, text),
    sendLinkButtons: (text, buttons) =>
      sendDirectMessageWithLinkButton(accessToken, instagramId, userId, text, buttons),
    sendPostbackButton: (text, buttonTitle, payload) =>
      sendDirectMessageWithButton(accessToken, instagramId, userId, text, buttonTitle, payload),
  };
}

type WorkerTrackedLink = {
  slug: string;
  label: string | null;
  destinationUrl: string;
};

/**
 * Build the tappable link buttons for a DM. The first link uses the campaign's
 * `linkButtonLabel`; each additional link uses its own stored `label`. Capped at
 * Meta's 3-button limit for a button template.
 */
function buildLinkButtons(
  trackedLinks: WorkerTrackedLink[],
  primaryLabel: string | null
): LinkButton[] {
  return trackedLinks.slice(0, 3).map((link, index) => ({
    url: buildTrackedUrl(link.slug),
    title: (index === 0 ? primaryLabel : link.label) || link.label || "Open link",
  }));
}

/**
 * Fallback text when Meta rejects the button template: render the primary link
 * inline, then append any extra tracked URLs on their own lines so no link is
 * lost.
 */
function buildInlineLinkFallback(
  message: string,
  commenterName: string | null | undefined,
  trackedLinks: WorkerTrackedLink[],
  bodyText: string
): string {
  const base =
    renderMessageWithTracking({ message, commenterName, trackedLinks }) ||
    bodyText;
  const extraUrls = trackedLinks.slice(1).map((link) => buildTrackedUrl(link.slug));
  return extraUrls.length > 0 ? `${base}\n${extraUrls.join("\n")}` : base;
}

/**
 * Deliver a campaign's link ("reveal") message. With tracked links it tries a
 * button template first and, only if Meta rejects the template itself, retries
 * once as text with the links inline.
 */
export async function sendLinkMessage(
  channel: MessageChannel,
  automation: {
    dmMessage: string;
    linkButtonLabel: string | null;
    trackedLinks: WorkerTrackedLink[];
  },
  commenterName: string | null | undefined,
  context: string
): Promise<void> {
  if (automation.trackedLinks.length === 0) {
    await channel.sendText(
      renderMessageWithTracking({
        message: automation.dmMessage,
        commenterName,
        trackedLinks: automation.trackedLinks,
      })
    );
    return;
  }

  const bodyText =
    renderMessageWithoutLink({
      message: automation.dmMessage,
      commenterName,
    }) || "Here's your link:";

  try {
    await channel.sendLinkButtons(
      bodyText,
      buildLinkButtons(automation.trackedLinks, automation.linkButtonLabel)
    );
  } catch (buttonError) {
    // Only a template rejection is worth retrying as text. Anything else
    // (closed window, comment already replied to) fails the same way and
    // would replace the real error with a misleading one.
    if (!isTemplateRejection(buttonError)) throw buttonError;

    console.log(
      `[DM Worker] Button template rejected in ${context}, falling back to inline link:`,
      formatError(buttonError)
    );
    try {
      await channel.sendText(
        buildInlineLinkFallback(
          automation.dmMessage,
          commenterName,
          automation.trackedLinks,
          bodyText
        )
      );
    } catch {
      // On a private reply the first attempt already consumed the comment's
      // single allowed reply, so this one reports "invalid for a private
      // reply" no matter what the underlying problem was. Surface the
      // original rejection instead.
      throw buttonError;
    }
  }
}

/**
 * Ask the user to follow before the link goes out. The `followcheck:` button
 * re-verifies the follow when tapped (see processPostback).
 */
export async function sendFollowPrompt(
  channel: MessageChannel,
  automation: {
    id: string;
    followPromptMessage: string | null;
    followPromptButtonLabel: string | null;
  },
  commenterName: string | null | undefined,
  defaults: { message: string; buttonLabel: string }
): Promise<void> {
  const promptText = renderMessageWithoutLink({
    message: automation.followPromptMessage || defaults.message,
    commenterName,
  });
  await channel.sendPostbackButton(
    promptText,
    automation.followPromptButtonLabel || defaults.buttonLabel,
    `followcheck:${automation.id}`
  );
}
