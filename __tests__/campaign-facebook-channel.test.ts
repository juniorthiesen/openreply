import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const tx = {
    automation: { update: vi.fn() },
    trackedLink: { findFirst: vi.fn() },
    facebookAutomation: { upsert: vi.fn(), deleteMany: vi.fn() },
  };
  return {
    tx,
    workspace: { findUnique: vi.fn() },
    instagramAccount: { findFirst: vi.fn() },
    facebookPage: { findFirst: vi.fn() },
    automation: { create: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
    facebookAutomation: { create: vi.fn(), findUnique: vi.fn() },
    abTest: { findFirst: vi.fn() },
    externalStory: { findFirst: vi.fn() },
    trackedLink: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: db }));
vi.mock("@/lib/campaigns/links", () => ({
  buildInitialCampaignLinks: () => [],
  syncCampaignLinks: vi.fn(),
}));

import {
  buildFacebookRuleData,
  findFacebookIncompatibility,
} from "@/lib/campaigns/facebook-channel";
import {
  createCampaign,
  createCampaignSchema,
  updateCampaign,
  updateCampaignSchema,
} from "@/lib/campaigns/service";

const shared = {
  name: "Promo",
  keywords: ["quero"],
  matchAnyWord: false,
  wholeWordMatch: true,
  dmMessage: "Oi, {username}! {link}",
  linkUrl: "https://exemplo.com/oferta",
  linkButtonLabel: "Ver oferta",
  publicReplyEnabled: true,
  publicReplyMessages: [" Te enviei! ", ""],
  isActive: true,
};
const channel = { facebookPageId: "page1", matchAnyPost: false, videoId: "VID1", videoTitle: "Vídeo", videoUrl: "https://fb.com/v" };

describe("buildFacebookRuleData", () => {
  it("derives the Facebook half from the shared campaign fields", () => {
    expect(buildFacebookRuleData(shared, channel)).toMatchObject({
      facebookPageId: "page1",
      name: "Promo",
      videoId: "VID1",
      keywords: ["quero"],
      dmMessage: "Oi, {username}! {link}",
      linkUrl: "https://exemplo.com/oferta",
      linkButtonLabel: "Ver oferta",
      publicReplyEnabled: true,
      publicReplyMessages: ["Te enviei!"],
      isActive: true,
    });
  });

  it("drops keywords for any-word, the video for any-post, and the label without a link", () => {
    const data = buildFacebookRuleData(
      { ...shared, matchAnyWord: true, linkUrl: null, publicReplyEnabled: false },
      { ...channel, matchAnyPost: true }
    );
    expect(data).toMatchObject({
      keywords: [],
      videoId: null,
      videoTitle: null,
      linkUrl: null,
      linkButtonLabel: null,
      publicReplyEnabled: false,
      publicReplyMessages: [],
    });
  });

  it("refuses public replies longer than Facebook allows", () => {
    expect(findFacebookIncompatibility({ publicReplyEnabled: true, publicReplyMessages: ["x".repeat(501)] })).toMatch(/500/);
    expect(findFacebookIncompatibility({ publicReplyEnabled: false, publicReplyMessages: ["x".repeat(501)] })).toBeNull();
  });
});

describe("campaign schemas", () => {
  const base = { name: "Promo", dmMessage: "Oi", matchAnyPost: true, matchAnyWord: true };

  it("makes the Facebook channel optional and requires a video unless any-video", () => {
    expect(createCampaignSchema.safeParse(base).success).toBe(true);
    expect(createCampaignSchema.safeParse({ ...base, facebook: { facebookPageId: "p" } }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...base, facebook: { facebookPageId: "p", videoId: "1" } }).success).toBe(true);
    expect(createCampaignSchema.safeParse({ ...base, facebook: { facebookPageId: "p", matchAnyPost: true } }).success).toBe(true);
    expect(updateCampaignSchema.safeParse({ facebook: null }).success).toBe(true);
  });
});

