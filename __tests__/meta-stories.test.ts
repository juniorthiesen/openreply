import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFacebookInstagramStoryContainer,
  getActiveFacebookInstagramStories,
  getInstagramStoryInsights,
  publishFacebookInstagramStoryContainer,
} from "@/lib/meta/client";

const fetchMock = vi.fn();

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Instagram Stories API requests", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ id: "story-container" }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["IMAGE", "image_url", "https://example.com/frame.jpg"],
    ["VIDEO", "video_url", "https://example.com/frame.mp4"],
  ] as const)("creates a %s Story container", async (mediaType, urlField, mediaUrl) => {
    await createFacebookInstagramStoryContainer("page-token", "ig-user", { mediaType, mediaUrl });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(new URL(url).hostname).toBe("graph.facebook.com");
    expect(url).toContain("/ig-user/media");
    expect(body.get("media_type")).toBe("STORIES");
    expect(body.get(urlField)).toBe(mediaUrl);
  });

  it("reads scalar Story metrics and navigation breakdown separately", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        data: [
          { name: "reach", values: [{ value: 1800 }] },
          { name: "views", values: [{ value: 1975 }] },
          { name: "replies", values: [{ value: 18 }] },
          { name: "total_interactions", total_value: { value: 27 } },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ name: "navigation", values: [{ value: { TAP_FORWARD: 220, TAP_BACK: 31, TAP_EXIT: 42 } }] }],
      }));

    await expect(getInstagramStoryInsights("token", "story-42")).resolves.toEqual({
      reach: 1800,
      views: 1975,
      replies: 18,
      total_interactions: 27,
      navigation: { tap_forward: 220, tap_back: 31, tap_exit: 42 },
    });

    const summaryUrl = new URL(fetchMock.mock.calls[0][0] as string);
    const navigationUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(summaryUrl.hostname).toBe("graph.facebook.com");
    expect(summaryUrl.pathname).toContain("/story-42/insights");
    expect(summaryUrl.searchParams.get("metric")).toContain("reach");
    expect(navigationUrl.searchParams.get("metric")).toBe("navigation");
    expect(navigationUrl.searchParams.get("breakdown")).toBe("story_navigation_action_type");
  });

  it("recovers and publishes Stories through the Facebook Login Graph API", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: "story-1", timestamp: "2026-09-30T10:00:00+0000" }] }));
    await expect(getActiveFacebookInstagramStories("page-token", "ig-user")).resolves.toHaveLength(1);
    await publishFacebookInstagramStoryContainer("page-token", "ig-user", "story-container");

    const activeUrl = new URL(fetchMock.mock.calls[0][0] as string);
    const publishUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(activeUrl.hostname).toBe("graph.facebook.com");
    expect(activeUrl.pathname).toContain("/ig-user/stories");
    expect(publishUrl.hostname).toBe("graph.facebook.com");
    expect(publishUrl.pathname).toContain("/ig-user/media_publish");
    expect(new URLSearchParams(String(fetchMock.mock.calls[1][1].body)).get("creation_id")).toBe("story-container");
  });
});
