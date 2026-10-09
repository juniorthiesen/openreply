import { NextResponse, type NextRequest } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  externalStoriesToCsv,
  getExternalMediaRetentionDays,
  type ExternalStoryExportRow,
} from "@/lib/instagram-stories/external";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ROWS = 1000;

/**
 * Stories posted outside Fisga that the worker captured while they were live,
 * with their latest metrics. `?format=csv` downloads them as a spreadsheet and
 * `?accountId=` limits the result to one connected Instagram account.
 */
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const accountId = request.nextUrl.searchParams.get("accountId") || undefined;
  const stories = await prisma.externalStory.findMany({
    where: { workspaceId, ...(accountId ? { instagramAccountId: accountId } : {}) },
    orderBy: { postedAt: "desc" },
    take: MAX_ROWS,
    include: {
      instagramAccount: { select: { username: true } },
      metrics: { orderBy: { capturedAt: "desc" }, take: 1 },
    },
  });

  const rows: ExternalStoryExportRow[] = stories.map((story) => {
    const latest = story.metrics[0];
    return {
      instagramMediaId: story.instagramMediaId,
      username: story.instagramAccount.username,
      mediaType: story.mediaType,
      caption: story.caption,
      permalink: story.permalink,
      postedAt: story.postedAt,
      firstSeenAt: story.firstSeenAt,
      lastCapturedAt: latest?.capturedAt ?? null,
      reach: latest?.reach ?? null,
      views: latest?.views ?? null,
      replies: latest?.replies ?? null,
      shares: latest?.shares ?? null,
      follows: latest?.follows ?? null,
      profileVisits: latest?.profileVisits ?? null,
      totalInteractions: latest?.totalInteractions ?? null,
    };
  });

  if (request.nextUrl.searchParams.get("format") === "csv") {
    return new NextResponse(externalStoriesToCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="stories-externos.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  }

  const retentionDays = getExternalMediaRetentionDays();
  const items = rows.map((row, index) => {
    const story = stories[index];
    const hasMedia = Boolean(story.mediaStorageKey);
    return {
      ...row,
      id: story.id,
      hasMedia,
      mediaContentType: hasMedia ? story.mediaContentType : null,
      mediaUrl: hasMedia ? `/api/instagram/stories/external/${story.id}/media` : null,
      mediaExpiresAt:
        hasMedia && story.mediaStoredAt
          ? new Date(story.mediaStoredAt.getTime() + retentionDays * 24 * 60 * 60 * 1000)
          : null,
      mediaPurged: Boolean(story.mediaPurgedAt),
    };
  });

  return NextResponse.json(
    { success: true, data: { stories: items, total: items.length, retentionDays } },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
