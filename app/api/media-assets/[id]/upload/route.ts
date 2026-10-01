import { NextRequest, NextResponse } from "next/server";
import { open, rm, stat } from "node:fs/promises";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  acquireMediaUploadLock,
  getMediaStoragePath,
  getMediaUploadLockPath,
  MAX_UPLOAD_CHUNK_BYTES,
} from "@/lib/media-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const asset = await prisma.mediaAsset.findFirst({
    where: { id, workspaceId, status: "UPLOADING" },
    select: { id: true, storageKey: true, byteSize: true, uploadedBytes: true },
  });
  if (!asset) {
    return NextResponse.json({ success: false, error: "Upload não encontrado ou já concluído." }, { status: 404 });
  }

  const offset = Number(request.headers.get("upload-offset"));
  if (!Number.isSafeInteger(offset) || offset < 0 || offset !== asset.uploadedBytes) {
    return NextResponse.json({ success: false, error: "A posição do arquivo mudou. Recarregue o upload." }, { status: 409 });
  }

  const lockPath = getMediaUploadLockPath(asset.storageKey);
  const lock = await acquireMediaUploadLock(asset.storageKey);
  if (!lock) {
    return NextResponse.json({ success: false, error: "Este arquivo já está sendo enviado." }, { status: 409 });
  }

  const filePath = getMediaStoragePath(asset.storageKey);
  let file: Awaited<ReturnType<typeof open>> | null = null;
  let written = 0;
  try {
    const refreshed = await prisma.mediaAsset.findFirst({
      where: { id, workspaceId, status: "UPLOADING" },
      select: { uploadedBytes: true, byteSize: true },
    });
    if (!refreshed || refreshed.uploadedBytes !== offset) {
      return NextResponse.json({ success: false, error: "A posição do arquivo mudou. Recarregue o upload." }, { status: 409 });
    }

    try {
      const currentFile = await stat(filePath);
      if (currentFile.size < offset) {
        return NextResponse.json({ success: false, error: "O arquivo temporário está incompleto." }, { status: 409 });
      }
      if (currentFile.size > offset) {
        const repairFile = await open(filePath, "r+");
        try {
          await repairFile.truncate(offset);
        } finally {
          await repairFile.close();
        }
      }
    } catch (error) {
      if (offset !== 0 || !(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }

    file = await open(filePath, offset === 0 ? "w+" : "r+");
    const reader = request.body?.getReader();
    if (!reader) {
      return NextResponse.json({ success: false, error: "O corpo do upload está vazio." }, { status: 400 });
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      written += value.byteLength;
      if (written > MAX_UPLOAD_CHUNK_BYTES || offset + written > asset.byteSize) {
        await reader.cancel();
        await file.truncate(offset);
        return NextResponse.json({ success: false, error: "O bloco enviado excedeu o limite permitido." }, { status: 413 });
      }
      let bufferOffset = 0;
      const position = offset + written - value.byteLength;
      while (bufferOffset < value.byteLength) {
        const result = await file.write(
          value,
          bufferOffset,
          value.byteLength - bufferOffset,
          position + bufferOffset
        );
        if (result.bytesWritten === 0) throw new Error("No bytes written");
        bufferOffset += result.bytesWritten;
      }
    }

    if (written === 0) {
      await file.truncate(offset);
      return NextResponse.json({ success: false, error: "O bloco enviado está vazio." }, { status: 400 });
    }

    const nextOffset = offset + written;
    await file.sync();
    const updated = await prisma.mediaAsset.updateMany({
      where: { id, workspaceId, status: "UPLOADING", uploadedBytes: offset },
      data: { uploadedBytes: nextOffset },
    });
    if (updated.count !== 1) {
      await file.truncate(offset);
      return NextResponse.json({ success: false, error: "O upload mudou enquanto o bloco era enviado." }, { status: 409 });
    }

    return NextResponse.json({ success: true, data: { uploadedBytes: nextOffset, byteSize: asset.byteSize } });
  } catch (error) {
    if (file) await file.truncate(offset).catch(() => {});
    console.error("[Media Upload] Chunk failed:", error);
    return NextResponse.json({ success: false, error: "Não foi possível salvar esse bloco. Tente novamente." }, { status: 500 });
  } finally {
    await file?.close().catch(() => {});
    await lock.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}
