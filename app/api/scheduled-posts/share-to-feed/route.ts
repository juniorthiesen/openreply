import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

const schema = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) });

/**
 * Put queued Reels back on the profile grid (shareToFeed). Only Reels that
 * haven't started publishing and aren't trial Reels — a trial Reel is kept out
 * of the feed by Meta's rules, not by this flag.
 */
export async function POST(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Só pessoas administradoras podem editar publicações." }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Selecione as publicações." }, { status: 400 });

  const updated = await prisma.scheduledPost.updateMany({
    where: {
      id: { in: parsed.data.ids },
      workspaceId: context.workspaceId,
      status: { in: ["DRAFT", "SCHEDULED"] },
      mediaType: "REEL",
      trialGraduationStrategy: null,
    },
    data: { shareToFeed: true },
  });
  return NextResponse.json({ success: true, data: { updated: updated.count } });
}
