import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { resolveStoryPublishingPage } from "@/lib/instagram-stories/page-link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
    select: { id: true, username: true, instagramId: true, name: true, publishingPermissionGranted: true },
  });
  const instagramAccounts = await Promise.all(accounts.map(async (account) => ({
    ...account,
    storyPublishingReady: Boolean(await resolveStoryPublishingPage(workspaceId, account.id)),
  })));

  return NextResponse.json({
    success: true,
    data: { instagramAccounts, selectedInstagramAccountId: instagramAccounts[0]?.id ?? null },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
