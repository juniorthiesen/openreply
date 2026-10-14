/**
 * Instagram overview: recent posts with their metrics, account totals and the
 * follower history. Shared by the overview route and the MCP server so both
 * report the same numbers.
 */

import { prisma } from "@/lib/db/client";
import type { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { getCampaignsForOverviewPost } from "@/lib/overview-campaigns";
import {
  hasTrialReelInsights,
  mergePublishedTrialReels,
} from "@/lib/instagram-overview-media";
import {
  getAllUserMedia,
  getMediaInsights,
  MetaApiError,
  PermissionError,
  type InstagramMedia,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import {
  ensureFollowerHistory,
  getFollowerHistory,
  type FollowerHistoryPoint,
} from "@/lib/reports/follower-history";

// Safety ceiling for "all time": bounds pagination and the number of
// per-media insight requests so we can't hammer the API or time out.
const MAX_POSTS = 500;

// How many insight requests to run at once.
const INSIGHTS_CONCURRENCY = 8;

/** Map over items with a bounded number of in-flight async operations. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export interface OverviewPost {
  id: string;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  mediaType: string;
  timestamp: string;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  /** Accounts that started following from this post; null when Meta has no figure. */
  follows: number | null;
  isTrialReel: boolean;
  trialInsightsAvailable: boolean | null;
  campaigns: ReturnType<typeof getCampaignsForOverviewPost>;
}

export interface OverviewResponse {
  account: { id: string; username: string };
  accounts: Array<{ id: string; username: string }>;
  requestedCount: "all" | number;
  truncated: boolean;
  insightsAvailable: boolean;
  insightsPermissionDenied: boolean;
  /** Current follower total, or null if Instagram did not return it. */
  followers: number | null;
  /**
   * Follower total per day, ascending. Independent of the selected post range —
   * limited to what has been snapshotted plus any 30-day insights backfill.
   */
  followerHistory: FollowerHistoryPoint[];
  totals: {
    posts: number;
    views: number;
    reach: number;
    likes: number;
    comments: number;
    saved: number;
    shares: number;
    follows: number;
    interactions: number;
  };
  posts: OverviewPost[];
}

type WorkspaceAccount = NonNullable<Awaited<ReturnType<typeof getWorkspaceInstagramAccount>>>;

function isVideoLike(media: InstagramMedia): boolean {
  return (
    media.media_product_type === "REELS" || media.media_type === "VIDEO"
  );
}

/** `countParam` is "all" or a positive integer (the last N posts); default 50. */
export function parseOverviewCount(countParam: string | null): "all" | number {
  if (countParam === "all") return "all";
  const parsed = countParam ? Number.parseInt(countParam, 10) : NaN;
  return Number.isFinite(parsed) ? Math.max(parsed, 1) : 50;
}

export async function buildInstagramOverview(
  workspaceId: string,
  account: WorkspaceAccount,
  requestedCount: "all" | number
): Promise<OverviewResponse> {
  const accessToken = decryptToken(account.accessToken);

  const target =
    requestedCount === "all" ? MAX_POSTS : Math.min(requestedCount, MAX_POSTS);

  const [feedMedia, trialPosts] = await Promise.all([
    getAllUserMedia(accessToken, target),
    prisma.scheduledPost.findMany({
      where: {
        workspaceId,
        instagramAccountId: account.id,
        status: "PUBLISHED",
        trialGraduationStrategy: { not: null },
        instagramMediaId: { not: null },
        publishedAt: { not: null },
      },
      orderBy: { publishedAt: "desc" },
      take: target,
      select: {
        instagramMediaId: true,
        caption: true,
        permalink: true,
        publishedAt: true,
      },
    }),
  ]);
  const mediaEntries = mergePublishedTrialReels(
    feedMedia,
    trialPosts.flatMap((post) =>
      post.instagramMediaId && post.publishedAt
        ? [{
            instagramMediaId: post.instagramMediaId,
            caption: post.caption,
            permalink: post.permalink,
            publishedAt: post.publishedAt,
          }]
        : []
    ),
    target
  );
  const truncated = feedMedia.length >= MAX_POSTS || trialPosts.length >= MAX_POSTS;

  // Likes and comments come free with basic media fields. Views / reach /
  // saved / shares require the insights permission, so fetch them per media
  // (bounded concurrency) and degrade gracefully if the token was granted
  // before that scope.
  let insightsAvailable = false;
  let permissionDenied = false;

  const insights = await mapWithConcurrency(
    mediaEntries,
    INSIGHTS_CONCURRENCY,
    async (m) => {
      const metrics = isVideoLike(m.media)
        ? ["views", "reach", "saved", "shares", "total_interactions"]
        : ["reach", "saved", "shares", "total_interactions"];
      // `follows` is not offered for every media type, and Meta rejects the
      // whole request when one metric is invalid. Ask for it together with the
      // rest (one call in the common case) and, only if that is refused, ask
      // again without it so a post never loses its other numbers.
      try {
        const data = await getMediaInsights(accessToken, m.media.id, [...metrics, "follows"]);
        insightsAvailable = true;
        return data;
      } catch (withFollowsError) {
        // Token, rate-limit and quota problems hit the retry the same way.
        if (
          withFollowsError instanceof MetaApiError &&
          [190, 368, 4, 17].includes(withFollowsError.code)
        ) {
          return null;
        }
        try {
          const data = await getMediaInsights(accessToken, m.media.id, metrics);
          insightsAvailable = true;
          return data;
        } catch (err) {
          if (err instanceof PermissionError) permissionDenied = true;
          return null;
        }
      }
    }
  );

  const posts: OverviewPost[] = mediaEntries.map(({ media: m, isTrialReel }, i) => {
    const ins = insights[i];
    const likes = m.like_count ?? (isTrialReel ? null : 0);
    const comments = m.comments_count ?? (isTrialReel ? null : 0);
    const trialInsightsAvailable = isTrialReel
      ? hasTrialReelInsights(ins)
      : null;
    return {
      id: m.id,
      caption: m.caption?.trim().slice(0, 120) ?? null,
      permalink: m.permalink ?? null,
      thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
      mediaType: m.media_product_type ?? m.media_type,
      timestamp: m.timestamp,
      views: ins?.views ?? null,
      reach: ins?.reach ?? null,
      likes,
      comments,
      saved: ins?.saved ?? null,
      shares: ins?.shares ?? null,
      follows: ins?.follows ?? null,
      isTrialReel,
      trialInsightsAvailable,
      campaigns: [],
    };
  });

  const campaignRecords = posts.length
    ? await prisma.automation.findMany({
        where: {
          workspaceId,
          instagramAccountId: account.id,
          OR: [
            { postId: { in: posts.map((post) => post.id) } },
            { matchAnyPost: true },
          ],
        },
        select: {
          id: true,
          name: true,
          postId: true,
          isActive: true,
          matchAnyPost: true,
        },
        orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      })
    : [];

  for (const post of posts) {
    post.campaigns = getCampaignsForOverviewPost(post.id, campaignRecords);
  }

  const totals = posts.reduce(
    (acc, p) => {
      acc.posts += 1;
      acc.views += p.views ?? 0;
      acc.reach += p.reach ?? 0;
      acc.likes += p.likes ?? 0;
      acc.comments += p.comments ?? 0;
      acc.saved += p.saved ?? 0;
      acc.shares += p.shares ?? 0;
      acc.follows += p.follows ?? 0;
      acc.interactions += (p.likes ?? 0) + (p.comments ?? 0) + (p.saved ?? 0) + (p.shares ?? 0);
      return acc;
    },
    {
      posts: 0,
      views: 0,
      reach: 0,
      likes: 0,
      comments: 0,
      saved: 0,
      shares: 0,
      follows: 0,
      interactions: 0,
    }
  );

  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
    select: { id: true, username: true },
  });

  // Followers is a point-in-time figure and deliberately not part of
  // `totals`, which sums over the selected posts. A failure here must not
  // take down the rest of the overview.
  let followers: number | null = null;
  let followerHistory: FollowerHistoryPoint[] = [];
  try {
    followers = await ensureFollowerHistory(
      { id: account.id, instagramId: account.instagramId },
      { provider: "META", accessToken }
    );
    followerHistory = await getFollowerHistory(account.id);
  } catch (err) {
    console.warn(
      "[Instagram Overview] Follower history unavailable:",
      err instanceof Error ? err.message : err
    );
  }

  return {
    account: { id: account.id, username: account.username },
    accounts,
    requestedCount,
    truncated,
    insightsAvailable: insightsAvailable && !permissionDenied,
    insightsPermissionDenied: permissionDenied,
    followers,
    followerHistory,
    totals,
    posts,
  };
}
