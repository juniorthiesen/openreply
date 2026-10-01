import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInstagramCarouselContainer,
  createInstagramCarouselItemContainer,
} from "@/lib/meta/client";

const fetchMock = vi.fn();

describe("Instagram carousel publishing requests", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: "container-123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("creates an image item with the carousel-item flag", async () => {
    await createInstagramCarouselItemContainer("token", "ig-user", {
      mediaUrl: "https://example.com/image.jpg",
      mediaType: "IMAGE",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(url).toContain("/ig-user/media");
    expect(body.get("image_url")).toBe("https://example.com/image.jpg");
    expect(body.get("is_carousel_item")).toBe("true");
    expect(body.has("media_type")).toBe(false);
  });

  it("creates a video item and orders carousel children in the parent request", async () => {
    await createInstagramCarouselItemContainer("token", "ig-user", {
      mediaUrl: "https://example.com/video.mp4",
      mediaType: "VIDEO",
    });
    await createInstagramCarouselContainer("token", "ig-user", {
      childContainerIds: ["first", "second"],
      caption: "Legenda do carrossel",
    });

    const videoBody = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    const carouselBody = new URLSearchParams(String(fetchMock.mock.calls[1][1].body));
    expect(videoBody.get("media_type")).toBe("VIDEO");
    expect(videoBody.get("video_url")).toBe("https://example.com/video.mp4");
    expect(videoBody.get("is_carousel_item")).toBe("true");
    expect(carouselBody.get("media_type")).toBe("CAROUSEL");
    expect(carouselBody.get("children")).toBe("first,second");
    expect(carouselBody.get("caption")).toBe("Legenda do carrossel");
  });
});
