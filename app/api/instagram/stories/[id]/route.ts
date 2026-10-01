import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext, canManageWorkspace } from "@/lib/workspace-access";
import { removeStorySequenceJob } from "@/lib/queue/story-sequences";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ success: false, error: "Só pessoas administradoras podem cancelar Stories." }, { status: 403 });
  const { id } = await params;
  const updated = await prisma.storySequence.updateMany({
    where: { id, workspaceId: context.workspaceId, status: { in: ["DRAFT", "SCHEDULED", "FAILED"] } },
    data: { status: "CANCELED", lastError: null },
  });
  if (updated.count !== 1) {
    const existing = await prisma.storySequence.findFirst({ where: { id, workspaceId: context.workspaceId }, select: { status: true } });
    return NextResponse.json({ success: false, error: existing ? "Esta sequência já está sendo publicada ou já foi publicada." : "Sequência não encontrada." }, { status: existing ? 409 : 404 });
  }
  try { await removeStorySequenceJob(id); }
  catch (error) { console.error("[Stories] Queue cancellation deferred:", error); }
  return NextResponse.json({ success: true, data: { id, status: "CANCELED" } });
}
