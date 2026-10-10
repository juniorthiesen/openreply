import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    storySlide: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({
  MetaApiError: class MetaApiError extends Error {},
  TokenExpiredError: class TokenExpiredError extends Error {},
  RateLimitError: class RateLimitError extends Error {},
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveDMSlot: vi.fn(), releaseDMSlot: vi.fn() }));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: vi.fn(),
  releaseWorkspaceDMReservation: vi.fn(),
}));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: vi.fn() }),
  getRedisConnection: vi.fn(),
  POSTBACK_JOB_NAME: "process-postback",
  FOLLOWUP_JOB_NAME: "process-followup",
  MESSAGE_JOB_NAME: "process-message",
}));
vi.mock("bullmq", () => ({
  Worker: function MockWorker() {
    return { on: vi.fn(), close: vi.fn() };
  },
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

import { selectMessageCampaigns } from "../lib/queue/dm-worker";

const base = { storySequenceId: null, storyMediaId: null, matchAnyWord: false, wholeWordMatch: true };
const general = { ...base, id: "general", keywords: ["EU QUERO"] };
const pinned = { ...base, id: "pinned", keywords: ["EU QUERO"], storyMediaId: "story_1" };
const pinnedOther = { ...base, id: "pinned-other", keywords: ["EU QUERO"], storyMediaId: "story_2" };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.storySlide.findUnique.mockResolvedValue(null);
});

describe("selectMessageCampaigns with a campaign pinned to one Story", () => {
  it("answers a reply to that Story alone, ahead of a general campaign with the same word", async () => {
    const picked = await selectMessageCampaigns([general, pinned], "eu quero", "story_1");
    expect(picked.map((campaign) => campaign.id)).toEqual(["pinned"]);
  });

  it("stays quiet for a DM that is not a Story reply", async () => {
    const picked = await selectMessageCampaigns([pinned], "eu quero");
    expect(picked).toEqual([]);
  });

  it("stays quiet for a reply to another Story", async () => {
    const picked = await selectMessageCampaigns([pinned], "eu quero", "story_9");
    expect(picked).toEqual([]);
  });

  it("falls back to the general campaign when the reply does not match the pinned word", async () => {
    const picked = await selectMessageCampaigns([general, { ...pinned, keywords: ["SIM"] }], "eu quero", "story_1");
    expect(picked.map((campaign) => campaign.id)).toEqual(["general"]);
  });

  it("answers with the campaign of the Story that was replied to", async () => {
    const picked = await selectMessageCampaigns([pinned, pinnedOther], "eu quero", "story_2");
    expect(picked.map((campaign) => campaign.id)).toEqual(["pinned-other"]);
  });

  it("answers any word when the pinned campaign accepts any word", async () => {
    const picked = await selectMessageCampaigns([{ ...pinned, matchAnyWord: true, keywords: [] }], "oi", "story_1");
    expect(picked.map((campaign) => campaign.id)).toEqual(["pinned"]);
  });
});
