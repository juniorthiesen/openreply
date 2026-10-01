import { NextResponse } from "next/server";
import { getCurrentWorkspaceContext, canManageWorkspace } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import { queueScheduledPost } from "@/lib/queue/scheduled-posts";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Só pessoas administradoras podem tentar novamente." }, { status: 403 });
  }

  const { id } = await params;
  const post = await prisma.scheduledPost.findFirst({
    where: { id, workspaceId: context.workspaceId, status: "FAILED" },
    select: { id: true, instagramAccount: { select: { publishingPermissionGranted: true } } },
  });
  if (!post) {
    return NextResponse.json({ success: false, error: "Publicação com falha não encontrada." }, { status: 404 });
  }
  if (!post.instagramAccount.publishingPermissionGranted) {
    return NextResponse.json({ success: false, error: "Reconecte sua conta do Instagram para conceder a permissão de publicar conteúdo." }, { status: 409 });
  }

  const scheduledAt = new Date(Date.now() + 5_000);
  const updated = await prisma.scheduledPost.updateMany({
    where: { id, workspaceId: context.workspaceId, status: "FAILED" },
    data: {
      status: "SCHEDULED",
      scheduledAt,
      containerId: null,
      instagramMediaId: null,
      permalink: null,
      publishedAt: null,
      publishStartedAt: null,
      attempts: 0,
      lastError: null,
    },
  });
  if (updated.count !== 1) {
    return NextResponse.json({ success: false, error: "A publicação mudou antes de iniciar a nova tentativa." }, { status: 409 });
  }

  let queue = { queued: false, deferred: false, active: false };
  try { queue = await queueScheduledPost(id, scheduledAt, true); }
  catch (error) { console.error("[Scheduled Posts] Retry queue insert deferred to reconciliation:", error); }
  return NextResponse.json({ success: true, data: { id, scheduledAt }, queue }, { headers: { "Cache-Control": "no-store" } });
}
