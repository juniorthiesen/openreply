import { describe, expect, it } from "vitest";
import { summarizeStorySequence } from "@/lib/story-metrics";

describe("Story sequence metrics", () => {
  it("summarizes reach retention and navigation from the first to the last frame", () => {
    const result = summarizeStorySequence([
      { reach: 1000, replies: 2, shares: 1, follows: 3, profileVisits: 4, totalInteractions: 7, navigation: { tap_forward: 300, tap_exit: 25 } },
      { reach: 640, replies: 5, shares: 2, follows: 1, profileVisits: 3, totalInteractions: 9, navigation: { tap_back: 20, TAP_EXIT: 5 } },
    ]);

    expect(result).toEqual({
      firstReach: 1000,
      lastReach: 640,
      completionRate: 0.64,
      replies: 7,
      shares: 3,
      follows: 4,
      profileVisits: 7,
      totalInteractions: 16,
      exits: 30,
    });
  });

  it("handles missing or zero reach without inventing a completion percentage", () => {
    expect(summarizeStorySequence([]).completionRate).toBeNull();
    expect(summarizeStorySequence([{ reach: 0, replies: null, shares: null, follows: null, profileVisits: null, totalInteractions: null, navigation: null }]).completionRate).toBeNull();
  });
});
