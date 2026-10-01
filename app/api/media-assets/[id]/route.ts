import { NextResponse } from "next/server";
import { rm } from "node:fs/promises";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  acquireMediaUploadLock,
  getMediaPublicUrl,
  getMediaStoragePath,
  getMediaUploadLockPath,
} from "@/lib/media-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const asset = await prisma.mediaAsset.findFirst({
    where: { id, workspaceId },
    select: {
      id: true,
      fileName: true,
      contentType: true,
      byteSize: true,
      uploadedBytes: true,
      status: true,
      createdAt: true,
    },
  });
  if (!asset) {
    return NextResponse.json({ success: false, error: "Arquivo não encontrado." }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: {
      ...asset,
      publicUrl: asset.status === "READY" ? getMediaPublicUrl(asset.id) : null,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  try {
  const existing = await prisma.mediaAsset.findFirst({
    where: { id, workspaceId },
    select: { storageKey: true },
  });
  if (!existing) {
    return NextResponse.json({ success: false, error: "Arquivo não encontrado." }, { status: 404 });
  }

  const lockPath = getMediaUploadLockPath(existing.storageKey);
  const lock = await acquireMediaUploadLock(existing.storageKey);
  if (!lock) {
    return NextResponse.json({ success: false, error: "O arquivo ainda está sendo enviado." }, { status: 409 });
  }

  let result:
    | { kind: "missing" }
    | { kind: "in-use" }
    | { kind: "deleted"; asset: { id: string; storageKey: string } };
  try {
    result = await prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.findFirst({
        where: { id, workspaceId },
        select: { id: true, storageKey: true },
      });
      if (!asset) return { kind: "missing" as const };

      const [legacyReferences, carouselReferences] = await Promise.all([
        tx.scheduledPost.count({ where: { mediaAssetId: id } }),
        tx.scheduledPostMediaItem.count({ where: { mediaAssetId: id } }),
      ]);
      if (legacyReferences + carouselReferences > 0) return { kind: "in-use" as const };

      await tx.mediaAsset.delete({ where: { id } });
      return { kind: "deleted" as const, asset };
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
    console.error("[Media Assets] Failed to delete media asset:", { assetId: id, code, error });
    if (code === "P2003") {
      return NextResponse.json({ success: false, error: "Este arquivo está vinculado a uma publicação." }, { status: 409 });
    }
    if (code === "P2025") {
      return NextResponse.json({ success: false, error: "Arquivo não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: "Não foi possível remover o arquivo agora. Tente novamente." }, { status: 500 });
  } finally {
    await lock.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }

  if (result.kind === "missing") {
    return NextResponse.json({ success: false, error: "Arquivo não encontrado." }, { status: 404 });
  }
  if (result.kind === "in-use") {
    return NextResponse.json({ success: false, error: "Este arquivo está vinculado a uma publicação." }, { status: 409 });
  }

  try {
    await rm(getMediaStoragePath(result.asset.storageKey), { force: true });
  } catch (error) {
    // The database record is already gone. Report the user-requested deletion
    // as complete and leave enough context for an operator to clean the orphan.
    console.warn("[Media Assets] Deleted a database entry but couldn't remove its file:", {
      assetId: result.asset.id,
      error: error instanceof Error ? error.message : error,
    });
  }
  return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Media Assets] Unexpected media deletion failure:", {
      assetId: id,
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json({ success: false, error: "Não foi possível remover o arquivo agora. Tente novamente." }, { status: 500 });
  }
}
