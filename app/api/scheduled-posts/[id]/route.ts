import { NextResponse } from "next/server";
import { getCurrentWorkspaceContext, canManageWorkspace } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import { removeScheduledPostJob } from "@/lib/queue/scheduled-posts";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Só pessoas administradoras podem cancelar publicações." }, { status: 403 });
  }

  const { id } = await params;
  const updated = await prisma.scheduledPost.updateMany({
    where: {
      id,
      workspaceId: context.workspaceId,
      status: { in: ["DRAFT", "SCHEDULED", "FAILED"] },
    },
    data: { status: "CANCELED", lastError: null },
  });
  if (updated.count !== 1) {
    const exists = await prisma.scheduledPost.findFirst({
      where: { id, workspaceId: context.workspaceId },
      select: { status: true },
    });
    return NextResponse.json({
      success: false,
      error: exists ? "Essa publicação já está em processamento ou foi publicada." : "Publicação não encontrada.",
    }, { status: exists ? 409 : 404 });
  }

  try { await removeScheduledPostJob(id); }
  catch (error) { console.error("[Scheduled Posts] Queue cancellation deferred:", error); }
  return NextResponse.json({ success: true, data: { id, status: "CANCELED" } });
}
