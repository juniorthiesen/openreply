import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import {
  getConversations,
  sendDirectMessage,
  MetaApiError,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { messagePreviewText } from "@/lib/inbox";

export interface ConversationListItem {
  id: string;
  contact: { id: string; username: string | null };
  updatedTime: string | null;
  unreadCount: number | null;
  lastIncomingTime: string | null;
  lastMessageFromMe: boolean | null;
  lastMessage: {
    text: string;
    fromMe: boolean;
    createdTime: string | null;
  } | null;
}

export interface ConversationsResponse {
  conversations: ConversationListItem[];
  account: { id: string; username: string; instagramId: string };
}

// List the account's DM conversations for the inbox.
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Instagram account not connected." },
      { status: 400 }
    );
  }

  try {
    const accessToken = decryptToken(account.accessToken);
    const raw = await getConversations(accessToken, account.instagramId);

    const conversations: ConversationListItem[] = raw.map((conversation) => {
      const participants = conversation.participants?.data ?? [];
      const contact =
        participants.find((participant) => participant.id !== account.instagramId) ??
        participants[0] ??
        null;
      const messages = conversation.messages?.data ?? [];
      const last = messages[0] ?? null;
      const lastIncoming =
        messages.find((message) => message.from?.id !== account.instagramId) ?? null;

      return {
        id: conversation.id,
        detailsUnavailable: conversation.detailsUnavailable,
        contact: {
          id: contact?.id ?? "",
          username: contact?.username ?? null,
        },
        updatedTime: conversation.updated_time ?? null,
        unreadCount:
          typeof conversation.unread_count === "number"
            ? conversation.unread_count
            : null,
        lastIncomingTime: lastIncoming?.created_time ?? null,
        lastMessageFromMe: last
          ? last.from?.id === account.instagramId
          : null,
        lastMessage: last
          ? {
              text: messagePreviewText({
                text: last.message,
                attachments: last.attachments?.data,
              }),
              fromMe: last.from?.id === account.instagramId,
              createdTime: last.created_time ?? null,
            }
          : null,
      };
    });

    const data: ConversationsResponse = {
      conversations,
      account: {
        id: account.id,
        username: account.username,
        instagramId: account.instagramId,
      },
    };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Conversations] Error:", err);
    const message =
      err instanceof MetaApiError
        ? err.message
        : "Failed to load conversations";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Send a direct message reply.
export async function POST(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: { instagramAccountId?: string; recipientId?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const text = body.text?.trim();
  if (!body.recipientId || !text) {
    return NextResponse.json(
      { success: false, error: "A recipient and message are required." },
      { status: 400 }
    );
  }

  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    body.instagramAccountId ?? null
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Instagram account not connected." },
      { status: 400 }
    );
  }

  try {
    const accessToken = decryptToken(account.accessToken);
    const result = await sendDirectMessage(
      accessToken,
      account.instagramId,
      body.recipientId,
      text
    );
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error("[Conversations] Send error:", err);
    const message =
      err instanceof MetaApiError ? err.message : "Failed to send message";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
