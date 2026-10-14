/**
 * Facebook Page Graph API calls: video metrics, Page insights and the two ways
 * of answering a comment (private reply to Messenger, public reply).
 *
 * Meta renames and retires Page insight metrics often, and a metric the app
 * can't read fails the whole request it is part of. Insights are therefore
 * requested one metric at a time and a failed metric is reported as unavailable
 * (null) instead of failing the screen: a partial view beats an empty one.
 */

import {
  PermissionError,
  TokenExpiredError,
  facebookGraphBase,
  handleResponse,
} from "@/lib/meta/client";

export interface FacebookPageSummary {
  id: string;
  name: string;
  followers: number | null;
  fans: number | null;
  link: string | null;
}

export interface FacebookVideo {
  id: string;
  title: string | null;
  description: string | null;
  createdTime: string | null;
  lengthSeconds: number | null;
  permalinkUrl: string | null;
  thumbnailUrl: string | null;
  isReel: boolean;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** From video insights; null when Meta doesn't offer the metric. */
  impressions: number | null;
  reach: number | null;
  reactions: number | null;
}

export interface FacebookPageInsights {
  periodDays: number;
  views: number | null;
  reach: number | null;
  engagements: number | null;
  followsGained: number | null;
}

type InsightEntry = {
  name: string;
  values?: Array<{ value?: number | Record<string, number> }>;
  total_value?: { value?: number | Record<string, number> };
};

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** An insight value is a number, or an object of counts (reactions by type). */
export function insightTotal(
  value: number | Record<string, number> | undefined
): number | null {
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    return Object.values(value).reduce(
      (sum, item) => sum + (typeof item === "number" ? item : 0),
      0
    );
  }
  return null;
}

/** Sum every datapoint of an insight series (daily values) or its total. */
export function sumInsightEntry(entry: InsightEntry | undefined): number | null {
  if (!entry) return null;
  if (entry.total_value?.value !== undefined) {
    return insightTotal(entry.total_value.value);
  }
  if (!entry.values?.length) return null;
  let total = 0;
  let found = false;
  for (const point of entry.values) {
    const value = insightTotal(point.value);
    if (value !== null) {
      total += value;
      found = true;
    }
  }
  return found ? total : null;
}

// A token or permission problem is the same for every metric, so it must reach
// the caller; only "this metric doesn't exist / isn't available" is swallowed.
function rethrowIfAccessProblem(error: unknown) {
  if (error instanceof TokenExpiredError) throw error;
  if (error instanceof PermissionError && (error.code === 10 || error.code === 200)) {
    throw error;
  }
}

async function readInsights(
  accessToken: string,
  objectId: string,
  metrics: string[],
  extra: Record<string, string> = {}
): Promise<InsightEntry[]> {
  const url = new URL(`${facebookGraphBase()}/${objectId}/insights`);
  url.searchParams.set("metric", metrics.join(","));
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  const page = await handleResponse<{ data?: InsightEntry[] }>(
    await fetch(url.toString(), {
      headers: authHeaders(accessToken),
      signal: AbortSignal.timeout(15_000),
    })
  );
  return page.data ?? [];
}

/** One metric alone, so an invalid one costs only itself. */
async function readInsightTotal(
  accessToken: string,
  objectId: string,
  metric: string,
  extra: Record<string, string> = {}
): Promise<number | null> {
  try {
    const entries = await readInsights(accessToken, objectId, [metric], extra);
    return sumInsightEntry(entries.find((entry) => entry.name === metric));
  } catch (error) {
    rethrowIfAccessProblem(error);
    return null;
  }
}

export async function getFacebookPageSummary(
  accessToken: string,
  pageId: string
): Promise<FacebookPageSummary> {
  const url = new URL(`${facebookGraphBase()}/${pageId}`);
  url.searchParams.set("fields", "id,name,followers_count,fan_count,link");
  const data = await handleResponse<{
    id: string;
    name: string;
    followers_count?: number;
    fan_count?: number;
    link?: string;
  }>(await fetch(url.toString(), { headers: authHeaders(accessToken) }));
  return {
    id: data.id,
    name: data.name,
    followers: numberOrNull(data.followers_count),
    fans: numberOrNull(data.fan_count),
    link: data.link ?? null,
  };
}

