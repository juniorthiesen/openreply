import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  facebookPage: { findUnique: vi.fn() },
  facebookAutomation: { findMany: vi.fn() },
  facebookCommentLog: { create: vi.fn(), update: vi.fn() },
}));
const api = vi.hoisted(() => ({
  sendFacebookPrivateReply: vi.fn(),
  sendFacebookCommentReply: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: db }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (value: string) => `plain:${value}` }));
vi.mock("@/lib/facebook/page-api", () => api);

import { Prisma } from "@/app/generated/prisma/client";
import { MetaApiError } from "@/lib/meta/client";
import {
  commentIsOnVideo,
  facebookObjectId,
  parseFacebookCommentEvents,
  renderFacebookMessage,
} from "@/lib/facebook/comment-events";
import {
  handleFacebookCommentEvent,
  processFacebookWebhook,
} from "@/lib/facebook/comment-automation";

// The send functions are mocked above; the pure insight helpers must be real.
const { insightTotal, sumInsightEntry } = await vi.importActual<
  typeof import("@/lib/facebook/page-api")
>("@/lib/facebook/page-api");

function commentPayload(overrides: Record<string, unknown> = {}) {
  return {
    object: "page",
    entry: [
      {
        id: "PAGE",
        changes: [
          {
            field: "feed",
            value: {
              item: "comment",
              verb: "add",
              comment_id: "PAGE_C1",
              post_id: "PAGE_VIDEO1",
              parent_id: "PAGE_VIDEO1",
              message: "Eu quero!",
              from: { id: "USER", name: "Maria Silva" },
              ...overrides,
            },
          },
        ],
      },
    ],
  };
}

describe("parseFacebookCommentEvents", () => {
  it("reads a new top-level comment", () => {
    expect(parseFacebookCommentEvents(commentPayload())).toEqual([
      {
        pageId: "PAGE",
        commentId: "PAGE_C1",
        commentText: "Eu quero!",
        commenterId: "USER",
        commenterName: "Maria Silva",
        postId: "PAGE_VIDEO1",
        videoId: undefined,
      },
    ]);
  });

  it("ignores the Page's own comments, replies, edits and other objects", () => {
    expect(parseFacebookCommentEvents(commentPayload({ from: { id: "PAGE" } }))).toEqual([]);
    expect(parseFacebookCommentEvents(commentPayload({ parent_id: "PAGE_C0" }))).toEqual([]);
    expect(parseFacebookCommentEvents(commentPayload({ verb: "edited" }))).toEqual([]);
    expect(parseFacebookCommentEvents(commentPayload({ item: "reaction" }))).toEqual([]);
    expect(parseFacebookCommentEvents({ ...commentPayload(), object: "instagram" })).toEqual([]);
  });
});

describe("video matching and message rendering", () => {
  it("matches a video id against the post id with or without the Page prefix", () => {
    const ids = { postId: "PAGE_123", videoId: undefined };
    expect(facebookObjectId("PAGE_123")).toBe("123");
    expect(commentIsOnVideo({ videoId: "123", matchAnyPost: false }, ids)).toBe(true);
    expect(commentIsOnVideo({ videoId: "PAGE_123", matchAnyPost: false }, ids)).toBe(true);
    expect(commentIsOnVideo({ videoId: "999", matchAnyPost: false }, ids)).toBe(false);
    expect(commentIsOnVideo({ videoId: "999", matchAnyPost: false }, { postId: "PAGE_1", videoId: "999" })).toBe(true);
    expect(commentIsOnVideo({ videoId: null, matchAnyPost: true }, ids)).toBe(true);
    expect(commentIsOnVideo({ videoId: null, matchAnyPost: false }, ids)).toBe(false);
  });

  it("fills in the first name and drops {link}", () => {
    expect(renderFacebookMessage("Oi, {username}! Segue {link}", "Maria Silva")).toBe("Oi, Maria! Segue");
  });
});

describe("insight values", () => {
  it("sums daily points, totals and reactions by type", () => {
    expect(sumInsightEntry({ name: "m", values: [{ value: 3 }, { value: 4 }] })).toBe(7);
    expect(sumInsightEntry({ name: "m", total_value: { value: 9 } })).toBe(9);
    expect(sumInsightEntry({ name: "m", values: [{ value: { like: 5, love: 2 } }] })).toBe(7);
    expect(sumInsightEntry({ name: "m", values: [] })).toBeNull();
    expect(sumInsightEntry(undefined)).toBeNull();
    expect(insightTotal(undefined)).toBeNull();
  });
});

