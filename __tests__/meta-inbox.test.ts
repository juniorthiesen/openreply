import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConversationMessages,
  getConversations,
  markInstagramConversationSeen,
} from "@/lib/meta/client";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Instagram inbox Graph API requests", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("requests unread counts and non-text message attachments for the list", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: "thread-1", unread_count: 2 }] }));

    const conversations = await getConversations("token", "ig-account");
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(conversations[0].unread_count).toBe(2);
    expect(url.pathname).toContain("/ig-account/conversations");
    expect(url.searchParams.get("platform")).toBe("instagram");
    expect(url.searchParams.get("fields")).toContain("unread_count");
    expect(url.searchParams.get("fields")).toContain("attachments");
  });

  it("retries without unread_count when this app does not expose that field", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Unsupported field: unread_count", type: "IGApiException", code: 100 } }, 400))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "thread-1" }] }));

    await expect(getConversations("token", "ig-account")).resolves.toEqual([
      { id: "thread-1" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("fields")).not.toContain("unread_count");
  });

  it("requests complete recent-message fields, including attachments", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      messages: {
        data: [{ id: "message-1", message: "Oi", attachments: { data: [{ type: "image" }] } }],
      },
    }));

    const messages = await getConversationMessages("token", "thread-1");
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(messages[0].attachments?.data?.[0].type).toBe("image");
    expect(url.pathname).toContain("/thread-1");
    expect(url.searchParams.get("fields")).toContain("created_time");
    expect(url.searchParams.get("fields")).toContain("attachments");
  });

  it("marks the resolved recipient's thread as seen", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

    await markInstagramConversationSeen("token", "ig-account", "contact-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/ig-account/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { id: "contact-1" },
      sender_action: "mark_seen",
    });
  });
});
