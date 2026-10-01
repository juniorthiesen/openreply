import { describe, expect, it } from "vitest";
import { validateTrialReelAssets } from "@/lib/scheduling/trial-reels";

describe("Trial Reel scheduling validation", () => {
  it("accepts one video with either graduation strategy", () => {
    expect(validateTrialReelAssets([{ contentType: "video/mp4" }], "MANUAL")).toBeNull();
    expect(validateTrialReelAssets([{ contentType: "video/quicktime" }], "SS_PERFORMANCE")).toBeNull();
  });

  it("rejects images and multiple media when a trial strategy is selected", () => {
    expect(validateTrialReelAssets([{ contentType: "image/jpeg" }], "MANUAL")).toBe(
      "Reels de teste aceitam apenas um vídeo."
    );
    expect(validateTrialReelAssets([
      { contentType: "video/mp4" },
      { contentType: "video/mp4" },
    ], "SS_PERFORMANCE")).toBe("Um Reel de teste precisa ter apenas um vídeo.");
  });

  it("does not restrict standard posts when no trial strategy is set", () => {
    expect(validateTrialReelAssets([{ contentType: "image/jpeg" }], null)).toBeNull();
    expect(validateTrialReelAssets([
      { contentType: "image/jpeg" },
      { contentType: "video/mp4" },
    ])).toBeNull();
  });
});
