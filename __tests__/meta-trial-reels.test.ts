import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstagramMediaContainer, getMediaInsights } from "@/lib/meta/client";

const fetchMock = vi.fn();

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Instagram Trial Reels API requests", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ id: "container-1" }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(["MANUAL", "SS_PERFORMANCE"] as const)(
    "sends Trial Reel parameters with the %s graduation strategy",
    async (strategy) => {
      await createInstagramMediaContainer("token", "ig-user", {
        mediaUrl: "https://example.com/reel.mp4",
        mediaType: "REEL",
        caption: "Teste",
        shareToFeed: true,
        trialGraduationStrategy: strategy,
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = new URLSearchParams(String(init.body));
      expect(body.get("media_type")).toBe("REELS");
      expect(body.get("share_to_feed")).toBe("false");
      expect(JSON.parse(body.get("trial_params") ?? "null")).toEqual({
        graduation_strategy: strategy,
      });
    }
  );

  it("keeps normal Reel feed visibility explicit without trial parameters", async () => {
    await createInstagramMediaContainer("token", "ig-user", {
      mediaUrl: "https://example.com/reel.mp4",
      mediaType: "REEL",
      caption: "Normal",
      shareToFeed: false,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get("share_to_feed")).toBe("false");
    expect(body.has("trial_params")).toBe(false);
  });

  it("leaves metrics absent when the Graph API does not return them", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        { name: "reach", values: [{ value: 320 }] },
        { name: "saved", values: [] },
      ],
    }));

    await expect(getMediaInsights("token", "media-1", ["reach", "saved"])).resolves.toEqual({
      reach: 320,
    });
  });
});
