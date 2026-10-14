import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { MetaApiError, subscribeFacebookPageToWebhooks } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

/**
 * Retry the Page's webhook subscription and keep Meta's reason when it fails.
 * Connecting only logs a failed subscription to the server console, which leaves
 * the Settings screen saying "pending" with nothing to act on.
 */
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const pageId = typeof body.pageId === "string" ? body.pageId : null;
  if (!pageId) {
    return NextResponse.json({ success: false, error: "Page is required" }, { status: 400 });
  }

  const page = await prisma.facebookPage.findFirst({
    where: { id: pageId, workspaceId: context.workspaceId },
  });
  if (!page) {
    return NextResponse.json({ success: false, error: "Page not found" }, { status: 404 });
  }

  try {
    const result = await subscribeFacebookPageToWebhooks(
      page.facebookPageId,
      decryptToken(page.accessToken)
    );
    const subscribed = Boolean(result.success);
    await prisma.facebookPage.update({
      where: { id: page.id },
      data: {
        webhookSubscribed: subscribed,
        webhookError: subscribed ? null : "A Meta não confirmou a inscrição.",
      },
    });
    return NextResponse.json({ success: true, data: { webhookSubscribed: subscribed } });
  } catch (error) {
    const message =
      error instanceof MetaApiError || error instanceof Error
        ? error.message
        : "Erro desconhecido";
    await prisma.facebookPage.update({
      where: { id: page.id },
      data: { webhookSubscribed: false, webhookError: message.slice(0, 500) },
    });
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
