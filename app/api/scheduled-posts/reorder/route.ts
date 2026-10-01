import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceContext, canManageWorkspace } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import { queueScheduledPost } from "@/lib/queue/scheduled-posts";

export const dynamic = "force-dynamic";

const reorderSchema = z.object({
  instagramAccountId: z.string().min(1),
  ids: z.array(z.string().min(1)).min(2).max(60),
});

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Só pessoas administradoras podem reorganizar o feed." }, { status: 403 });
  }

  const parsed = reorderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || new Set(parsed.data?.ids ?? []).size !== parsed.data?.ids.length) {
    return NextResponse.json({ success: false, error: "Selecione publicações diferentes para reorganizar." }, { status: 400 });
  }
  const { ids, instagramAccountId } = parsed.data;
  const posts = await prisma.scheduledPost.findMany({
    where: { id: { in: ids }, workspaceId: context.workspaceId, instagramAccountId },
    select: { id: true, scheduledAt: true, status: true },
  });
  if (posts.length !== ids.length || posts.some((post) => post.status !== "SCHEDULED" || !post.scheduledAt)) {
    return NextResponse.json({ success: false, error: "Só é possível reorganizar publicações agendadas da mesma conta." }, { status: 409 });
  }

  const scheduleSlots = posts
    .map((post) => post.scheduledAt!)
    .sort((a, b) => a.getTime() - b.getTime());
  if (scheduleSlots.some((date) => date.getTime() < Date.now() + 60_000)) {
    return NextResponse.json({ success: false, error: "Não é possível mudar a ordem de uma publicação prestes a ser enviada." }, { status: 409 });
  }
  const originalById = new Map(posts.map((post) => [post.id, post.scheduledAt!]));
  const nextSchedule = ids.map((id, index) => ({ id, from: originalById.get(id)!, to: scheduleSlots[index] }));

  try {
    await prisma.$transaction(async (tx) => {
      for (const item of nextSchedule) {
        if (item.from.getTime() === item.to.getTime()) continue;
        const updated = await tx.scheduledPost.updateMany({
          where: {
            id: item.id,
            workspaceId: context.workspaceId,
            instagramAccountId,
            status: "SCHEDULED",
            scheduledAt: item.from,
          },
          data: { scheduledAt: item.to },
        });
        if (updated.count !== 1) throw new Error("A ordem mudou enquanto era salva.");
      }
    });
  } catch {
    return NextResponse.json({ success: false, error: "A fila mudou durante a reorganização. Atualize a página e tente de novo." }, { status: 409 });
  }

  const queueResults = await Promise.allSettled(
    nextSchedule.map((item) => queueScheduledPost(item.id, item.to, true))
  );
  const failedQueueWrites = queueResults.filter((result) => result.status === "rejected").length;
  if (failedQueueWrites) {
    console.error(`[Scheduled Posts] ${failedQueueWrites} reordered job(s) will be repaired by worker reconciliation.`);
  }

  return NextResponse.json({
    success: true,
    data: nextSchedule.map(({ id, to }) => ({ id, scheduledAt: to })),
    queueSyncPending: failedQueueWrites > 0,
  }, { headers: { "Cache-Control": "no-store" } });
}
