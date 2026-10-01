import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { queueScheduledPost } from "@/lib/queue/scheduled-posts";
import {
  TRIAL_REEL_GRADUATION_STRATEGIES,
  validateTrialReelAssets,
} from "@/lib/scheduling/trial-reels";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  mediaAssetIds: z.array(z.string().min(1)).min(1).max(10),
  caption: z.string().max(2_200).default(""),
  scheduledAt: z.string().datetime().optional(),
  shareToFeed: z.boolean().default(true),
  trialGraduationStrategy: z.enum(TRIAL_REEL_GRADUATION_STRATEGIES).nullable().default(null),
}).refine((post) => new Set(post.mediaAssetIds).size === post.mediaAssetIds.length, {
  message: "Um carrossel não pode repetir a mesma mídia.",
});

const bulkSchema = z.object({
  instagramAccountId: z.string().min(1),
  mode: z.enum(["DRAFT", "SCHEDULE"]),
  timeZone: z.string().min(1).max(100),
  posts: z.array(postSchema).min(1).max(60),
});

function postMediaType(assets: Array<{ contentType: string }>): "IMAGE" | "REEL" | "CAROUSEL" {
  if (assets.length > 1) return "CAROUSEL";
  return assets[0]?.contentType === "image/jpeg" ? "IMAGE" : "REEL";
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Só pessoas administradoras podem agendar publicações." }, { status: 403 });
  }

  const parsed = bulkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Confira a lista de publicações. É possível agendar até 60 por vez." }, { status: 400 });
  }
  const input = parsed.data;
  if (!isValidTimeZone(input.timeZone)) {
    return NextResponse.json({ success: false, error: "Fuso horário inválido." }, { status: 400 });
  }
  if (input.mode === "SCHEDULE") {
    if (input.posts.some((post) => !post.scheduledAt)) {
      return NextResponse.json({ success: false, error: "Defina data e horário para todas as publicações." }, { status: 400 });
    }
    if (input.posts.some((post) => !Number.isFinite(Date.parse(post.scheduledAt!)) || Date.parse(post.scheduledAt!) < Date.now() + 30_000)) {
      return NextResponse.json({ success: false, error: "Todas as publicações precisam estar pelo menos 30 segundos no futuro." }, { status: 400 });
    }
  }

  const account = await getWorkspaceInstagramAccount(context.workspaceId, input.instagramAccountId);
  if (!account) {
    return NextResponse.json({ success: false, error: "Conta do Instagram não encontrada." }, { status: 404 });
  }
  if (input.mode === "SCHEDULE" && !account.publishingPermissionGranted) {
    return NextResponse.json({ success: false, error: "Reconecte sua conta do Instagram para conceder a permissão de publicar conteúdo." }, { status: 409 });
  }

  const requestedAssetIds = [...new Set(input.posts.flatMap((post) => post.mediaAssetIds))];
  const foundAssets = await prisma.mediaAsset.findMany({
    where: {
      id: { in: requestedAssetIds },
      workspaceId: context.workspaceId,
      instagramAccountId: account.id,
      status: "READY",
    },
    select: { id: true, contentType: true },
  });
  const assetById = new Map(foundAssets.map((asset) => [asset.id, asset]));
  if (foundAssets.length !== requestedAssetIds.length) {
    return NextResponse.json({ success: false, error: "Uma ou mais mídias não estão prontas para publicação nesta conta." }, { status: 400 });
  }

  for (const post of input.posts) {
    const selectedAssets = post.mediaAssetIds.map((id) => assetById.get(id)!);
    const trialError = validateTrialReelAssets(selectedAssets, post.trialGraduationStrategy);
    if (trialError) {
      return NextResponse.json({ success: false, error: trialError }, { status: 400 });
    }
  }

  const status = input.mode === "SCHEDULE" ? "SCHEDULED" as const : "DRAFT" as const;
  const created = await prisma.$transaction(async (tx) => {
    const result: Array<{ id: string; scheduledAt: Date | null }> = [];
    for (const post of input.posts) {
      const assets = post.mediaAssetIds.map((id) => assetById.get(id)!);
      const mediaType = postMediaType(assets);
      const scheduledAt = input.mode === "SCHEDULE" ? new Date(post.scheduledAt!) : null;
      const saved = await tx.scheduledPost.create({
        data: {
          workspaceId: context.workspaceId,
          instagramAccountId: account.id,
          mediaAssetId: assets[0].id,
          mediaType,
          status,
          caption: post.caption,
          scheduledAt,
          timeZone: input.timeZone,
          shareToFeed: mediaType === "REEL"
            ? post.trialGraduationStrategy ? false : post.shareToFeed
            : true,
          trialGraduationStrategy: post.trialGraduationStrategy,
          mediaItems: {
            createMany: {
              data: assets.map((asset, position) => ({ mediaAssetId: asset.id, position })),
            },
          },
        },
        select: { id: true },
      });
      result.push({ id: saved.id, scheduledAt });
    }
    return result;
  }, { maxWait: 10_000, timeout: 30_000 });

  const queueResults = input.mode === "SCHEDULE"
    ? await Promise.allSettled(created.map((post) => queueScheduledPost(post.id, post.scheduledAt!)))
    : [];
  const queueFailures = queueResults.filter((result) => result.status === "rejected").length;
  if (queueFailures > 0) {
    console.error(`[Scheduled Posts] ${queueFailures} bulk job(s) will be repaired by worker reconciliation.`);
  }

  return NextResponse.json({
    success: true,
    data: { count: created.length, ids: created.map((post) => post.id), queueSyncPending: queueFailures > 0 },
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
