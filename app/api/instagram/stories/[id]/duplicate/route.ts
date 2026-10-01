import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext, canManageWorkspace } from "@/lib/workspace-access";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ success: false, error: "Só pessoas administradoras podem duplicar Stories." }, { status: 403 });
  const { id } = await params;
  const source = await prisma.storySequence.findFirst({
    where: { id, workspaceId: context.workspaceId, status: "PUBLISHED" },
    include: { slides: { orderBy: { position: "asc" }, select: { mediaAssetId: true, mediaAsset: { select: { status: true } } } } },
  });
  if (!source) return NextResponse.json({ success: false, error: "Só é possível duplicar uma sequência publicada." }, { status: 404 });
  const slides = source.slides.filter((slide) => slide.mediaAsset.status === "READY");
  if (slides.length === 0) return NextResponse.json({ success: false, error: "Os arquivos originais já não estão disponíveis." }, { status: 409 });
  const duplicate = await prisma.storySequence.create({
    data: {
      workspaceId: source.workspaceId,
      instagramAccountId: source.instagramAccountId,
      title: `${source.title} (cópia)` .slice(0, 120),
      timeZone: source.timeZone,
      slides: { create: slides.map((slide, position) => ({ mediaAssetId: slide.mediaAssetId, position })) },
    },
    select: { id: true, title: true, status: true },
  });
  return NextResponse.json({ success: true, data: duplicate }, { status: 201 });
}
