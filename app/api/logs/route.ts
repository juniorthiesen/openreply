import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { DmStatus } from "@/app/generated/prisma/client";
import { createInstagramContext, getUserProfile } from "@/lib/instagram/provider";

// Profile lookups per request, so a page of old DM-triggered rows can't turn
// one page load into dozens of Graph calls. Resolved names are saved, so the
// backlog shrinks with each visit.
const MAX_NAME_LOOKUPS = 10;

/**
 * Rows from DM triggers saved before the worker resolved usernames have only
 * the sender's IGSID. Fill in the @ for the rows on this page and store it.
 */
async function resolveMissingNames(
  logs: { instagramAccountId: string; commenterId: string; commenterName: string | null }[]
) {
  const pending = new Map<string, { instagramAccountId: string; commenterId: string }>();
  for (const log of logs) {
    if (log.commenterName || pending.size >= MAX_NAME_LOOKUPS) continue;
    pending.set(`${log.instagramAccountId}:${log.commenterId}`, log);
  }
  if (pending.size === 0) return new Map<string, string>();

  const accountIds = [...new Set([...pending.values()].map((p) => p.instagramAccountId))];
  const accounts = await prisma.instagramAccount.findMany({ where: { id: { in: accountIds } } });
  const contexts = new Map<string, Awaited<ReturnType<typeof createInstagramContext>>>();
  for (const account of accounts) {
    try {
      contexts.set(account.id, await createInstagramContext(account));
    } catch {
      // Unreadable token: leave this account's rows as they are.
    }
  }

  const resolved = new Map<string, string>();
  await Promise.all(
    [...pending.entries()].map(async ([key, { instagramAccountId, commenterId }]) => {
      const context = contexts.get(instagramAccountId);
      if (!context) return;
      const username = (await getUserProfile({ context, recipientId: commenterId }))?.username;
      if (!username) return;
      resolved.set(key, username);
      await prisma.dmLog.updateMany({
        where: { instagramAccountId, commenterId, commenterName: null },
        data: { commenterName: username },
      });
    })
  );
  return resolved;
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(searchParams.get("limit") ?? "20", 10))
  );
  const status = searchParams.get("status");
  const instagramAccountId = searchParams.get("instagramAccountId");
  const skip = (page - 1) * limit;
  const parsedStatus =
    status && Object.values(DmStatus).includes(status as DmStatus)
      ? (status as DmStatus)
      : null;

  const where = {
    workspaceId,
    ...(parsedStatus ? { status: parsedStatus } : {}),
    ...(instagramAccountId && instagramAccountId !== "all"
      ? { instagramAccountId }
      : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.dmLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        automation: { select: { name: true, keywords: true } },
        instagramAccount: { select: { username: true } },
      },
    }),
    prisma.dmLog.count({ where }),
  ]);

  const resolvedNames = await resolveMissingNames(logs).catch(() => new Map<string, string>());
  const named = logs.map((log) =>
    log.commenterName
      ? log
      : {
          ...log,
          commenterName:
            resolvedNames.get(`${log.instagramAccountId}:${log.commenterId}`) ?? null,
        }
  );

  return NextResponse.json({
    success: true,
    data: {
      logs: named,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
}
