import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, open, rm, stat, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { getBaseUrl, requireEnv } from "@/lib/env";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_REEL_BYTES = 1024 * 1024 * 1024;
export const MAX_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

const STORAGE_KEY_PATTERN = /^[a-zA-Z0-9_-]+\.(?:upload|jpg|mp4|mov)$/;

export function getMediaStorageDirectory(): string {
  return process.env.MEDIA_STORAGE_DIR || join(/*turbopackIgnore: true*/ tmpdir(), "openreply-media");
}

export async function ensureMediaStorageDirectory(): Promise<void> {
  await mkdir(getMediaStorageDirectory(), { recursive: true });
}

export function getMediaStoragePath(storageKey: string): string {
  if (!STORAGE_KEY_PATTERN.test(storageKey) || extname(storageKey) === "") {
    throw new Error("Invalid media storage key");
  }
  return `${getMediaStorageDirectory()}/${storageKey}`;
}

export function getMediaUploadLockPath(storageKey: string): string {
  return `${getMediaStoragePath(storageKey)}.lock`;
}

export async function acquireMediaUploadLock(storageKey: string): Promise<FileHandle | null> {
  const lockPath = getMediaUploadLockPath(storageKey);
  try {
    return await open(lockPath, "wx");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    try {
      const lockStats = await stat(lockPath);
      if (Date.now() - lockStats.mtimeMs > 10 * 60 * 1000) {
        await rm(lockPath, { force: true });
        return await open(lockPath, "wx");
      }
    } catch {
      return await open(lockPath, "wx");
    }
    return null;
  }
}

export function getMediaPublicToken(assetId: string): string {
  return createHmac("sha256", requireEnv("NEXTAUTH_SECRET"))
    .update(`openreply-media:${assetId}`)
    .digest("base64url");
}

export function isValidMediaPublicToken(
  assetId: string,
  token: string
): boolean {
  let provided: Buffer;
  let expected: Buffer;
  try {
    provided = Buffer.from(token, "base64url");
    expected = Buffer.from(getMediaPublicToken(assetId), "base64url");
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function getMediaPublicUrl(assetId: string): string {
  const path = `/api/media-assets/public/${encodeURIComponent(assetId)}/${getMediaPublicToken(assetId)}`;
  return new URL(path, getBaseUrl()).toString();
}

export async function getUploadedFileType(
  filePath: string
): Promise<{ contentType: "image/jpeg" | "video/mp4" | "video/quicktime"; extension: "jpg" | "mp4" | "mov" }> {
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      return { contentType: "image/jpeg", extension: "jpg" };
    }

    if (bytesRead >= 12 && header.toString("ascii", 4, 8) === "ftyp") {
      const brand = header.toString("ascii", 8, 12);
      return brand === "qt  "
        ? { contentType: "video/quicktime", extension: "mov" }
        : { contentType: "video/mp4", extension: "mp4" };
    }

    throw new Error("Envie uma imagem JPEG ou um vídeo MP4/MOV válido.");
  } finally {
    await handle.close();
  }
}

export async function isCompleteMediaFile(
  storageKey: string,
  expectedBytes: number
): Promise<boolean> {
  try {
    const file = await stat(getMediaStoragePath(storageKey));
    return file.isFile() && file.size === expectedBytes;
  } catch {
    return false;
  }
}
