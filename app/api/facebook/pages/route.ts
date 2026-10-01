import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const pages = await prisma.facebookPage.findMany({
    where: { workspaceId },
    select: {
      id: true,
      facebookPageId: true,
      name: true,
      username: true,
      webhookSubscribed: true,
      connectedAt: true,
    },
    orderBy: { connectedAt: "desc" },
  });
  return NextResponse.json({ success: true, data: { pages } });
}

export async function DELETE(request: NextRequest) {
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
    select: { id: true, facebookPageId: true },
  });
  if (!page) {
    return NextResponse.json({ success: false, error: "Page not found" }, { status: 404 });
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const result = await tx.facebookPage.deleteMany({
      where: { id: page.id, workspaceId: context.workspaceId },
    });
    if (result.count === 1) {
      await tx.instagramAccount.updateMany({
        where: {
          workspaceId: context.workspaceId,
          facebookPageId: page.facebookPageId,
        },
        data: { facebookPageId: null },
      });
    }
    return result;
  });

  if (deleted.count !== 1) {
    return NextResponse.json({ success: false, error: "Page not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
