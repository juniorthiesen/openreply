/**
 * Campaign create/update rules shared by the HTTP routes and the MCP server.
 *
 * Moved out of app/api/automations/route.ts unchanged so that a campaign made
 * through MCP obeys exactly the same invariants as one made in the app: a
 * campaign must have a trigger, an opening DM needs its button, an A/B test
 * freezes the link DM, and so on.
 */

import { z } from "zod";
import { NOT_AB_VARIANT_LINK } from "@/lib/ab/link-filter";
import { prisma } from "@/lib/db/client";
import { buildInitialCampaignLinks, syncCampaignLinks } from "@/lib/campaigns/links";
import { generateReportShareSlug } from "@/lib/reports/share";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";
import {
  buildFacebookRuleData,
  channelFromRule,
  facebookChannelSchema,
  findFacebookIncompatibility,
  type FacebookChannelInput,
  type SharedCampaignFields,
} from "@/lib/campaigns/facebook-channel";

export type CampaignResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; details?: unknown };

type CampaignRuleFields = {
  matchAnyPost: boolean;
  pendingNextReel: boolean;
  postId?: string | null;
  matchAnyWord: boolean;
  keywords: string[];
  openingDmEnabled: boolean;
  openingDmMessage?: string | null;
  openingDmButtonLabel?: string | null;
};

// Invariants every saved campaign must satisfy. Create checks the request body;
// update checks the existing row merged with the change, since a partial body
// can break a rule on its own (e.g. enabling the opening DM with no message).
function findCampaignRuleViolation(
  d: CampaignRuleFields
): { message: string; path: string } | null {
  // A campaign must target a specific post, any post, or the next reel.
  if (!d.matchAnyPost && !d.pendingNextReel && !d.postId) {
    return { message: "Choose which post(s) trigger the campaign", path: "postId" };
  }
  // And it must match either specific words or any word.
  if (!d.matchAnyWord && d.keywords.length === 0) {
    return { message: "Add at least one keyword, or match any word", path: "keywords" };
  }
  // An opening DM needs both a message and a button label.
  if (
    d.openingDmEnabled &&
    (!d.openingDmMessage?.trim() || !d.openingDmButtonLabel?.trim())
  ) {
    return {
      message: "Opening DM needs a message and a button label",
      path: "openingDmMessage",
    };
  }
  return null;
}

function hasPublicReplyText(
  messages?: string[] | null,
  legacyMessage?: string | null
): boolean {
  return (
    Boolean(legacyMessage?.trim()) ||
    (messages ?? []).some((message) => Boolean(message.trim()))
  );
}

