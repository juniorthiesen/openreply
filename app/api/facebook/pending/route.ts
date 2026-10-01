import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  getFacebookManagedPages,
  subscribeFacebookPageToWebhooks,
} from "@/lib/meta/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

type PageCandidate = {
  id: string;
  name: string;
  username?: string;
  instagramBusinessAccount?: { id: string; username?: string };
};

async function getConnection(connectionId: string, workspaceId: string) {
  return prisma.facebookOAuthConnection.findFirst({
    where: { id: connectionId, workspaceId, expiresAt: { gt: new Date() } },
  });
}

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const connectionId = request.nextUrl.searchParams.get("connection");
  if (!connectionId) {
    return NextResponse.json({ success: false, error: "Connection is required" }, { status: 400 });
  }
  const connection = await getConnection(connectionId, context.workspaceId);
  if (!connection) {
    return NextResponse.json({ success: false, error: "Connection expired" }, { status: 410 });
  }

  return NextResponse.json({
    success: true,
    data: { pages: connection.pages as unknown as PageCandidate[] },
  });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const connectionId = typeof body.connection === "string" ? body.connection : null;
  const pageId = typeof body.pageId === "string" ? body.pageId : null;
  if (!connectionId || !pageId) {
    return NextResponse.json({ success: false, error: "Connection and Page are required" }, { status: 400 });
  }

  const connection = await getConnection(connectionId, context.workspaceId);
  if (!connection) {
    return NextResponse.json({ success: false, error: "Connection expired. Start again." }, { status: 410 });
  }

  try {
    // Query Meta again rather than trust the browser-provided Page id/name or
    // retain a Page token in the temporary record.
    const pages = await getFacebookManagedPages(decryptToken(connection.accessToken));
    const page = pages.find((candidate) => candidate.id === pageId);
    if (!page) {
      return NextResponse.json({ success: false, error: "Page is no longer available" }, { status: 404 });
    }

    let webhookSubscribed = false;
    try {
      const subscription = await subscribeFacebookPageToWebhooks(page.id, page.access_token);
      webhookSubscribed = Boolean(subscription.success);
    } catch (error) {
      console.warn("[Facebook Connect] Page webhook subscription failed:", error);
    }

    await prisma.facebookPage.upsert({
      where: { facebookPageId: page.id },
      create: {
        workspaceId: context.workspaceId,
        facebookPageId: page.id,
        name: page.name,
        username: page.username,
        accessToken: encryptToken(page.access_token),
        webhookSubscribed,
      },
      update: {
        workspaceId: context.workspaceId,
        name: page.name,
        username: page.username,
        accessToken: encryptToken(page.access_token),
        webhookSubscribed,
      },
    });
    if (page.instagram_business_account?.id) {
      await prisma.instagramAccount.updateMany({
        where: {
          workspaceId: context.workspaceId,
          instagramId: page.instagram_business_account.id,
        },
        data: { facebookPageId: page.id },
      });
    }
    await prisma.facebookOAuthConnection.delete({ where: { id: connection.id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Facebook Connect] Page selection failed:", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
