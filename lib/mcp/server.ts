/**
 * The Fisga MCP server: tools to inspect and create campaigns and to pull
 * reports, bound to the workspace of the token that connected.
 *
 * Two guards matter more than the tools themselves:
 *  - A READ token never even sees the write tools, so the model can't be talked
 *    into calling something that would be refused anyway.
 *  - Campaigns made here start PAUSED unless the caller explicitly activates
 *    them. An active campaign sends real DMs to real people, so going live is a
 *    separate, deliberate step the model is told to confirm with the user.
 *
 * Deleting is deliberately not offered: pausing is reversible, deleting is not.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import {
  createCampaign,
  createCampaignSchema,
  updateCampaign,
  updateCampaignSchema,
} from "@/lib/campaigns/service";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import {
  buildInstagramOverview,
  parseOverviewCount,
  type OverviewPost,
} from "@/lib/instagram/overview-data";
import {
  getCampaignPerformance,
  getWorkspacePerformance,
  MAX_REPORT_DAYS,
} from "@/lib/reports/workspace-report";
import { summarizeDmStatuses } from "@/lib/tracking/analytics";
import { buildTrackedUrl } from "@/lib/tracking/message";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";
import { NOT_AB_VARIANT_LINK } from "@/lib/ab/link-filter";
import type { ApiTokenContext } from "@/lib/mcp/tokens";

const SERVER_INFO = { name: "fisga", version: "1.0.0" };

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function failure(message: string, details?: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      { type: "text", text: details ? `${message}\n${JSON.stringify(details)}` : message },
    ],
  };
}

const days = z
  .number()
  .int()
  .min(1)
  .max(MAX_REPORT_DAYS)
  .optional()
  .describe(`How many days back to cover, 1-${MAX_REPORT_DAYS}. Defaults to 30.`);

const POST_SORT_KEYS = [
  "views",
  "reach",
  "likes",
  "comments",
  "saved",
  "shares",
  "follows",
  "date",
] as const;

function postMetric(post: OverviewPost, key: (typeof POST_SORT_KEYS)[number]): number | null {
  return key === "date" ? Date.parse(post.timestamp) : post[key];
}

/** Largest first; a post Meta has no figure for always goes last. */
export function sortPostsBy(posts: OverviewPost[], key: (typeof POST_SORT_KEYS)[number]) {
  return [...posts].sort((a, b) => {
    const left = postMetric(a, key);
    const right = postMetric(b, key);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  });
}