const VIDEO_FIELDS =
  "id,title,description,created_time,length,permalink_url,picture,views," +
  "likes.summary(true).limit(0),comments.summary(true).limit(0)";

type RawVideo = {
  id: string;
  title?: string;
  description?: string;
  created_time?: string;
  length?: number;
  permalink_url?: string;
  picture?: string;
  views?: number;
  likes?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
};

export function toFacebookVideo(raw: RawVideo, isReel: boolean): FacebookVideo {
  return {
    id: raw.id,
    title: raw.title?.trim() || null,
    description: raw.description?.trim() || null,
    createdTime: raw.created_time ?? null,
    lengthSeconds: numberOrNull(raw.length),
    permalinkUrl: raw.permalink_url
      ? raw.permalink_url.startsWith("http")
        ? raw.permalink_url
        : `https://www.facebook.com${raw.permalink_url}`
      : null,
    thumbnailUrl: raw.picture ?? null,
    isReel,
    views: numberOrNull(raw.views),
    likes: numberOrNull(raw.likes?.summary?.total_count),
    comments: numberOrNull(raw.comments?.summary?.total_count),
    impressions: null,
    reach: null,
    reactions: null,
  };
}

async function listVideoEdge(
  accessToken: string,
  pageId: string,
  edge: "videos" | "video_reels",
  limit: number
): Promise<FacebookVideo[]> {
  const url = new URL(`${facebookGraphBase()}/${pageId}/${edge}`);
  url.searchParams.set("fields", VIDEO_FIELDS);
  url.searchParams.set("limit", String(Math.min(limit, 50)));
  const data = await handleResponse<{ data?: RawVideo[] }>(
    await fetch(url.toString(), {
      headers: authHeaders(accessToken),
      signal: AbortSignal.timeout(20_000),
    })
  );
  return (data.data ?? []).map((raw) => toFacebookVideo(raw, edge === "video_reels"));
}

/**
 * The Page's videos and Reels, newest first. The two edges overlap for some
 * videos, so they are merged by id; one of them failing (a Page without Reels
 * access) doesn't hide the other.
 */
export async function getFacebookPageVideos(
  accessToken: string,
  pageId: string,
  limit = 25
): Promise<FacebookVideo[]> {
  const [videos, reels] = await Promise.allSettled([
    listVideoEdge(accessToken, pageId, "videos", limit),
    listVideoEdge(accessToken, pageId, "video_reels", limit),
  ]);
  for (const result of [videos, reels]) {
    if (result.status === "rejected") rethrowIfAccessProblem(result.reason);
  }
  if (videos.status === "rejected" && reels.status === "rejected") {
    throw videos.reason;
  }

  const byId = new Map<string, FacebookVideo>();
  for (const list of [reels, videos]) {
    if (list.status !== "fulfilled") continue;
    for (const video of list.value) {
      const existing = byId.get(video.id);
      byId.set(video.id, existing ? { ...video, isReel: existing.isReel || video.isReel } : video);
    }
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.createdTime ?? "") - Date.parse(a.createdTime ?? ""))
    .slice(0, limit);
}

const VIDEO_INSIGHT_METRICS = {
  impressions: "total_video_impressions",
  reach: "total_video_impressions_unique",
  reactions: "total_video_reactions_by_type_total",
} as const;

type VideoInsightKey = keyof typeof VIDEO_INSIGHT_METRICS;
const VIDEO_INSIGHT_KEYS = Object.keys(VIDEO_INSIGHT_METRICS) as VideoInsightKey[];

