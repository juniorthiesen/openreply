import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_METRICS_REFRESH_INTERVAL_MS,
  externalMediaStorageKey,
  externalStoriesToCsv,
  filterExternalStories,
  isAllowedStoryMediaUrl,
  isMediaPurgeDue,
  needsMetricsRefresh,
  parseMediaRetentionDays,
  type ExternalStoryExportRow,
} from "@/lib/instagram-stories/external";
import { getMediaStoragePath } from "@/lib/media-assets";
import { getLiveFacebookInstagramStories, getLiveInstagramStories } from "@/lib/meta/client";

describe("filterExternalStories", () => {
  const live = [
    { id: "a", timestamp: "2026-10-09T10:00:00+0000" },
    { id: "b", timestamp: "2026-10-09T11:00:00+0000" },
    { id: "c", timestamp: "2026-10-09T12:00:00+0000" },
  ];

  it("drops Stories that Fisga published itself", () => {
    expect(filterExternalStories(live, new Set(["b"])).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("keeps everything when Fisga published none of them", () => {
    expect(filterExternalStories(live, new Set())).toHaveLength(3);
  });
});

describe("needsMetricsRefresh", () => {
  const now = new Date("2026-10-09T12:00:00Z");

  it("asks for a first snapshot", () => {
    expect(needsMetricsRefresh(null, now)).toBe(true);
    expect(needsMetricsRefresh(undefined, now)).toBe(true);
  });

  it("waits until the interval has passed", () => {
    const recent = new Date(now.getTime() - EXTERNAL_METRICS_REFRESH_INTERVAL_MS + 1000);
    const old = new Date(now.getTime() - EXTERNAL_METRICS_REFRESH_INTERVAL_MS);
    expect(needsMetricsRefresh(recent, now)).toBe(false);
    expect(needsMetricsRefresh(old, now)).toBe(true);
  });
});

describe("externalStoriesToCsv", () => {
  const base: ExternalStoryExportRow = {
    instagramMediaId: "17900000000000001",
    username: "marina.atelie",
    mediaType: "IMAGE",
    caption: 'Oi, "pessoal"\nlink na bio',
    permalink: "https://instagram.com/stories/marina.atelie/17900000000000001",
    postedAt: new Date("2026-10-09T10:00:00Z"),
    firstSeenAt: new Date("2026-10-09T10:15:00Z"),
    lastCapturedAt: new Date("2026-10-09T18:00:00Z"),
    reach: 120,
    views: 150,
    replies: 3,
    shares: 1,
    follows: 2,
    profileVisits: 9,
    totalInteractions: 14,
  };

  it("writes a header and one line per Story", () => {
    const lines = externalStoriesToCsv([base]).trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "id_midia,conta,tipo,legenda,link,publicado_em,visto_pela_primeira_vez_em,ultima_captura_em,alcance,visualizacoes,respostas,compartilhamentos,novos_seguidores,visitas_ao_perfil,interacoes_totais"
    );
    expect(externalStoriesToCsv([base])).toContain("2026-10-09T10:00:00.000Z");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(externalStoriesToCsv([base])).toContain('"Oi, ""pessoal""\nlink na bio"');
  });

  it("leaves missing metrics empty and defuses spreadsheet formulas", () => {
    const csv = externalStoriesToCsv([
      { ...base, caption: "=HYPERLINK(\"x\")", lastCapturedAt: null, reach: null },
    ]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("2026-10-09T10:15:00.000Z,,,150,3,1,2,9,14");
  });
});

describe("Story media retention", () => {
  it("defaults to 7 days and ignores invalid values", () => {
    expect(parseMediaRetentionDays(undefined)).toBe(7);
    expect(parseMediaRetentionDays("")).toBe(7);
    expect(parseMediaRetentionDays("abc")).toBe(7);
    expect(parseMediaRetentionDays("0")).toBe(7);
    expect(parseMediaRetentionDays("-3")).toBe(7);
  });

  it("accepts a custom number of days and caps it at 90", () => {
    expect(parseMediaRetentionDays("14")).toBe(14);
    expect(parseMediaRetentionDays("3.9")).toBe(3);
    expect(parseMediaRetentionDays("500")).toBe(90);
  });

  it("flags a copy for deletion only after the window", () => {
    const stored = new Date("2026-10-09T12:00:00Z");
    expect(isMediaPurgeDue(stored, new Date("2026-10-16T11:59:59Z"), 7)).toBe(false);
    expect(isMediaPurgeDue(stored, new Date("2026-10-16T12:00:00Z"), 7)).toBe(true);
    expect(isMediaPurgeDue(null, new Date("2026-12-01T00:00:00Z"), 7)).toBe(false);
  });
});

describe("isAllowedStoryMediaUrl", () => {
  it.each([
    "https://scontent-gru1-1.cdninstagram.com/v/t51/story.jpg",
    "https://video.xx.fbcdn.net/o1/v/story.mp4",
  ])("allows Meta CDN hosts: %s", (url) => {
    expect(isAllowedStoryMediaUrl(url)).toBe(true);
  });

  it.each([
    "http://scontent.cdninstagram.com/story.jpg",
    "https://evil.example.com/story.jpg",
    "https://cdninstagram.com.evil.example/story.jpg",
    "https://notcdninstagram.com/story.jpg",
    "not a url",
  ])("rejects %s", (url) => {
    expect(isAllowedStoryMediaUrl(url)).toBe(false);
  });
});

describe("externalMediaStorageKey", () => {
  it("produces a key the media storage accepts", () => {
    const key = externalMediaStorageKey("cmabc123XYZ", "mp4");
    expect(key).toBe("ext_cmabc123XYZ.mp4");
    expect(getMediaStoragePath(key)).toContain("ext_cmabc123XYZ.mp4");
    expect(() => getMediaStoragePath(`ext_cmabc123XYZ.upload`)).not.toThrow();
  });
});

describe("getLiveFacebookInstagramStories", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("asks Meta for the fields worth keeping", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "s1", timestamp: "2026-10-09T10:00:00+0000" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(getLiveFacebookInstagramStories("page-token", "ig-user")).resolves.toHaveLength(1);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toContain("/ig-user/stories");
    expect(url.searchParams.get("fields")).toBe("id,media_type,timestamp,media_url,permalink,caption");
  });

  it("reads Stories with an Instagram Login token from the Instagram host, no Page needed", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "s1", timestamp: "2026-10-09T10:00:00+0000" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    await getLiveInstagramStories("ig-token", "ig-user", "instagram");
    await getLiveInstagramStories("page-token", "ig-user", "facebook");

    expect(new URL(fetchMock.mock.calls[0][0] as string).host).toContain("graph.instagram.com");
    expect(new URL(fetchMock.mock.calls[1][0] as string).host).toContain("graph.facebook.com");
  });
});
