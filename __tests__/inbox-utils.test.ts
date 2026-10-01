import { describe, expect, it } from "vitest";
import {
  attachmentLabel,
  isConversationUnread,
  isReplyWindowOpen,
  messagePreviewText,
  replyWindowHoursRemaining,
  safeAttachmentUrl,
} from "@/lib/inbox";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");

describe("Instagram inbox state helpers", () => {
  it("keeps the reply window open for 24 hours and closes it at the boundary", () => {
    expect(isReplyWindowOpen("2026-09-29T12:00:01.000Z", NOW)).toBe(true);
    expect(isReplyWindowOpen("2026-09-29T12:00:00.000Z", NOW)).toBe(false);
    expect(isReplyWindowOpen("not-a-date", NOW)).toBe(false);
  });

  it("rounds remaining reply time up to the next full hour", () => {
    expect(replyWindowHoursRemaining("2026-09-30T11:30:00.000Z", NOW)).toBe(24);
    expect(replyWindowHoursRemaining("2026-09-29T10:00:00.000Z", NOW)).toBe(0);
  });

  it("uses Meta unread counts and suppresses conversations read locally", () => {
    const conversation = {
      unreadCount: 3,
      lastIncomingTime: "2026-09-30T11:00:00.000Z",
      lastMessageFromMe: false,
    };
    expect(isConversationUnread(conversation, null, null)).toBe(true);
    expect(isConversationUnread(conversation, "2026-09-30T11:05:00.000Z", null)).toBe(false);
    expect(
      isConversationUnread(
        { ...conversation, unreadCount: 0 },
        "2026-09-30T10:00:00.000Z",
        null
      )
    ).toBe(false);
  });

  it("derives unread state from the latest inbound message when Meta omits the count", () => {
    const base = {
      unreadCount: null,
      lastIncomingTime: "2026-09-30T11:00:00.000Z",
      lastMessageFromMe: false,
    };
    expect(isConversationUnread(base, null, "2026-09-30T10:00:00.000Z")).toBe(true);
    expect(isConversationUnread(base, null, "2026-09-30T11:10:00.000Z")).toBe(false);
    expect(
      isConversationUnread(
        { ...base, lastMessageFromMe: true },
        null,
        "2026-09-30T10:00:00.000Z"
      )
    ).toBe(false);
  });
});

describe("Instagram message content helpers", () => {
  it.each([
    [{ type: "image" }, "Imagem recebida"],
    [{ type: "video" }, "Vídeo compartilhado"],
    [{ type: "audio" }, "Áudio recebido"],
    [{ type: "ig_post" }, "Publicação compartilhada"],
    [{ payload: { sticker_id: "sticker" } }, "Figurinha recebida"],
  ])("labels non-text attachments", (attachment, label) => {
    expect(attachmentLabel(attachment)).toBe(label);
    expect(messagePreviewText({ attachments: [attachment] })).toBe(label);
  });

  it("prefers message text and validates attachment URLs", () => {
    expect(messagePreviewText({ text: "  Olá  ", attachments: [{ type: "image" }] })).toBe("Olá");
    expect(messagePreviewText({})).toBe("Interação sem texto disponível");
    expect(safeAttachmentUrl({ payload: { url: "https://cdn.example.test/file.jpg" } })).toBe(
      "https://cdn.example.test/file.jpg"
    );
    expect(safeAttachmentUrl({ url: "javascript:alert(1)" })).toBeNull();
  });
});