describe("createCampaign with Facebook", () => {
  const input = createCampaignSchema.parse({
    name: "Promo",
    dmMessage: "Oi",
    keywords: ["quero"],
    postId: "123",
    facebook: { facebookPageId: "page1", videoId: "VID1" },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    db.workspace.findUnique.mockResolvedValue({ id: "ws1" });
    db.instagramAccount.findFirst.mockResolvedValue({ id: "ig1" });
    db.facebookPage.findFirst.mockResolvedValue({ id: "page1" });
    db.automation.create.mockResolvedValue({ id: "auto1", name: "Promo" });
    db.automation.delete.mockResolvedValue({});
    db.facebookAutomation.create.mockResolvedValue({ id: "rule1" });
  });

  it("creates the Instagram campaign and its linked Facebook rule", async () => {
    const result = await createCampaign("ws1", input);
    expect(result.ok).toBe(true);
    expect(db.facebookAutomation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws1",
        automationId: "auto1",
        facebookPageId: "page1",
        videoId: "VID1",
        keywords: ["quero"],
        dmMessage: "Oi",
      }),
    });
  });

  it("refuses a Page that is not connected to this workspace, creating nothing", async () => {
    db.facebookPage.findFirst.mockResolvedValue(null);
    const result = await createCampaign("ws1", input);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(db.automation.create).not.toHaveBeenCalled();
  });

  it("does not leave the Instagram half behind when the Facebook half fails", async () => {
    db.facebookAutomation.create.mockRejectedValue(new Error("db down"));
    await expect(createCampaign("ws1", input)).rejects.toThrow("db down");
    expect(db.automation.delete).toHaveBeenCalledWith({ where: { id: "auto1" } });
  });

  it("creates no Facebook rule for an Instagram-only campaign", async () => {
    const { facebook: _unused, ...instagramOnly } = input;
    void _unused;
    await createCampaign("ws1", instagramOnly as typeof input);
    expect(db.facebookAutomation.create).not.toHaveBeenCalled();
  });
});

describe("updateCampaign and the Facebook half", () => {
  const existing = {
    id: "auto1", workspaceId: "ws1", name: "Promo", keywords: ["quero"], matchAnyWord: false,
    matchAnyPost: true, pendingNextReel: false, postId: null, wholeWordMatch: true,
    dmMessage: "Oi", linkButtonLabel: null, publicReplyEnabled: false, publicReplyMessage: null,
    publicReplyMessages: [] as string[], isActive: true, openingDmEnabled: false,
    openingDmMessage: null, openingDmButtonLabel: null, storyMediaId: null,
  };
  const rule = { facebookPageId: "page1", matchAnyPost: false, videoId: "VID1", videoTitle: "V", videoUrl: null };

  beforeEach(() => {
    vi.clearAllMocks();
    db.automation.findFirst.mockResolvedValue(existing);
    db.abTest.findFirst.mockResolvedValue(null);
    db.facebookAutomation.findUnique.mockResolvedValue(rule);
    db.$transaction.mockImplementation(async (callback: (tx: typeof db.tx) => unknown) => callback(db.tx));
    db.tx.automation.update.mockImplementation(async ({ data }: { data: object }) => ({ ...existing, ...data }));
    db.tx.trackedLink.findFirst.mockResolvedValue({ destinationUrl: "https://exemplo.com/x" });
  });

  it("pauses the Facebook half together with the campaign", async () => {
    const result = await updateCampaign("ws1", "auto1", updateCampaignSchema.parse({ isActive: false }));
    expect(result.ok).toBe(true);
    expect(db.tx.facebookAutomation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { automationId: "auto1" },
        update: expect.objectContaining({ isActive: false, videoId: "VID1", linkUrl: "https://exemplo.com/x" }),
      })
    );
  });

  it("removes the Facebook half when asked to with null", async () => {
    await updateCampaign("ws1", "auto1", updateCampaignSchema.parse({ facebook: null }));
    expect(db.tx.facebookAutomation.deleteMany).toHaveBeenCalledWith({ where: { automationId: "auto1" } });
    expect(db.tx.facebookAutomation.upsert).not.toHaveBeenCalled();
  });

  it("leaves a campaign with no Facebook half alone", async () => {
    db.facebookAutomation.findUnique.mockResolvedValue(null);
    await updateCampaign("ws1", "auto1", updateCampaignSchema.parse({ name: "Novo nome" }));
    expect(db.tx.facebookAutomation.upsert).not.toHaveBeenCalled();
    expect(db.tx.facebookAutomation.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses a public reply too long for Facebook while it runs there", async () => {
    const result = await updateCampaign(
      "ws1",
      "auto1",
      updateCampaignSchema.parse({ publicReplyEnabled: true, publicReplyMessages: ["x".repeat(600)] })
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
