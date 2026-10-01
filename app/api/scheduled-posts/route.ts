import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { canManageWorkspace } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { getMediaPublicUrl } from "@/lib/media-assets";
import { queueScheduledPost, removeScheduledPostJob } from "@/lib/queue/scheduled-posts";
import {
  TRIAL_REEL_GRADUATION_STRATEGIES,
  validateTrialReelAssets,
} from "@/lib/scheduling/trial-reels";

export const dynamic = "force-dynamic";

const mediaSelection = {
  mediaAssetId: z.string().min(1).optional(),
  mediaAssetIds: z.array(z.string().min(1)).min(1).max(10).optional(),
};

const createPostSchema = z.object({
  instagramAccountId: z.string().min(1),
  ...mediaSelection,
  caption: z.string().max(2_200),
  mode: z.enum(["DRAFT", "SCHEDULE", "NOW"]),
  scheduledAt: z.string().datetime().optional(),
  timeZone: z.string().min(1).max(100),
  automationId: z.string().nullable().optional(),
  shareToFeed: z.boolean().default(true),
  trialGraduationStrategy: z.enum(TRIAL_REEL_GRADUATION_STRATEGIES).nullable().default(null),
}).refine((input) => {
  const ids = input.mediaAssetIds ?? (input.mediaAssetId ? [input.mediaAssetId] : []);
  return ids.length > 0 && new Set(ids).size === ids.length;
}, { message: "Selecione mídias diferentes para a publicação." });

const updatePostSchema = z.object({
  ...mediaSelection,
  caption: z.string().max(2_200),
  mode: z.enum(["DRAFT", "SCHEDULE"]),
  scheduledAt: z.string().datetime().optional(),
  timeZone: z.string().min(1).max(100),
  shareToFeed: z.boolean(),
  trialGraduationStrategy: z.enum(TRIAL_REEL_GRADUATION_STRATEGIES).nullable().default(null),
}).refine((input) => {
  const ids = input.mediaAssetIds ?? (input.mediaAssetId ? [input.mediaAssetId] : []);
  return ids.length > 0 && new Set(ids).size === ids.length;
}, { message: "Selecione mídias diferentes para a publicação." });

function inputAssetIds(input: { mediaAssetId?: string; mediaAssetIds?: string[] }): string[] {
  return input.mediaAssetIds ?? (input.mediaAssetId ? [input.mediaAssetId] : []);
}

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

