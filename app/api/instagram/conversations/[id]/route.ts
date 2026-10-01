import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { prisma } from "@/lib/db/client";
import {
  getConversationMessages,
  markInstagramConversationSeen,
  MetaApiError,
  type InstagramMessageAttachment,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import type { InboxAttachment } from "@/lib/inbox";

export interface ThreadMessage {
  id: string;
  text: string;
  attachments: InboxAttachment[];
  fromMe: boolean;
  fromUsername: string | null;
  createdTime: string | null;
}

interface ConversationContext {
  contactId: string | null;
  oldestActivityAt: string | null;
  campaign: {
    id: string;
    name: string;
    keyword: string | null;
    lastDmAt: string | null;
    campaignLinkClicks: number;
  } | null;
  history: Array<{
    id: string;
    label: string;
    date: string;
    keyword: string | null;
  }>;
}

export interface ThreadResponse {
  messages: ThreadMessage[];
  context: ConversationContext;
}

type RouteProps = { params: Promise<{ id: string }> };

async function getAccountForRequest(
  request: NextRequest,
  workspaceId: string
) {
  return getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
}

function toInboxAttachment(attachment: InstagramMessageAttachment): InboxAttachment {
  return {
    type: attachment.type,
    name: attachment.name,
    url: attachment.url,
    file_url: attachment.file_url,
    payload: attachment.payload,
    image_data: attachment.image_data,
    video_data: attachment.video_data,
  };
}

// Message history for one conversation (Meta returns newest-first, up to 20).
export async function GET(request: NextRequest, { params }: RouteProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id: conversationId } = await params;
  const account = await getAccountForRequest(request, workspaceId);
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Instagram account not connected." },
      { status: 400 }
    );
  }

  try {
    const accessToken = decryptToken(account.accessToken);
    const raw = await getConversationMessages(accessToken, conversationId);
    const contactId =
      raw
        .flatMap((message) => [message.from?.id, ...(message.to?.data ?? []).map((to) => to.id)])
        .find((id) => id && id !== account.instagramId) ?? null;

    const messages: ThreadMessage[] = raw
      .map((message) => {
        const attachments = (message.attachments?.data ?? []).map(toInboxAttachment);
        return {
          id: message.id,
          text: message.message?.trim() ?? "",
          attachments,
          fromMe: message.from?.id === account.instagramId,
          fromUsername: message.from?.username ?? null,
          createdTime: message.created_time ?? null,
        };
      })
      .reverse();

    let context: ConversationContext = {
      contactId,
      oldestActivityAt: null,
      campaign: null,
      history: [],
    };

    if (contactId) {
      try {
        const logs = await prisma.dmLog.findMany({
          where: {
            workspaceId,
            instagramAccountId: account.id,
            commenterId: contactId,
          },
          orderBy: { createdAt: "desc" },
          take: 12,
          include: {
            automation: {
              select: {
                id: true,
                name: true,
                trackedLinks: { select: { id: true } },
              },
            },
          },
        });
        const latest = logs[0];
        const oldest = logs.at(-1);
        let campaign: ConversationContext["campaign"] = null;

        if (latest) {
          const campaignLinkClicks = await prisma.linkClick.count({
            where: {
              workspaceId,
              instagramAccountId: account.id,
              automationId: latest.automation.id,
            },
          });
          campaign = {
            id: latest.automation.id,
            name: latest.automation.name,
            keyword: latest.matchedKeyword,
            lastDmAt: latest.dmSentAt?.toISOString() ?? null,
            campaignLinkClicks,
          };
        }

        context = {
          contactId,
          oldestActivityAt: oldest?.createdAt.toISOString() ?? null,
          campaign,
          history: logs.map((log) => ({
            id: log.id,
            label: log.dmSentAt ? "Link/DM enviado pela campanha" : "Comentário registrado",
            date: (log.dmSentAt ?? log.createdAt).toISOString(),
            keyword: log.matchedKeyword,
          })),
        };
      } catch (error) {
        // A CRM context query should never make the actual Meta conversation disappear.
        console.error("[Conversation Context] Error:", error);
      }
    }

    const data: ThreadResponse = { messages, context };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Conversation Messages] Error:", err);
    const message =
      err instanceof MetaApiError ? err.message : "Failed to load messages";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Mark the selected Instagram thread as seen. Resolve the recipient from the
// Graph conversation itself instead of accepting an arbitrary user id.
export async function POST(request: NextRequest, { params }: RouteProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id: conversationId } = await params;
  const account = await getAccountForRequest(request, workspaceId);
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Instagram account not connected." },
      { status: 400 }
    );
  }

  try {
    const accessToken = decryptToken(account.accessToken);
    const messages = await getConversationMessages(accessToken, conversationId);
    const contactId = messages
      .flatMap((message) => [message.from?.id, ...(message.to?.data ?? []).map((to) => to.id)])
      .find((id) => id && id !== account.instagramId);

    if (!contactId) {
      return NextResponse.json(
        { success: false, error: "Não foi possível identificar o contato desta conversa." },
        { status: 400 }
      );
    }

    await markInstagramConversationSeen(accessToken, account.instagramId, contactId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Conversation Seen] Error:", err);
    const message =
      err instanceof MetaApiError ? err.message : "Failed to mark conversation as seen";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