export const createCampaignSchema = z
  .object({
    name: z.string().min(1).max(100),
    goal: z.string().min(1).max(120).optional().nullable(),
    instagramAccountId: z.string().min(1).optional().nullable(),
    postId: z.string().min(1).optional().nullable(),
    postUrl: z.string().url().optional().nullable(),
    pendingNextReel: z.boolean().optional().default(false),
    matchAnyPost: z.boolean().optional().default(false),
    keywords: z.array(z.string().min(1).max(50)).max(10).optional().default([]),
    matchAnyWord: z.boolean().optional().default(false),
    dmTriggerEnabled: z.boolean().optional().default(false),
    // One Story whose replies this campaign answers (needs dmTriggerEnabled).
    storyMediaId: z.string().min(1).max(100).optional().nullable(),
    dmMessage: z.string().min(1).max(1000),
    openingDmEnabled: z.boolean().optional().default(false),
    openingDmMessage: z.string().max(1000).optional().nullable(),
    openingDmButtonLabel: z.string().max(64).optional().nullable(),
    linkButtonLabel: z.string().max(20).optional().nullable(),
    requireFollow: z.boolean().optional().default(false),
    followPromptMessage: z.string().max(1000).optional().nullable(),
    followPromptButtonLabel: z.string().max(20).optional().nullable(),
    followUpEnabled: z.boolean().optional().default(false),
    followUpMessage: z.string().max(1000).optional().nullable(),
    // Minutes to wait before the follow-up. Capped at 24h so it stays inside
    // Instagram's messaging window.
    followUpDelayMinutes: z.number().int().min(0).max(1440).optional().default(0),
    publicReplyEnabled: z.boolean().optional().default(false),
    publicReplyMessage: z.string().max(1000).optional().nullable(),
    publicReplyMessages: z
      .array(z.string().max(1000))
      .max(10)
      .optional()
      .default([]),
    // Empty string means "no tracked link"; a URL sets one.
    trackedDestinationUrl: z
      .union([z.string().url(), z.literal("")])
      .optional()
      .nullable(),
    // Optional second tracked link, rendered as a second DM button.
    secondaryDestinationUrl: z
      .union([z.string().url(), z.literal("")])
      .optional()
      .nullable(),
    secondaryButtonLabel: z.string().max(20).optional().nullable(),
    isActive: z.boolean().optional().default(true),
    wholeWordMatch: z.boolean().optional().default(true),
    // Also run this campaign on a Facebook Page. Omit for Instagram only.
    facebook: facebookChannelSchema.optional().nullable(),
  })
  .superRefine((d, ctx) => {
    const violation = findCampaignRuleViolation(d);
    if (violation) {
      ctx.addIssue({ code: "custom", message: violation.message, path: [violation.path] });
    }
    if (
      d.publicReplyEnabled &&
      !hasPublicReplyText(d.publicReplyMessages, d.publicReplyMessage)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Adicione ao menos uma resposta pública ou desative essa opção.",
        path: ["publicReplyMessages"],
      });
    }
  });

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  goal: z.string().min(1).max(120).optional().nullable(),
  postId: z.string().min(1).optional().nullable(),
  postUrl: z.string().url().optional().nullable(),
  pendingNextReel: z.boolean().optional(),
  matchAnyPost: z.boolean().optional(),
  keywords: z.array(z.string().min(1).max(50)).max(10).optional(),
  matchAnyWord: z.boolean().optional(),
  dmTriggerEnabled: z.boolean().optional(),
  storyMediaId: z.string().min(1).max(100).optional().nullable(),
  dmMessage: z.string().min(1).max(1000).optional(),
  openingDmEnabled: z.boolean().optional(),
  openingDmMessage: z.string().max(1000).optional().nullable(),
  openingDmButtonLabel: z.string().max(64).optional().nullable(),
  linkButtonLabel: z.string().max(20).optional().nullable(),
  requireFollow: z.boolean().optional(),
  followPromptMessage: z.string().max(1000).optional().nullable(),
  followPromptButtonLabel: z.string().max(20).optional().nullable(),
  followUpEnabled: z.boolean().optional(),
  followUpMessage: z.string().max(1000).optional().nullable(),
  followUpDelayMinutes: z.number().int().min(0).max(1440).optional(),
  publicReplyEnabled: z.boolean().optional(),
  publicReplyMessage: z.string().max(1000).optional().nullable(),
  publicReplyMessages: z.array(z.string().max(1000)).max(10).optional(),
  isActive: z.boolean().optional(),
  wholeWordMatch: z.boolean().optional(),
  reportShareEnabled: z.boolean().optional(),
  // Empty string clears the tracked link; a URL updates/creates it; undefined
  // leaves it unchanged.
  trackedDestinationUrl: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .nullable(),
  // Same semantics for the optional second tracked link / DM button.
  secondaryDestinationUrl: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .nullable(),
  secondaryButtonLabel: z.string().max(20).optional().nullable(),
  // undefined keeps the Facebook half as it is, null removes it, a value adds
  // or changes it.
  facebook: facebookChannelSchema.optional().nullable(),
});

export type CreateCampaignInput = z.output<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.output<typeof updateCampaignSchema>;

function fail(status: number, error: string, details?: unknown): CampaignResult<never> {
  return { ok: false, status, error, ...(details ? { details } : {}) };
}