/** Reach, impressions and reactions of one video; null for what Meta won't give. */
export async function getFacebookVideoInsights(
  accessToken: string,
  videoId: string
): Promise<Pick<FacebookVideo, VideoInsightKey>> {
  const result: Pick<FacebookVideo, VideoInsightKey> = {
    impressions: null,
    reach: null,
    reactions: null,
  };

  try {
    const entries = await readInsights(
      accessToken,
      videoId,
      VIDEO_INSIGHT_KEYS.map((key) => VIDEO_INSIGHT_METRICS[key])
    );
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    for (const key of VIDEO_INSIGHT_KEYS) {
      result[key] = sumInsightEntry(byName.get(VIDEO_INSIGHT_METRICS[key]));
    }
    return result;
  } catch (error) {
    rethrowIfAccessProblem(error);
  }

  // One invalid metric fails the combined request: ask for them one by one.
  for (const key of VIDEO_INSIGHT_KEYS) {
    result[key] = await readInsightTotal(accessToken, videoId, VIDEO_INSIGHT_METRICS[key], {
      period: "lifetime",
    });
  }
  return result;
}

const PAGE_INSIGHT_METRICS = {
  views: "page_media_view",
  reach: "page_total_media_view_unique",
  engagements: "page_post_engagements",
  followsGained: "page_daily_follows_unique",
} as const;

export async function getFacebookPageInsights(
  accessToken: string,
  pageId: string,
  days = 28
): Promise<FacebookPageInsights> {
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86_400;
  const range = { period: "day", since: String(since), until: String(until) };

  const keys = Object.keys(PAGE_INSIGHT_METRICS) as Array<keyof typeof PAGE_INSIGHT_METRICS>;
  const totals = await Promise.all(
    keys.map((key) => readInsightTotal(accessToken, pageId, PAGE_INSIGHT_METRICS[key], range))
  );
  return {
    periodDays: days,
    views: totals[0],
    reach: totals[1],
    engagements: totals[2],
    followsGained: totals[3],
  };
}

/** Run `task` over `items`, `limit` at a time, keeping the input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]);
      }
    })
  );
  return results;
}

/** Permissions a Page token actually carries, via the app token. Null if unknown. */
export async function getPageTokenScopes(pageAccessToken: string): Promise<string[] | null> {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return null;
  try {
    const url = new URL(`${facebookGraphBase()}/debug_token`);
    url.searchParams.set("input_token", pageAccessToken);
    url.searchParams.set("access_token", `${appId}|${appSecret}`);
    const data = await handleResponse<{ data?: { scopes?: string[] } }>(
      await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) })
    );
    return data.data?.scopes ?? null;
  } catch {
    return null;
  }
}

/** What each feature needs, so the UI can say which permission is missing. */
export const FACEBOOK_FEATURE_SCOPES = {
  metrics: ["pages_read_engagement", "read_insights"],
  commentReplies: ["pages_read_engagement", "pages_manage_engagement", "pages_messaging"],
} as const;

export function missingScopes(
  granted: string[] | null,
  required: readonly string[]
): string[] {
  if (!granted) return [];
  return required.filter((scope) => !granted.includes(scope));
}

export interface FacebookLinkButton {
  title: string;
  url: string;
}

/**
 * Private reply to a comment: lands in the commenter's Messenger inbox. Meta
 * allows one per comment, within 7 days. With a link it is sent as a button
 * template, which reads better than a bare URL.
 */
export async function sendFacebookPrivateReply(
  pageAccessToken: string,
  pageId: string,
  commentId: string,
  text: string,
  button?: FacebookLinkButton
): Promise<{ recipient_id?: string; message_id?: string }> {
  const message = button
    ? {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: text.slice(0, 640),
            buttons: [{ type: "web_url", url: button.url, title: button.title.slice(0, 20) }],
          },
        },
      }
    : { text: text.slice(0, 2000) };

  return handleResponse(
    await fetch(`${facebookGraphBase()}/${pageId}/messages`, {
      method: "POST",
      headers: { ...authHeaders(pageAccessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { comment_id: commentId }, message }),
    })
  );
}

/** Public reply under the commenter's comment. */
export async function sendFacebookCommentReply(
  pageAccessToken: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  return handleResponse(
    await fetch(`${facebookGraphBase()}/${commentId}/comments`, {
      method: "POST",
      headers: { ...authHeaders(pageAccessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    })
  );
}
