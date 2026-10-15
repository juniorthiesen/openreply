/**
 * The Facebook half of a campaign.
 *
 * A campaign is written once, in the campaign builder, and runs on Instagram,
 * Facebook or both. The Instagram half is the Automation row; the Facebook half
 * is a FacebookAutomation row derived from the same shared fields (keywords,
 * messages, link, public replies, active state) plus the Facebook-only choice
 * of Page and video. Deriving it on every save is what keeps the two halves
 * from drifting apart.
 */

import { z } from "zod";

/** Facebook comments are shorter than Instagram's: Meta rejects longer replies. */
export const FACEBOOK_PUBLIC_REPLY_MAX = 500;

export const facebookChannelSchema = z
  .object({
    /** FacebookPage.id (our row), not the Page's Facebook id. */
    facebookPageId: z.string().min(1),
    matchAnyPost: z.boolean().optional().default(false),
    videoId: z.string().trim().max(100).nullish(),
    videoTitle: z.string().trim().max(300).nullish(),
    videoUrl: z.string().trim().max(2000).nullish(),
  })
  .refine((channel) => channel.matchAnyPost || Boolean(channel.videoId), {
    message: "Escolha o vídeo do Facebook ou responda a qualquer vídeo da Página.",
    path: ["videoId"],
  });

export type FacebookChannelInput = z.output<typeof facebookChannelSchema>;

/** The campaign fields both channels share. */
export interface SharedCampaignFields {
  name: string;
  keywords: string[];
  matchAnyWord: boolean;
  wholeWordMatch: boolean;
  dmMessage: string;
  linkUrl: string | null;
  linkButtonLabel: string | null;
  publicReplyEnabled: boolean;
  publicReplyMessages: string[];
  isActive: boolean;
}

/** Why a campaign can't run on Facebook as written, or null when it can. */
export function findFacebookIncompatibility(
  shared: Pick<SharedCampaignFields, "publicReplyEnabled" | "publicReplyMessages">
): string | null {
  if (
    shared.publicReplyEnabled &&
    shared.publicReplyMessages.some((message) => message.trim().length > FACEBOOK_PUBLIC_REPLY_MAX)
  ) {
    return `No Facebook, cada resposta pública pode ter até ${FACEBOOK_PUBLIC_REPLY_MAX} caracteres.`;
  }
  return null;
}

/** The FacebookAutomation columns for a campaign's Facebook half. */
export function buildFacebookRuleData(shared: SharedCampaignFields, channel: FacebookChannelInput) {
  const replies = shared.publicReplyEnabled
    ? shared.publicReplyMessages.map((message) => message.trim()).filter(Boolean)
    : [];
  return {
    facebookPageId: channel.facebookPageId,
    name: shared.name,
    matchAnyPost: channel.matchAnyPost,
    videoId: channel.matchAnyPost ? null : (channel.videoId ?? null),
    videoTitle: channel.matchAnyPost ? null : (channel.videoTitle ?? null),
    videoUrl: channel.matchAnyPost ? null : (channel.videoUrl ?? null),
    keywords: shared.matchAnyWord ? [] : shared.keywords,
    matchAnyWord: shared.matchAnyWord,
    wholeWordMatch: shared.wholeWordMatch,
    dmMessage: shared.dmMessage,
    linkUrl: shared.linkUrl || null,
    linkButtonLabel: shared.linkUrl ? shared.linkButtonLabel || null : null,
    publicReplyEnabled: replies.length > 0,
    publicReplyMessages: replies,
    isActive: shared.isActive,
  };
}

/** A stored rule back as the channel choice, to keep it when the save doesn't touch it. */
export function channelFromRule(rule: {
  facebookPageId: string;
  matchAnyPost: boolean;
  videoId: string | null;
  videoTitle: string | null;
  videoUrl: string | null;
}): FacebookChannelInput {
  return {
    facebookPageId: rule.facebookPageId,
    matchAnyPost: rule.matchAnyPost,
    videoId: rule.videoId,
    videoTitle: rule.videoTitle,
    videoUrl: rule.videoUrl,
  };
}