export async function createCampaign(workspaceId: string, input: CreateCampaignInput) {
  const requestedInstagramAccountId =
    input.instagramAccountId && input.instagramAccountId !== "all"
      ? input.instagramAccountId
      : null;

  const [workspace, instagramAccount] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    }),
    requestedInstagramAccountId
      ? prisma.instagramAccount.findFirst({
          where: { id: requestedInstagramAccountId, workspaceId },
        })
      : prisma.instagramAccount.findFirst({
          where: { workspaceId },
          orderBy: { connectedAt: "desc" },
        }),
  ]);

  if (!workspace) return fail(404, "Workspace not found");
  if (!instagramAccount) return fail(400, "Connect Instagram before creating campaigns");

  if (input.facebook) {
    const page = await prisma.facebookPage.findFirst({
      where: { id: input.facebook.facebookPageId, workspaceId },
      select: { id: true },
    });
    if (!page) return fail(400, "A Página do Facebook escolhida não está conectada.");
    const incompatibility = findFacebookIncompatibility({
      publicReplyEnabled: input.publicReplyEnabled,
      publicReplyMessages: input.publicReplyMessages,
    });
    if (incompatibility) return fail(400, incompatibility);
  }

  const linkCreates = buildInitialCampaignLinks({
    workspaceId,
    primaryUrl: input.trackedDestinationUrl,
    secondaryUrl: input.secondaryDestinationUrl,
    secondaryLabel: input.secondaryButtonLabel,
  });

  if (input.dmTriggerEnabled && input.storyMediaId) {
    const story = await prisma.externalStory.findFirst({
      where: { workspaceId, instagramMediaId: input.storyMediaId },
      select: { id: true },
    });
    if (!story) return fail(400, "Esse Story não foi encontrado nos Stories capturados.");
  }

  const { pendingNextReel, matchAnyPost, matchAnyWord, openingDmEnabled } = input;
  // A post is only stored for the "specific post" trigger.
  const isSpecificPost = !pendingNextReel && !matchAnyPost;
  const publicReplyList = (
    input.publicReplyMessages.length > 0
      ? input.publicReplyMessages
      : input.publicReplyMessage
        ? [input.publicReplyMessage]
        : []
  )
    .map((m) => m.trim())
    .filter(Boolean);

  const automation = await prisma.automation.create({
    data: {
      name: input.name,
      goal: input.goal,
      // A next-reel campaign has no post yet; the cron binds it once a reel is posted.
      postId: isSpecificPost ? input.postId : null,
      postUrl: isSpecificPost ? input.postUrl : null,
      pendingNextReel,
      matchAnyPost,
      keywords: matchAnyWord ? [] : input.keywords,
      matchAnyWord,
      dmTriggerEnabled: input.dmTriggerEnabled,
      storyMediaId: input.dmTriggerEnabled ? input.storyMediaId || null : null,
      dmMessage: input.dmMessage,
      openingDmEnabled,
      openingDmMessage: openingDmEnabled ? input.openingDmMessage || null : null,
      openingDmButtonLabel: openingDmEnabled ? input.openingDmButtonLabel || null : null,
      linkButtonLabel: input.linkButtonLabel || null,
      requireFollow: input.requireFollow,
      followPromptMessage: input.requireFollow ? input.followPromptMessage || null : null,
      followPromptButtonLabel: input.requireFollow
        ? input.followPromptButtonLabel || null
        : null,
      followUpEnabled: input.followUpEnabled,
      followUpMessage: input.followUpEnabled ? input.followUpMessage || null : null,
      followUpDelayMinutes: input.followUpEnabled ? input.followUpDelayMinutes : 0,
      publicReplyEnabled: input.publicReplyEnabled,
      publicReplyMessages: input.publicReplyEnabled ? publicReplyList : [],
      publicReplyMessage: input.publicReplyEnabled
        ? (publicReplyList[0] ?? input.publicReplyMessage ?? null)
        : null,
      isActive: input.isActive,
      wholeWordMatch: input.wholeWordMatch,
      workspaceId,
      instagramAccountId: instagramAccount.id,
      reportShareSlug: generateReportShareSlug(),
      ...(linkCreates.length > 0 ? { trackedLinks: { create: linkCreates } } : {}),
    },
    include: {
      trackedLinks: true,
    },
  });

  if (input.facebook) {
    try {
      await prisma.facebookAutomation.create({
        data: {
          ...buildFacebookRuleData(
            {
              name: input.name,
              keywords: input.keywords,
              matchAnyWord,
              wholeWordMatch: input.wholeWordMatch,
              dmMessage: input.dmMessage,
              linkUrl: input.trackedDestinationUrl || null,
              linkButtonLabel: input.linkButtonLabel || null,
              publicReplyEnabled: input.publicReplyEnabled,
              publicReplyMessages: publicReplyList,
              isActive: input.isActive,
            },
            input.facebook
          ),
          workspaceId,
          automationId: automation.id,
        },
      });
    } catch (error) {
      // The campaign is one thing: don't leave its Instagram half behind alone.
      await prisma.automation.delete({ where: { id: automation.id } }).catch(() => {});
      throw error;
    }
  }

  return { ok: true, data: automation } as const;
}