const baseRule = {
  id: "rule1",
  videoId: "VIDEO1",
  matchAnyPost: false,
  keywords: ["quero"],
  matchAnyWord: false,
  wholeWordMatch: true,
  dmMessage: "Oi, {username}!",
  linkUrl: null as string | null,
  linkButtonLabel: null as string | null,
  publicReplyEnabled: false,
  publicReplyMessages: [] as string[],
};
const event = {
  pageId: "PAGE",
  commentId: "PAGE_C1",
  commentText: "Eu quero!",
  commenterId: "USER",
  commenterName: "Maria Silva",
  postId: "PAGE_VIDEO1",
};

beforeEach(() => {
  vi.clearAllMocks();
  db.facebookPage.findUnique.mockResolvedValue({ id: "p1", facebookPageId: "PAGE", accessToken: "enc" });
  db.facebookAutomation.findMany.mockResolvedValue([baseRule]);
  db.facebookCommentLog.create.mockResolvedValue({ id: "log1" });
  api.sendFacebookPrivateReply.mockResolvedValue({});
  api.sendFacebookCommentReply.mockResolvedValue({ id: "r" });
});

describe("handleFacebookCommentEvent", () => {
  it("sends the private reply and records it", async () => {
    await handleFacebookCommentEvent(event);
    expect(api.sendFacebookPrivateReply).toHaveBeenCalledWith("plain:enc", "PAGE", "PAGE_C1", "Oi, Maria!");
    expect(api.sendFacebookCommentReply).not.toHaveBeenCalled();
    expect(db.facebookCommentLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "log1" }, data: expect.objectContaining({ status: "SENT", errorMessage: null }) })
    );
  });

  it("does nothing for a comment on another video or without the keyword", async () => {
    await handleFacebookCommentEvent({ ...event, postId: "PAGE_OTHER" });
    await handleFacebookCommentEvent({ ...event, commentText: "lindo" });
    expect(db.facebookCommentLog.create).not.toHaveBeenCalled();
    expect(api.sendFacebookPrivateReply).not.toHaveBeenCalled();
  });

  it("never sends twice when Meta redelivers the same comment", async () => {
    db.facebookCommentLog.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" })
    );
    await handleFacebookCommentEvent(event);
    expect(api.sendFacebookPrivateReply).not.toHaveBeenCalled();
    expect(db.facebookCommentLog.update).not.toHaveBeenCalled();
  });

  it("still posts the public reply when the private one fails, and logs the reason", async () => {
    db.facebookAutomation.findMany.mockResolvedValue([
      { ...baseRule, publicReplyEnabled: true, publicReplyMessages: ["Te enviei, {username}!"] },
    ]);
    api.sendFacebookPrivateReply.mockRejectedValue(new MetaApiError(10, undefined, "t", "No permission"));
    await handleFacebookCommentEvent(event);
    expect(api.sendFacebookCommentReply).toHaveBeenCalledWith("plain:enc", "PAGE_C1", "Te enviei, Maria!");
    const data = db.facebookCommentLog.update.mock.calls[0][0].data;
    expect(data.status).toBe("FAILED");
    expect(data.errorMessage).toContain("No permission");
    expect(data.publicReplySentAt).toBeInstanceOf(Date);
  });

  it("falls back to text with the link when Meta rejects the button template", async () => {
    db.facebookAutomation.findMany.mockResolvedValue([
      { ...baseRule, linkUrl: "https://exemplo.com/x", linkButtonLabel: "Ver" },
    ]);
    api.sendFacebookPrivateReply
      .mockRejectedValueOnce(new MetaApiError(100, undefined, "t", "Invalid button template"))
      .mockResolvedValueOnce({});
    await handleFacebookCommentEvent(event);
    expect(api.sendFacebookPrivateReply).toHaveBeenNthCalledWith(1, "plain:enc", "PAGE", "PAGE_C1", "Oi, Maria!", {
      title: "Ver",
      url: "https://exemplo.com/x",
    });
    expect(api.sendFacebookPrivateReply).toHaveBeenNthCalledWith(
      2, "plain:enc", "PAGE", "PAGE_C1", "Oi, Maria!\nhttps://exemplo.com/x"
    );
  });

  it("keeps handling the batch when one comment throws", async () => {
    db.facebookPage.findUnique.mockRejectedValueOnce(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const payload = commentPayload();
    const first = payload.entry[0].changes[0];
    payload.entry[0].changes.push({ ...first, value: { ...first.value, comment_id: "PAGE_C2" } });
    await processFacebookWebhook(payload);
    expect(api.sendFacebookPrivateReply).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