function publicPost<T extends {
  mediaAsset: { id: string; status: string };
  mediaItems?: Array<{ position: number; mediaAsset: { id: string; status: string } }>;
}>(post: T) {
  return {
    ...post,
    mediaUrl: post.mediaAsset.status === "READY" ? getMediaPublicUrl(post.mediaAsset.id) : null,
    mediaItems: post.mediaItems?.map((item) => ({
      position: item.position,
      mediaAsset: item.mediaAsset,
      mediaUrl: item.mediaAsset.status === "READY" ? getMediaPublicUrl(item.mediaAsset.id) : null,
    })) ?? [],
  };
}

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const instagramAccountId = request.nextUrl.searchParams.get("instagramAccountId");
  const where = {
    workspaceId: context.workspaceId,
    ...(instagramAccountId ? { instagramAccountId } : {}),
  };
  const posts = await prisma.scheduledPost.findMany({
    where,
    include: {
      mediaAsset: {
        select: {
          id: true,
          fileName: true,
          contentType: true,
          byteSize: true,
          status: true,
        },
      },
      mediaItems: {
        orderBy: { position: "asc" },
        include: {
          mediaAsset: { select: { id: true, fileName: true, contentType: true, byteSize: true, status: true } },
        },
      },
      instagramAccount: { select: { id: true, username: true } },
      automation: { select: { id: true, name: true, isActive: true } },
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    take: 500,
  });

  return NextResponse.json(
    { success: true, data: posts.map(publicPost) },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Só pessoas administradoras podem agendar publicações." }, { status: 403 });
  }

  const parsed = createPostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Confira os dados da publicação." }, { status: 400 });
  }
  const input = parsed.data;
  if (!isValidTimeZone(input.timeZone)) {
    return NextResponse.json({ success: false, error: "Fuso horário inválido." }, { status: 400 });
  }

  const account = await getWorkspaceInstagramAccount(context.workspaceId, input.instagramAccountId);
  if (!account) {
    return NextResponse.json({ success: false, error: "Conta do Instagram não encontrada." }, { status: 404 });
  }

  const requestedAssetIds = inputAssetIds(input);
  const foundAssets = await prisma.mediaAsset.findMany({
    where: {
      id: { in: requestedAssetIds },
      workspaceId: context.workspaceId,
      instagramAccountId: account.id,
      status: "READY",
    },
    select: { id: true, contentType: true },
  });
  const assetsById = new Map(foundAssets.map((asset) => [asset.id, asset]));
  const assets = requestedAssetIds.map((assetId) => assetsById.get(assetId));
  if (assets.some((asset) => !asset)) {
    return NextResponse.json({ success: false, error: "Escolha um arquivo pronto para publicar." }, { status: 400 });
  }
  const readyAssets = assets as Array<{ id: string; contentType: string }>;
  const trialError = validateTrialReelAssets(readyAssets, input.trialGraduationStrategy);
  if (trialError) {
    return NextResponse.json({ success: false, error: trialError }, { status: 400 });
  }

  let scheduledAt: Date | null = null;
  let status: "DRAFT" | "SCHEDULED" = "DRAFT";
  if (input.mode === "SCHEDULE") {
    if (!input.scheduledAt) {
      return NextResponse.json({ success: false, error: "Informe a data e o horário da publicação." }, { status: 400 });
    }
    scheduledAt = new Date(input.scheduledAt);
    if (scheduledAt.getTime() < Date.now() + 30_000) {
      return NextResponse.json({ success: false, error: "Escolha um horário pelo menos 30 segundos no futuro." }, { status: 400 });
    }
    status = "SCHEDULED";
  } else if (input.mode === "NOW") {
    scheduledAt = new Date(Date.now() + 5_000);
    status = "SCHEDULED";
  }

  if (status === "SCHEDULED" && !account.publishingPermissionGranted) {
    return NextResponse.json({
      success: false,
      error: "Reconecte sua conta do Instagram para conceder a permissão de publicar conteúdo.",
    }, { status: 409 });
  }

  let automationId: string | null = null;
  if (input.automationId) {
    const automation = await prisma.automation.findFirst({
      where: {
        id: input.automationId,
        workspaceId: context.workspaceId,
        instagramAccountId: account.id,
      },
      select: { id: true },
    });
    if (!automation) {
      return NextResponse.json({ success: false, error: "A campanha de DM não pertence a esta conta." }, { status: 400 });
    }
    automationId = automation.id;
  }

  const mediaType = postMediaType(readyAssets);
  const post = await prisma.$transaction(async (tx) => {
    if (automationId) {
      const linked = await tx.scheduledPost.findUnique({
        where: { automationId },
        select: { id: true, status: true },
      });
      if (linked && ["DRAFT", "SCHEDULED", "PUBLISHING"].includes(linked.status)) {
        throw new Error("Esta campanha já está vinculada a uma publicação pendente.");
      }
      if (linked) {
        await tx.scheduledPost.update({
          where: { id: linked.id },
          data: { automationId: null },
        });
      }
    }

    const created = await tx.scheduledPost.create({
      data: {
        workspaceId: context.workspaceId,
        instagramAccountId: account.id,
        mediaAssetId: readyAssets[0].id,
        automationId,
        mediaType,
        status,
        caption: input.caption,
        scheduledAt,
        timeZone: input.timeZone,
        shareToFeed: mediaType === "REEL"
          ? input.trialGraduationStrategy ? false : input.shareToFeed
          : true,
        trialGraduationStrategy: input.trialGraduationStrategy,
      },
    });
    await tx.scheduledPostMediaItem.createMany({
      data: readyAssets.map((asset, position) => ({
        scheduledPostId: created.id,
        mediaAssetId: asset.id,
        position,
      })),
    });
    return tx.scheduledPost.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        mediaAsset: { select: { id: true, fileName: true, contentType: true, byteSize: true, status: true } },
        mediaItems: {
          orderBy: { position: "asc" },
          include: { mediaAsset: { select: { id: true, fileName: true, contentType: true, byteSize: true, status: true } } },
        },
        instagramAccount: { select: { id: true, username: true } },
        automation: { select: { id: true, name: true, isActive: true } },
      },
    });
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "Esta campanha já está vinculada a uma publicação pendente.") {
      return null;
    }
    throw error;
  });

  if (!post) {
    return NextResponse.json({ success: false, error: "Esta campanha já está vinculada a uma publicação pendente." }, { status: 409 });
  }

  let queueResult = { queued: false, deferred: false, active: false };
  if (scheduledAt) {
    try {
      queueResult = await queueScheduledPost(post.id, scheduledAt);
    } catch (error) {
      console.error("[Scheduled Posts] Queue insert deferred to worker reconciliation:", error);
    }
  }

  return NextResponse.json(
    { success: true, data: publicPost(post), queue: queueResult },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Só pessoas administradoras podem editar publicações." }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Publicação não encontrada." }, { status: 400 });
  }
  const parsed = updatePostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Confira os dados da publicação." }, { status: 400 });
  }
  const input = parsed.data;
  if (!isValidTimeZone(input.timeZone)) {
    return NextResponse.json({ success: false, error: "Fuso horário inválido." }, { status: 400 });
  }

  const existing = await prisma.scheduledPost.findFirst({
    where: { id, workspaceId: context.workspaceId },
    select: { id: true, instagramAccountId: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ success: false, error: "Publicação não encontrada." }, { status: 404 });
  }
  if (!["DRAFT", "SCHEDULED"].includes(existing.status)) {
    return NextResponse.json({ success: false, error: "Essa publicação já entrou em processamento e não pode ser editada." }, { status: 409 });
  }

  const account = await getWorkspaceInstagramAccount(context.workspaceId, existing.instagramAccountId);
  if (!account) {
    return NextResponse.json({ success: false, error: "Conta do Instagram não encontrada." }, { status: 404 });
  }
  let scheduledAt: Date | null = null;
  if (input.mode === "SCHEDULE") {
    if (!input.scheduledAt) {
      return NextResponse.json({ success: false, error: "Informe a data e o horário da publicação." }, { status: 400 });
    }
    scheduledAt = new Date(input.scheduledAt);
    if (scheduledAt.getTime() < Date.now() + 30_000) {
      return NextResponse.json({ success: false, error: "Escolha um horário pelo menos 30 segundos no futuro." }, { status: 400 });
    }
    if (!account.publishingPermissionGranted) {
      return NextResponse.json({ success: false, error: "Reconecte sua conta do Instagram para conceder a permissão de publicar conteúdo." }, { status: 409 });
    }
  }
  const requestedAssetIds = inputAssetIds(input);
  const foundAssets = await prisma.mediaAsset.findMany({
    where: {
      id: { in: requestedAssetIds },
      workspaceId: context.workspaceId,
      instagramAccountId: account.id,
      status: "READY",
    },
    select: { id: true, contentType: true },
  });
  const assetsById = new Map(foundAssets.map((asset) => [asset.id, asset]));
  const assets = requestedAssetIds.map((assetId) => assetsById.get(assetId));
  if (assets.some((asset) => !asset)) {
    return NextResponse.json({ success: false, error: "Escolha um arquivo pronto para publicar." }, { status: 400 });
  }
  const readyAssets = assets as Array<{ id: string; contentType: string }>;
  const trialError = validateTrialReelAssets(readyAssets, input.trialGraduationStrategy);
  if (trialError) {
    return NextResponse.json({ success: false, error: trialError }, { status: 400 });
  }
  const mediaType = postMediaType(readyAssets);

  const post = await prisma.$transaction(async (tx) => {
    const updated = await tx.scheduledPost.updateMany({
      where: { id, workspaceId: context.workspaceId, status: { in: ["DRAFT", "SCHEDULED"] } },
      data: {
        mediaAssetId: readyAssets[0].id,
        mediaType,
        caption: input.caption,
        status: input.mode === "SCHEDULE" ? "SCHEDULED" : "DRAFT",
        scheduledAt,
        timeZone: input.timeZone,
        shareToFeed: mediaType === "REEL"
          ? input.trialGraduationStrategy ? false : input.shareToFeed
          : true,
        trialGraduationStrategy: input.trialGraduationStrategy,
        containerId: null,
        publishStartedAt: null,
        lastError: null,
      },
    });
    if (updated.count !== 1) return null;
    await tx.scheduledPostMediaItem.deleteMany({ where: { scheduledPostId: id } });
    await tx.scheduledPostMediaItem.createMany({
      data: readyAssets.map((asset, position) => ({ scheduledPostId: id, mediaAssetId: asset.id, position })),
    });
    return tx.scheduledPost.findUnique({
      where: { id },
      include: {
        mediaAsset: { select: { id: true, fileName: true, contentType: true, byteSize: true, status: true } },
        mediaItems: {
          orderBy: { position: "asc" },
          include: { mediaAsset: { select: { id: true, fileName: true, contentType: true, byteSize: true, status: true } } },
        },
        instagramAccount: { select: { id: true, username: true } },
        automation: { select: { id: true, name: true, isActive: true } },
      },
    });
  });
  if (!post) {
    return NextResponse.json({ success: false, error: "A publicação entrou em processamento antes de salvar suas alterações." }, { status: 409 });
  }

  if (scheduledAt) {
    try { await queueScheduledPost(id, scheduledAt, true); }
    catch (error) { console.error("[Scheduled Posts] Queue update deferred to reconciliation:", error); }
  } else {
    try { await removeScheduledPostJob(id); }
    catch (error) { console.error("[Scheduled Posts] Draft queue cleanup deferred:", error); }
  }

  return NextResponse.json({ success: true, data: publicPost(post) }, { headers: { "Cache-Control": "no-store" } });
}
