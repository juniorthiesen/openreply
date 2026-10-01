import type { InstagramMedia, InstagramMediaInsights } from "@/lib/meta/client";

export interface PublishedTrialReel {
  instagramMediaId: string;
  caption: string;
  permalink: string | null;
  publishedAt: Date | string;
}

export interface OverviewMediaItem {
  media: InstagramMedia;
  isTrialReel: boolean;
}

export function hasTrialReelInsights(
  insights: InstagramMediaInsights | null | undefined
): boolean {
  return [insights?.views, insights?.reach, insights?.saved, insights?.shares].some(
    (value) => typeof value === "number"
  );
}

export function mergePublishedTrialReels(
  feedMedia: InstagramMedia[],
  trialReels: PublishedTrialReel[],
  limit: number
): OverviewMediaItem[] {
  const mediaById = new Map<string, OverviewMediaItem>();

  for (const media of feedMedia) {
    mediaById.set(media.id, { media, isTrialReel: false });
  }

  for (const trial of trialReels) {
    const existing = mediaById.get(trial.instagramMediaId);
    if (existing) {
      existing.isTrialReel = true;
      existing.media = {
        ...existing.media,
        caption: existing.media.caption?.trim() || trial.caption,
        permalink: existing.media.permalink ?? trial.permalink ?? undefined,
      };
      continue;
    }

    mediaById.set(trial.instagramMediaId, {
      media: {
        id: trial.instagramMediaId,
        caption: trial.caption,
        media_type: "VIDEO",
        media_product_type: "REELS",
        timestamp:
          trial.publishedAt instanceof Date
            ? trial.publishedAt.toISOString()
            : trial.publishedAt,
        ...(trial.permalink ? { permalink: trial.permalink } : {}),
      },
      isTrialReel: true,
    });
  }

  return [...mediaById.values()]
    .sort(
      (left, right) =>
        Date.parse(right.media.timestamp) - Date.parse(left.media.timestamp)
    )
    .slice(0, Math.max(0, limit));
}
