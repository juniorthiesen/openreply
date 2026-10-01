import { describe, expect, it } from "vitest";
import { buildGrowthAnalytics } from "@/lib/growth/analytics";

describe("Growth analytics", () => {
  const now = new Date("2026-09-30T16:00:00.000Z");

  it("sums available metrics without turning real zeroes into missing values", () => {
    const result = buildGrowthAnalytics({
      periodDays: 30,
      timeZone: "America/Sao_Paulo",
      now,
      posts: [
        {
          id: "reel-1",
          mediaType: "REELS",
          timestamp: "2026-09-30T13:10:00.000Z",
          reach: 100,
          likes: 10,
          comments: 2,
          saved: 1,
          shares: 3,
          totalInteractions: 17,
          campaignDms: 0,
        },
        {
          id: "carousel-1",
          mediaType: "CAROUSEL_ALBUM",
          timestamp: "2026-09-30T14:10:00.000Z",
          reach: 200,
          likes: 0,
          comments: 0,
          saved: 0,
          shares: 0,
          totalInteractions: 0,
          campaignDms: 4,
        },
      ],
      stories: [
        {
          id: "story-1",
          publishedAt: "2026-09-30T15:10:00.000Z",
          reach: 40,
          views: 55,
          replies: 2,
          shares: 1,
          totalInteractions: 5,
        },
        {
          id: "story-2",
          publishedAt: "2026-09-30T16:00:00.000Z",
          reach: null,
          views: null,
          replies: null,
          shares: null,
          totalInteractions: null,
        },
      ],
      followerHistory: [
        { date: "2026-09-29", followers: 1000, delta: -2 },
        { date: "2026-09-30", followers: 1003, delta: 3 },
      ],
      keywordComments: 3,
      sentDms: 6,
      clicks: 2,
      goals: { feedPerWeek: 4, storyDaysPerWeek: 6 },
    });

    expect(result.summary).toEqual({
      followersGained: 1,
      reach: 340,
      interactions: 22,
      engagementRate: (22 / 340) * 100,
      feedPosts: 2,
      storySlides: 2,
      storyDays: 1,
      conversations: 6,
    });
    expect(result.formats.find((format) => format.id === "reels")).toMatchObject({
      count: 1,
      averageReach: 100,
      campaignDms: 0,
    });
    expect(result.formats.find((format) => format.id === "carousel")).toMatchObject({
      count: 1,
      averageReach: 200,
      campaignDms: 4,
    });
    expect(result.formats.find((format) => format.id === "stories")).toMatchObject({
      count: 2,
      averageReach: 40,
    });
  });

  it("groups publishing activity and ranks time slots only with enough samples", () => {
    const posts = [0, 1].map((index) => ({
      id: `post-${index}`,
      mediaType: "IMAGE",
      timestamp: `2026-09-30T${13 + index}:10:00.000Z`,
      reach: 100,
      likes: 10 + index * 10,
      comments: 1,
      saved: 0,
      shares: 0,
      totalInteractions: null,
      campaignDms: null,
    }));
    const result = buildGrowthAnalytics({
      periodDays: 30,
      timeZone: "America/Sao_Paulo",
      now,
      posts,
      stories: [],
      followerHistory: [],
      keywordComments: 0,
      sentDms: 0,
      clicks: 0,
      goals: { feedPerWeek: 4, storyDaysPerWeek: 6 },
    });

    expect(result.summary.feedPosts).toBe(2);
    expect(result.heatmap.find((cell) => cell.weekday === 2 && cell.hour === 10)).toMatchObject({
      sampleSize: 2,
      averageInteractions: 16,
      rank: 1,
    });
    expect(result.feedAveragePerWeek).toBeCloseTo((2 / 30) * 7);
    expect(result.heatmap.find((cell) => cell.weekday === 2 && cell.hour === 12)?.rank).toBeNull();
  });

  it("leaves insight totals unavailable when there is no content or follower history", () => {
    const result = buildGrowthAnalytics({
      periodDays: 90,
      timeZone: "invalid-zone",
      now,
      posts: [],
      stories: [],
      followerHistory: [],
      keywordComments: 0,
      sentDms: 0,
      clicks: 0,
      goals: { feedPerWeek: 4, storyDaysPerWeek: 6 },
    });

    expect(result.summary.followersGained).toBeNull();
    expect(result.summary.reach).toBeNull();
    expect(result.summary.engagementRate).toBeNull();
    expect(result.insight).toContain("histórico suficiente");
  });
});
