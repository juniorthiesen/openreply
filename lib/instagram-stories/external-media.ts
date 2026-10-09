import { createWriteStream } from "node:fs";
import { readdir, rename, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { prisma } from "@/lib/db/client";
import {
  ensureMediaStorageDirectory,
  getMediaStorageDirectory,
  getMediaStoragePath,
  getUploadedFileType,
} from "@/lib/media-assets";
import {
  externalMediaStorageKey,
  getExternalMediaRetentionDays,
  isAllowedStoryMediaUrl,
} from "@/lib/instagram-stories/external";

const MAX_STORY_MEDIA_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 90_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_BATCH = 200;

export interface StoredStoryMedia {
  storageKey: string;
  contentType: string;
  byteSize: number;
}

function byteLimit(maxBytes: number) {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) callback(new Error("Story media is larger than the allowed limit"));
      else callback(null, chunk);
    },
  });
}

/** Download a Story's media from Meta's CDN into persistent storage. Returns null when it cannot be kept. */
export async function downloadStoryMedia(storyId: string, mediaUrl: string): Promise<StoredStoryMedia | null> {
  if (!isAllowedStoryMediaUrl(mediaUrl)) return null;

  const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok || !response.body || !isAllowedStoryMediaUrl(response.url || mediaUrl)) return null;
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_STORY_MEDIA_BYTES) return null;

  await ensureMediaStorageDirectory();
  const tempPath = getMediaStoragePath(`ext_${storyId}.upload`);
  try {
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      byteLimit(MAX_STORY_MEDIA_BYTES),
      createWriteStream(tempPath)
    );
    const type = await getUploadedFileType(tempPath);
    const storageKey = externalMediaStorageKey(storyId, type.extension);
    await rename(tempPath, getMediaStoragePath(storageKey));
    const { size } = await stat(getMediaStoragePath(storageKey));
    return { storageKey, contentType: type.contentType, byteSize: size };
  } catch (error) {
    await rm(tempPath, { force: true });
    const message = error instanceof Error ? error.message : "falha desconhecida";
    console.warn(`[External Stories] Mídia de ${storyId} não foi guardada: ${message.slice(0, 200)}`);
    return null;
  }
}

/**
 * Delete stored copies older than the retention window, keep the row and its
 * metrics, then remove any leftover `ext_` file nothing refers to anymore.
 */
export async function purgeExpiredExternalStoryMedia(now: Date = new Date()): Promise<void> {
  const retentionDays = getExternalMediaRetentionDays();
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);

  const due = await prisma.externalStory.findMany({
    where: { mediaStorageKey: { not: null }, mediaStoredAt: { lte: cutoff } },
    select: { id: true, mediaStorageKey: true },
    take: PURGE_BATCH,
  });
  for (const story of due) {
    if (story.mediaStorageKey) {
      await rm(getMediaStoragePath(story.mediaStorageKey), { force: true });
    }
    await prisma.externalStory.update({
      where: { id: story.id },
      data: {
        mediaStorageKey: null,
        mediaContentType: null,
        mediaByteSize: null,
        mediaUrl: null,
        mediaPurgedAt: now,
      },
    });
  }

  let names: string[] = [];
  try {
    names = await readdir(getMediaStorageDirectory());
  } catch {
    return;
  }
  const orphanCutoff = now.getTime() - (retentionDays + 1) * DAY_MS;
  for (const name of names) {
    if (!name.startsWith("ext_")) continue;
    try {
      const path = `${getMediaStorageDirectory()}/${name}`;
      const file = await stat(path);
      if (file.isFile() && file.mtimeMs < orphanCutoff) await rm(path, { force: true });
    } catch {
      // The file vanished between readdir and stat; nothing to clean up.
    }
  }
}
