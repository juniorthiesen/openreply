import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { open } from "node:fs/promises";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import {
  ensureMediaStorageDirectory,
  getMediaPublicUrl,
  getMediaStoragePath,
  MAX_IMAGE_BYTES,
  MAX_REEL_BYTES,
} from "@/lib/media-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createUploadSchema = z.object({
  instagramAccountId: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(["image/jpeg", "video/mp4", "video/quicktime"]),
  byteSize: z.number().int().positive().max(MAX_REEL_BYTES),
});

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const instagramAccountId = request.nextUrl.searchParams.get("instagramAccountId");
  if (!instagramAccountId) {
    return NextResponse.json({ success: false, error: "Selecione uma conta do Instagram." }, { status: 400 });
  }

  const account = await getWorkspaceInstagramAccount(workspaceId, instagramAccountId);
  if (!account) {
    return NextResponse.json({ success: false, error: "Conta do Instagram não encontrada." }, { status: 404 });
  }

  const assets = await prisma.mediaAsset.findMany({
    where: { workspaceId, instagramAccountId, status: "READY" },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      fileName: true,
      contentType: true,
      byteSize: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    success: true,
    data: assets.map((asset) => ({ ...asset, publicUrl: getMediaPublicUrl(asset.id) })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = createUploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Dados do arquivo inválidos." }, { status: 400 });
  }

  const { instagramAccountId, contentType, byteSize } = parsed.data;
  const fileName = parsed.data.fileName.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, "").slice(0, 180);
  if (!fileName) {
    return NextResponse.json({ success: false, error: "Nome de arquivo inválido." }, { status: 400 });
  }

  const sizeLimit = contentType === "image/jpeg" ? MAX_IMAGE_BYTES : MAX_REEL_BYTES;
  if (byteSize > sizeLimit) {
    return NextResponse.json({
      success: false,
      error: contentType === "image/jpeg"
        ? "A imagem precisa ter até 8 MB."
        : "O vídeo precisa ter até 1 GB.",
    }, { status: 413 });
  }

  const account = await getWorkspaceInstagramAccount(workspaceId, instagramAccountId);
  if (!account) {
    return NextResponse.json({ success: false, error: "Conta do Instagram não encontrada." }, { status: 404 });
  }

  const id = `asset_${randomBytes(18).toString("hex")}`;
  const storageKey = `${id}.upload`;
  await ensureMediaStorageDirectory();
  const file = await open(getMediaStoragePath(storageKey), "wx");
  await file.close();

  try {
    const asset = await prisma.mediaAsset.create({
      data: {
        id,
        workspaceId,
        instagramAccountId,
        fileName,
        contentType,
        storageKey,
        byteSize,
      },
      select: { id: true, fileName: true, contentType: true, byteSize: true, uploadedBytes: true },
    });

    return NextResponse.json({ success: true, data: asset }, { status: 201 });
  } catch (error) {
    const { rm } = await import("node:fs/promises");
    await rm(getMediaStoragePath(storageKey), { force: true });
    throw error;
  }
}
