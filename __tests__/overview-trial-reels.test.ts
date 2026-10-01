import { describe, expect, it } from "vitest";
import {
  hasTrialReelInsights,
  mergePublishedTrialReels,
} from "@/lib/instagram-overview-media";

describe("Overview Trial Reel media merge", () => {
  it("only marks insights available when the API returned a numeric metric", () => {
    expect(hasTrialReelInsights({ reach: 0 })).toBe(true);
    expect(hasTrialReelInsights({ reach: undefined, views: undefined })).toBe(false);
    expect(hasTrialReelInsights(null)).toBe(false);
  });

  it("adds saved trial media IDs that are missing from the account feed", () => {
    const items = mergePublishedTrialReels(
      [{ id: "feed-1", media_type: "IMAGE", timestamp: "2026-09-29T10:00:00.000Z" }],
      [{
        instagramMediaId: "trial-1",
        caption: "Trial caption",
        permalink: "https://instagram.com/reel/trial-1",
        publishedAt: new Date("2026-09-30T10:00:00.000Z"),
      }],
      10
    );

    expect(items.map(({ media, isTrialReel }) => [media.id, isTrialReel])).toEqual([
      ["trial-1", true],
      ["feed-1", false],
    ]);
    expect(items[0].media.media_product_type).toBe("REELS");
    expect(items[0].media.caption).toBe("Trial caption");
  });

  it("marks a trial Reel already returned in the feed instead of duplicating it", () => {
    const items = mergePublishedTrialReels(
      [{
        id: "trial-1",
        media_type: "VIDEO",
        media_product_type: "REELS",
        timestamp: "2026-09-30T10:00:00.000Z",
      }],
      [{
        instagramMediaId: "trial-1",
        caption: "Saved caption",
        permalink: "https://instagram.com/reel/trial-1",
        publishedAt: "2026-09-30T10:00:00.000Z",
      }],
      10
    );

    expect(items).toHaveLength(1);
    expect(items[0].isTrialReel).toBe(true);
    expect(items[0].media.caption).toBe("Saved caption");
    expect(items[0].media.permalink).toBe("https://instagram.com/reel/trial-1");
  });

  it("keeps the newest media within the requested range", () => {
    const items = mergePublishedTrialReels(
      [
        { id: "old", media_type: "IMAGE", timestamp: "2026-09-28T10:00:00.000Z" },
        { id: "new", media_type: "IMAGE", timestamp: "2026-09-30T10:00:00.000Z" },
      ],
      [{
        instagramMediaId: "trial",
        caption: "Newest",
        permalink: null,
        publishedAt: "2026-10-01T10:00:00.000Z",
      }],
      2
    );

    expect(items.map(({ media }) => media.id)).toEqual(["trial", "new"]);
  });
});
