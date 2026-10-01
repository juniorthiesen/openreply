import { NextResponse } from "next/server";
import { access, rename, rm, stat } from "node:fs/promises";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  acquireMediaUploadLock,
  getMediaStoragePath,
  getMediaUploadLockPath,
  getUploadedFileType,
} from "@/lib/media-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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
      storageKey: true,
      status: true,
    },
  });
  if (!asset) {
    return NextResponse.json({ success: false, error: "Arquivo não encontrado." }, { status: 404 });
  }
  if (asset.status === "READY") {
    return NextResponse.json({
      success: true,
      data: { id: asset.id, fileName: asset.fileName, contentType: asset.contentType, byteSize: asset.byteSize },
    });
  }
  if (asset.uploadedBytes !== asset.byteSize) {
    return NextResponse.json({ success: false, error: "O envio do arquivo ainda não terminou." }, { status: 409 });
  }

  const lockPath = getMediaUploadLockPath(asset.storageKey);
  const lock = await acquireMediaUploadLock(asset.storageKey);
  if (!lock) {
    return NextResponse.json({ success: false, error: "Este arquivo ainda está sendo enviado." }, { status: 409 });
  }

  try {
    const current = await prisma.mediaAsset.findFirst({
      where: { id, workspaceId },
      select: { id: true, fileName: true, contentType: true, byteSize: true, uploadedBytes: true, storageKey: true, status: true },
    });
    if (!current) {
      return NextResponse.json({ success: false, error: "Arquivo não encontrado." }, { status: 404 });
    }
    if (current.status === "READY") {
      return NextResponse.json({ success: true, data: { id, fileName: current.fileName, contentType: current.contentType, byteSize: current.byteSize } });
    }
    if (current.uploadedBytes !== current.byteSize) {
      return NextResponse.json({ success: false, error: "O envio do arquivo ainda não terminou." }, { status: 409 });
    }

    const temporaryPath = getMediaStoragePath(current.storageKey);
    let sourcePath = temporaryPath;
    try {
      await access(sourcePath);
    } catch {
      // Recover a completion that renamed the file just before a transient DB error.
      const candidates = ["jpg", "mp4", "mov"].map((extension) => getMediaStoragePath(`${id}.${extension}`));
      const existing = await Promise.all(candidates.map(async (path) => {
        try { await access(path); return path; } catch { return null; }
      }));
      sourcePath = existing.find((path): path is string => path !== null) ?? "";
      if (!sourcePath) {
        return NextResponse.json({ success: false, error: "O arquivo temporário não foi encontrado. Envie o arquivo novamente." }, { status: 409 });
      }
    }

    let mediaType: Awaited<ReturnType<typeof getUploadedFileType>>;
    try {
      mediaType = await getUploadedFileType(sourcePath);
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : "Formato de arquivo inválido.",
      }, { status: 415 });
    }
    const sourceStats = await stat(sourcePath);
    if (sourceStats.size !== current.byteSize) {
      return NextResponse.json({ success: false, error: "O tamanho do arquivo enviado não corresponde ao informado." }, { status: 409 });
    }

    const declaredIsImage = current.contentType.startsWith("image/");
    if (declaredIsImage !== mediaType.contentType.startsWith("image/")) {
      return NextResponse.json({ success: false, error: "O conteúdo do arquivo não corresponde ao formato selecionado." }, { status: 415 });
    }

    const finalStorageKey = `${id}.${mediaType.extension}`;
    const finalPath = getMediaStoragePath(finalStorageKey);
    if (sourcePath !== finalPath) {
      await rm(finalPath, { force: true });
      await rename(sourcePath, finalPath);
    }

    const updated = await prisma.mediaAsset.updateMany({
      where: { id, workspaceId, status: "UPLOADING", uploadedBytes: current.byteSize },
      data: { storageKey: finalStorageKey, contentType: mediaType.contentType, status: "READY" },
    });
    if (updated.count !== 1) {
      const ready = await prisma.mediaAsset.findFirst({
        where: { id, workspaceId, status: "READY" },
        select: { id: true, fileName: true, contentType: true, byteSize: true },
      });
      if (!ready) {
        return NextResponse.json({ success: false, error: "Não foi possível concluir o arquivo." }, { status: 409 });
      }
      return NextResponse.json({ success: true, data: ready });
    }

    return NextResponse.json({
      success: true,
      data: { id: current.id, fileName: current.fileName, contentType: mediaType.contentType, byteSize: current.byteSize },
    });
  } finally {
    await lock.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}