export async function updateCampaign(
  workspaceId: string,
  automationId: string,
  input: UpdateCampaignInput
) {
  const existing = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
  });
  if (!existing) return fail(404, "Campaign not found");

  const {
    trackedDestinationUrl,
    secondaryDestinationUrl,
    secondaryButtonLabel,
    facebook,
    ...automationData
  } = input;

  // While an A/B test runs, the worker sends the test's own variants, so a change
  // to the link DM would reach nobody and the test's numbers would stop meaning
  // what they say. Only a real change is refused, so saving anything else works.
  const runningTest = await prisma.abTest.findFirst({
    where: { automationId, status: "RUNNING" },
    select: { id: true },
  });
  if (runningTest) {
    const primaryLink = await prisma.trackedLink.findFirst({
      where: { automationId, ...NOT_AB_VARIANT_LINK },
      orderBy: TRACKED_LINK_ORDER,
      select: { destinationUrl: true },
    });
    const changesLinkDm =
      (automationData.dmMessage !== undefined && automationData.dmMessage !== existing.dmMessage) ||
      (automationData.linkButtonLabel !== undefined &&
        (automationData.linkButtonLabel ?? "") !== (existing.linkButtonLabel ?? "")) ||
      (trackedDestinationUrl !== undefined &&
        trackedDestinationUrl !== null &&
        trackedDestinationUrl !== (primaryLink?.destinationUrl ?? ""));
    if (changesLinkDm) {
      return fail(
        409,
        "Há um teste A/B em andamento. Encerre o teste na aba Teste A/B antes de mudar a mensagem, o botão ou o link da DM."
      );
    }
  }

  // A Story only means something to a campaign that answers DMs.
  if (automationData.dmTriggerEnabled === false) automationData.storyMediaId = null;
  if (automationData.storyMediaId && automationData.storyMediaId !== existing.storyMediaId) {
    const story = await prisma.externalStory.findFirst({
      where: { workspaceId, instagramMediaId: automationData.storyMediaId },
      select: { id: true },
    });
    if (!story) return fail(400, "Esse Story não foi encontrado nos Stories capturados.");
  }

  // Keep dependent fields consistent: any-word clears keywords; a disabled
  // opening DM clears its message and button.
  if (automationData.matchAnyWord === true) automationData.keywords = [];
  if (automationData.openingDmEnabled === false) {
    automationData.openingDmMessage = null;
    automationData.openingDmButtonLabel = null;
  }
  if (automationData.requireFollow === false) {
    automationData.followPromptMessage = null;
    automationData.followPromptButtonLabel = null;
  }
  if (automationData.followUpEnabled === false) {
    automationData.followUpMessage = null;
    automationData.followUpDelayMinutes = 0;
  }
  // Any-post / next-reel campaigns carry no specific post.
  if (automationData.matchAnyPost === true || automationData.pendingNextReel === true) {
    automationData.postId = null;
    automationData.postUrl = null;
  }
  // Keep the public-reply variations list and the legacy single field in sync.
  if (automationData.publicReplyMessages !== undefined) {
    const list = automationData.publicReplyMessages.map((m) => m.trim()).filter(Boolean);
    automationData.publicReplyMessages = list;
    automationData.publicReplyMessage = list[0] ?? null;
  }
  if (automationData.publicReplyEnabled === false) {
    automationData.publicReplyMessages = [];
    automationData.publicReplyMessage = null;
  }

  // Only an active campaign has to be valid: the worker ignores paused ones,
  // and pausing must keep working even for a row saved before this check.
  const merged = { ...existing, ...automationData };
  if (
    merged.publicReplyEnabled &&
    !hasPublicReplyText(merged.publicReplyMessages, merged.publicReplyMessage)
  ) {
    const message = "Adicione ao menos uma resposta pública ou desative essa opção.";
    return fail(400, message, { fieldErrors: { publicReplyMessages: [message] } });
  }

  const violation = merged.isActive ? findCampaignRuleViolation(merged) : null;
  if (violation) {
    return fail(400, violation.message, {
      fieldErrors: { [violation.path]: [violation.message] },
    });
  }

  // The Facebook half follows the campaign: it is re-derived from the merged
  // fields on every save, so editing the keywords, messages, link or active
  // state here changes it too.
  const existingRule = await prisma.facebookAutomation.findUnique({
    where: { automationId },
  });
  const keepsFacebook = facebook !== null && (facebook !== undefined || Boolean(existingRule));
  if (keepsFacebook) {
    if (facebook) {
      const page = await prisma.facebookPage.findFirst({
        where: { id: facebook.facebookPageId, workspaceId },
        select: { id: true },
      });
      if (!page) return fail(400, "A Página do Facebook escolhida não está conectada.");
    }
    const incompatibility = findFacebookIncompatibility({
      publicReplyEnabled: merged.publicReplyEnabled,
      publicReplyMessages: merged.publicReplyMessages,
    });
    if (incompatibility) return fail(400, incompatibility);
  }

  // One transaction, so a save never lands half applied. Updating the campaign
  // first locks its row, which makes a second save of the same campaign wait
  // for this one before it reads the links.
  const updated = await prisma.$transaction(async (tx) => {
    const campaign = await tx.automation.update({
      where: { id: automationId },
      data: automationData,
    });

    await syncCampaignLinks(tx, {
      workspaceId,
      automationId,
      primaryUrl: trackedDestinationUrl,
      secondaryUrl: secondaryDestinationUrl,
      secondaryLabel: secondaryButtonLabel,
    });

    if (facebook === null) {
      await tx.facebookAutomation.deleteMany({ where: { automationId } });
    } else if (keepsFacebook) {
      const primaryLink = await tx.trackedLink.findFirst({
        where: { automationId, ...NOT_AB_VARIANT_LINK },
        orderBy: TRACKED_LINK_ORDER,
        select: { destinationUrl: true },
      });
      const shared: SharedCampaignFields = {
        name: campaign.name,
        keywords: campaign.keywords,
        matchAnyWord: campaign.matchAnyWord,
        wholeWordMatch: campaign.wholeWordMatch,
        dmMessage: campaign.dmMessage,
        linkUrl: primaryLink?.destinationUrl ?? null,
        linkButtonLabel: campaign.linkButtonLabel,
        publicReplyEnabled: campaign.publicReplyEnabled,
        publicReplyMessages: campaign.publicReplyMessages,
        isActive: campaign.isActive,
      };
      const channel: FacebookChannelInput =
        facebook ?? channelFromRule(existingRule as NonNullable<typeof existingRule>);
      const data = buildFacebookRuleData(shared, channel);
      await tx.facebookAutomation.upsert({
        where: { automationId },
        create: { ...data, workspaceId, automationId },
        update: data,
      });
    }

    return campaign;
  });

  return { ok: true, data: updated } as const;
}
