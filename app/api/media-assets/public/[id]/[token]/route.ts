import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  getMediaStoragePath,
  isValidMediaPublicToken,
} from "@/lib/media-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rangeNotSatisfiable(size: number) {
  return new Response(null, {
    status: 416,
    headers: { "Content-Range": `bytes */${size}`, "Cache-Control": "no-store" },
  });
}

async function serveMedia(
  request: NextRequest,
  context: { params: Promise<{ id: string; token: string }> }
) {
  const { id, token } = await context.params;
  if (!isValidMediaPublicToken(id, token)) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const asset = await prisma.mediaAsset.findFirst({
    where: { id, status: "READY" },
    select: { storageKey: true, contentType: true, byteSize: true },
  });
  if (!asset) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  let size: number;
  let filePath: string;
  try {
    filePath = getMediaStoragePath(asset.storageKey);
    const file = await stat(filePath);
    if (!file.isFile()) return new Response(null, { status: 404 });
    size = file.size;
  } catch {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
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
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600, s-maxage=86400, immutable",
    "Content-Length": String(end - start + 1),
    "Content-Type": asset.contentType,
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (status === 206) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  if (request.method === "HEAD") return new Response(null, { status, headers });

  const stream = createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; token: string }> }
) {
  return serveMedia(request, context);
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ id: string; token: string }> }
) {
  return serveMedia(request, context);
}
