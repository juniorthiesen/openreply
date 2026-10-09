import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getMediaStoragePath } from "@/lib/media-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function rangeNotSatisfiable(size: number) {
  return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, ...NO_STORE } });
}

/** Serve the saved copy of a Story to members of the workspace that owns it. */
async function serveStoredMedia(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return new Response(null, { status: 401, headers: NO_STORE });

  const { id } = await context.params;
  const story = await prisma.externalStory.findFirst({
    where: { id, workspaceId },
    select: { mediaStorageKey: true, mediaContentType: true },
  });
  if (!story?.mediaStorageKey || !story.mediaContentType) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }

  let filePath: string;
  let size: number;
  try {
    filePath = getMediaStoragePath(story.mediaStorageKey);
    const file = await stat(filePath);
    if (!file.isFile()) return new Response(null, { status: 404, headers: NO_STORE });
    size = file.size;
  } catch {
    return new Response(null, { status: 404, headers: NO_STORE });
  }

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (!match[1] && !match[2])) return rangeNotSatisfiable(size);
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return rangeNotSatisfiable(size);
      start = Math.max(size - suffixLength, 0);
    } else {
      start = Number(match[1]);
      if (match[2]) end = Number(match[2]);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
      return rangeNotSatisfiable(size);
    }
    end = Math.min(end, size - 1);
    status = 206;
  }

  const headers = new Headers({
    ...NO_STORE,
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
    "Content-Type": story.mediaContentType,
    "X-Content-Type-Options": "nosniff",
  });
  if (status === 206) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  if (request.method === "HEAD") return new Response(null, { status, headers });

  const stream = createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return serveStoredMedia(request, context);
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return serveStoredMedia(request, context);
}