function registerReadTools(server: McpServer, auth: ApiTokenContext) {
  const workspaceId = auth.workspaceId;
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    "list_instagram_accounts",
    {
      title: "List Instagram accounts",
      description: "The Instagram accounts connected to this workspace. Use the id as instagramAccountId in other tools.",
      annotations: readOnly,
    },
    async () => {
      const accounts = await prisma.instagramAccount.findMany({
        where: { workspaceId },
        orderBy: { connectedAt: "desc" },
        select: { id: true, username: true, name: true, tokenExpiresAt: true, webhookSubscribed: true },
      });
      return json({ accounts });
    }
  );

  server.registerTool(
    "list_campaigns",
    {
      title: "List campaigns",
      description:
        "Comment-to-DM campaigns with their status and all-time DM counts. For clicks and trends use get_campaign_report.",
      inputSchema: {
        instagramAccountId: z.string().optional().describe("Only this account. Omit for all."),
      },
      annotations: readOnly,
    },
    async ({ instagramAccountId }) => {
      const where = { workspaceId, ...(instagramAccountId ? { instagramAccountId } : {}) };
      const [campaigns, statusRows] = await Promise.all([
        prisma.automation.findMany({
          where,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            goal: true,
            isActive: true,
            matchAnyPost: true,
            pendingNextReel: true,
            postUrl: true,
            keywords: true,
            matchAnyWord: true,
            createdAt: true,
            instagramAccount: { select: { username: true } },
          },
        }),
        prisma.dmLog.groupBy({
          by: ["automationId", "status"],
          where: { workspaceId },
          _count: { _all: true },
        }),
      ]);

      const byCampaign = new Map<string, { status: string; _count: number }[]>();
      for (const row of statusRows) {
        byCampaign.set(row.automationId, [
          ...(byCampaign.get(row.automationId) ?? []),
          { status: row.status, _count: row._count._all },
        ]);
      }

      return json({
        campaigns: campaigns.map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          goal: campaign.goal,
          active: campaign.isActive,
          instagram: campaign.instagramAccount.username,
          trigger: campaign.matchAnyPost
            ? "any post"
            : campaign.pendingNextReel
              ? "the next reel"
              : (campaign.postUrl ?? "a specific post"),
          keywords: campaign.matchAnyWord ? "any comment" : campaign.keywords,
          createdAt: campaign.createdAt.toISOString(),
          dms: summarizeDmStatuses(byCampaign.get(campaign.id) ?? []),
        })),
      });
    }
  );

  server.registerTool(
    "get_campaign",
    {
      title: "Get a campaign",
      description: "The full configuration of one campaign: trigger, messages, links and options.",
      inputSchema: { campaignId: z.string().describe("Campaign id from list_campaigns.") },
      annotations: readOnly,
    },
    async ({ campaignId }) => {
      const campaign = await prisma.automation.findFirst({
        where: { id: campaignId, workspaceId },
        include: {
          instagramAccount: { select: { username: true } },
          trackedLinks: {
            where: NOT_AB_VARIANT_LINK,
            orderBy: TRACKED_LINK_ORDER,
            select: { slug: true, label: true, destinationUrl: true },
          },
        },
      });
      if (!campaign) return failure("Campaign not found.");
      const { instagramAccount, trackedLinks, ...config } = campaign;
      return json({
        ...config,
        instagram: instagramAccount.username,
        links: trackedLinks.map((link) => ({
          label: link.label,
          destination: link.destinationUrl,
          trackedUrl: buildTrackedUrl(link.slug),
        })),
      });
    }
  );

  server.registerTool(
    "get_campaign_report",
    {
      title: "Campaign report",
      description:
        "Performance of one campaign over a period: DMs sent/failed/skipped, unique clicks, CTR, top keywords, a day-by-day series and clicks per link.",
      inputSchema: { campaignId: z.string().describe("Campaign id from list_campaigns."), days },
      annotations: readOnly,
    },
    async ({ campaignId, days }) => {
      const report = await getCampaignPerformance(workspaceId, campaignId, days);
      return report ? json(report) : failure("Campaign not found.");
    }
  );

  server.registerTool(
    "get_workspace_report",
    {
      title: "Workspace report",
      description:
        "Overall performance over a period: total DMs and clicks, the best campaigns, top keywords, a day-by-day series and Facebook comment replies.",
      inputSchema: { days },
      annotations: readOnly,
    },
    async ({ days }) => json(await getWorkspacePerformance(workspaceId, days))
  );

  server.registerTool(
    "get_instagram_posts",
    {
      title: "Instagram posts ranking",
      description:
        "Recent posts and Reels with views, reach, likes, comments, saves, shares and followers gained, ranked by a metric you choose. Also returns the follower total. Reads live from Instagram, so it can take several seconds.",
      inputSchema: {
        instagramAccountId: z.string().optional().describe("Account id; omit for the most recent one."),
        fetch: z.number().int().min(1).max(500).optional().describe("How many recent posts to read from Instagram. Default 50."),
        sortBy: z.enum(POST_SORT_KEYS).optional().describe("Rank by this metric, largest first. Default views."),
        limit: z.number().int().min(1).max(50).optional().describe("How many ranked posts to return. Default 10."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ instagramAccountId, fetch, sortBy, limit }) => {
      const account = await getWorkspaceInstagramAccount(workspaceId, instagramAccountId);
      if (!account) return failure("No Instagram account is connected to this workspace.");
      try {
        const overview = await buildInstagramOverview(
          workspaceId,
          account,
          parseOverviewCount(fetch === undefined ? null : String(fetch))
        );
        const ranked = sortPostsBy(overview.posts, sortBy ?? "views").slice(0, limit ?? 10);
        return json({
          account: overview.account.username,
          followers: overview.followers,
          postsRead: overview.totals.posts,
          totalsOfPostsRead: overview.totals,
          insightsAvailable: overview.insightsAvailable,
          rankedBy: sortBy ?? "views",
          posts: ranked.map((post) => ({
            id: post.id,
            caption: post.caption,
            url: post.permalink,
            type: post.mediaType,
            publishedAt: post.timestamp,
            views: post.views,
            reach: post.reach,
            likes: post.likes,
            comments: post.comments,
            saved: post.saved,
            shares: post.shares,
            followersGained: post.follows,
            campaigns: post.campaigns.map((campaign) => ({
              id: campaign.id,
              name: campaign.name,
              active: campaign.isActive,
            })),
          })),
        });
      } catch (error) {
        return failure(
          `Could not read Instagram: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }
  );
}

const campaignFields = {
  name: z.string().min(1).max(100).describe("Campaign name."),
  goal: z.string().max(120).optional().describe("What the campaign is for, e.g. 'Sell the course'."),
  instagramAccountId: z.string().optional().describe("Account id; omit for the most recent one."),
  postId: z.string().optional().describe("Instagram media id of the post to watch. Use get_instagram_posts to find it."),
  postUrl: z.string().url().optional().describe("Permalink of that post."),
  matchAnyPost: z.boolean().optional().describe("Watch every post instead of one."),
  pendingNextReel: z.boolean().optional().describe("Bind to the next Reel that gets published."),
  keywords: z.array(z.string().min(1).max(50)).max(10).optional().describe("Words that trigger the reply, e.g. ['quero']."),
  matchAnyWord: z.boolean().optional().describe("Reply to any comment, ignoring keywords."),
  dmMessage: z.string().min(1).max(1000).describe("The DM sent to the person. {username} is replaced by their name."),
  trackedDestinationUrl: z.string().url().optional().describe("Link to send; it is tracked so clicks appear in reports."),
  linkButtonLabel: z.string().max(20).optional().describe("Text of the link button (max 20 characters)."),
  publicReplyEnabled: z.boolean().optional().describe("Also reply publicly under the comment."),
  publicReplyMessages: z.array(z.string().max(1000)).max(10).optional().describe("Public replies; one is picked at random."),
  requireFollow: z.boolean().optional().describe("Ask the person to follow the account before sending the link."),
  followPromptMessage: z.string().max(1000).optional(),
  followPromptButtonLabel: z.string().max(20).optional(),
  openingDmEnabled: z.boolean().optional().describe("Send an opening DM with a button before the link."),
  openingDmMessage: z.string().max(1000).optional(),
  openingDmButtonLabel: z.string().max(64).optional(),
};

function registerWriteTools(server: McpServer, auth: ApiTokenContext) {
  const workspaceId = auth.workspaceId;

  server.registerTool(
    "create_campaign",
    {
      title: "Create a campaign",
      description:
        "Create a comment-to-DM campaign. It is created PAUSED so nothing is sent yet; set activate=true only when the user has explicitly asked to go live, because an active campaign sends real DMs to real people. Show the user the trigger, keywords and messages and get their OK before activating.",
      inputSchema: {
        ...campaignFields,
        activate: z.boolean().optional().describe("Start sending immediately. Default false (created paused)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ activate, ...fields }) => {
      const parsed = createCampaignSchema.safeParse({ ...fields, isActive: activate ?? false });
      if (!parsed.success) {
        return failure("The campaign is not valid.", parsed.error.flatten());
      }
      const result = await createCampaign(workspaceId, parsed.data);
      if (!result.ok) return failure(result.error, result.details);
      return json({
        created: true,
        id: result.data.id,
        name: result.data.name,
        active: result.data.isActive,
        note: result.data.isActive
          ? "The campaign is live."
          : "The campaign is paused. Use update_campaign with isActive=true to go live.",
      });
    }
  );

  server.registerTool(
    "update_campaign",
    {
      title: "Update or pause a campaign",
      description:
        "Change a campaign's messages, keywords, link or public replies, or pause/resume it with isActive. Resuming makes it send real DMs again, so confirm with the user first.",
      inputSchema: {
        campaignId: z.string().describe("Campaign id from list_campaigns."),
        ...Object.fromEntries(
          Object.entries(campaignFields)
            .filter(([key]) => !["instagramAccountId"].includes(key))
            .map(([key, schema]) => [key, (schema as z.ZodType).optional()])
        ),
        isActive: z.boolean().optional().describe("false pauses the campaign, true resumes it."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ campaignId, ...changes }) => {
      const parsed = updateCampaignSchema.safeParse(changes);
      if (!parsed.success) {
        return failure("The change is not valid.", parsed.error.flatten());
      }
      const result = await updateCampaign(workspaceId, campaignId as string, parsed.data);
      if (!result.ok) return failure(result.error, result.details);
      return json({
        updated: true,
        id: result.data.id,
        name: result.data.name,
        active: result.data.isActive,
      });
    }
  );
}

/** Build a server whose tools act on `auth`'s workspace, with only what its scope allows. */
export function createMcpServer(auth: ApiTokenContext): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Fisga automates Instagram comment-to-DM campaigns. Use list_campaigns and the report tools to answer questions about performance. " +
      (auth.scope === "WRITE"
        ? "New campaigns start paused; only activate one after the user explicitly confirms."
        : "This token is read-only: it can report but not create or change campaigns."),
  });
  registerReadTools(server, auth);
  if (auth.scope === "WRITE") registerWriteTools(server, auth);
  return server;
}
