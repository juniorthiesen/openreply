import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext, canManageWorkspace } from "@/lib/workspace-access";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { getMediaPublicUrl } from "@/lib/media-assets";
import { queueStorySequence, removeStorySequenceJob } from "@/lib/queue/story-sequences";
import { resolveStoryPublishingPage } from "@/lib/instagram-stories/page-link";

export const dynamic = "force-dynamic";

const saveFields = z.object({
  instagramAccountId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  mediaAssetIds: z.array(z.string().min(1)).min(1).max(20),
  mode: z.enum(["DRAFT", "SCHEDULE", "NOW"]),
  scheduledAt: z.string().datetime().optional(),
  timeZone: z.string().min(1).max(100),
});
const distinctFrames = {
  check: (value: { mediaAssetIds: string[] }) => new Set(value.mediaAssetIds).size === value.mediaAssetIds.length,
  message: "Selecione arquivos diferentes para cada quadro.",
};
const saveSchema = saveFields.refine(distinctFrames.check, { message: distinctFrames.message });
// Zod 4 refuses .omit() on a refined schema (it threw on every edit), so the
// edit schema is derived from the plain fields and refined again.
const updateSchema = saveFields
  .omit({ instagramAccountId: true })
  .refine(distinctFrames.check, { message: distinctFrames.message });

function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: value }); return true; }
  catch { return false; }
}

function publicSequence<T extends { slides: Array<{ mediaAsset: { id: string; status: string } }> }>(sequence: T) {
  return {
    ...sequence,
    slides: sequence.slides.map((slide) => ({
      ...slide,
      mediaUrl: slide.mediaAsset.status === "READY" ? getMediaPublicUrl(slide.mediaAsset.id) : null,
    })),
  };
}

const includes = {
  instagramAccount: { select: { id: true, username: true } },
  slides: {
    orderBy: { position: "asc" as const },
    include: {
      mediaAsset: { select: { id: true, fileName: true, contentType: true, byteSize: true, status: true } },
      metrics: { orderBy: { capturedAt: "desc" as const }, take: 1 },
    },
  },
};

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const instagramAccountId = request.nextUrl.searchParams.get("instagramAccountId");
  const sequences = await prisma.storySequence.findMany({
    where: { workspaceId: context.workspaceId, ...(instagramAccountId ? { instagramAccountId } : {}), status: { not: "CANCELED" } },
    include: includes,
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ success: true, data: sequences.map(publicSequence) }, { headers: { "Cache-Control": "private, no-store" } });
}

async function validateInput(workspaceId: string, input: z.infer<typeof saveSchema>) {
  if (!validTimeZone(input.timeZone)) return { error: "Fuso horário inválido.", status: 400 as const };
  const account = await getWorkspaceInstagramAccount(workspaceId, input.instagramAccountId);
  if (!account) return { error: "Conta do Instagram não encontrada.", status: 404 as const };
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: input.mediaAssetIds }, workspaceId, instagramAccountId: account.id, status: "READY" },
    select: { id: true, contentType: true },
  });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const ordered = input.mediaAssetIds.map((id) => byId.get(id));
  if (ordered.some((asset) => !asset)) return { error: "Escolha arquivos prontos da biblioteca desta conta.", status: 400 as const };
  if ((ordered as Array<{ contentType: string }>).some((asset) => !["image/jpeg", "video/mp4", "video/quicktime"].includes(asset.contentType))) {
    return { error: "Stories aceita imagens JPEG e vídeos MP4 ou MOV.", status: 400 as const };
  }

  let scheduledAt: Date | null = null;
  if (input.mode === "SCHEDULE") {
    if (!input.scheduledAt) return { error: "Informe a data e o horário.", status: 400 as const };
    scheduledAt = new Date(input.scheduledAt);
    if (scheduledAt.getTime() < Date.now() + 30_000) return { error: "Escolha um horário pelo menos 30 segundos no futuro.", status: 400 as const };
  } else if (input.mode === "NOW") {
    scheduledAt = new Date(Date.now() + 10_000);
  }
  if (scheduledAt) {
    const page = await resolveStoryPublishingPage(workspaceId, account.id);
    if (!page) {
      return { error: "Conecte em Configurações a Página do Facebook vinculada a esta conta Business do Instagram.", status: 409 as const };
    }
  }
  return { account, ordered: ordered as Array<{ id: string; contentType: string }>, scheduledAt };
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ success: false, error: "Só pessoas administradoras podem gerenciar Stories." }, { status: 403 });
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Confira os dados da sequência." }, { status: 400 });
  const checked = await validateInput(context.workspaceId, parsed.data);
  if ("error" in checked) return NextResponse.json({ success: false, error: checked.error }, { status: checked.status });
  const sequence = await prisma.$transaction(async (tx) => {
    const created = await tx.storySequence.create({
      data: {
        workspaceId: context.workspaceId,
        instagramAccountId: checked.account.id,
        title: parsed.data.title,
        status: checked.scheduledAt ? "SCHEDULED" : "DRAFT",
        scheduledAt: checked.scheduledAt,
        timeZone: parsed.data.timeZone,
        slides: { create: checked.ordered.map((asset, position) => ({ mediaAssetId: asset.id, position })) },
      },
      include: includes,
    });
    return created;
  });
  let queue = { queued: false, deferred: false, active: false };
  if (checked.scheduledAt) {
    try { queue = await queueStorySequence(sequence.id, checked.scheduledAt); }
    catch (error) { console.error("[Stories] Queue insert deferred to worker reconciliation:", error); }
  }
  return NextResponse.json({ success: true, data: publicSequence(sequence), queue }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ success: false, error: "Só pessoas administradoras podem editar Stories." }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: "Sequência não encontrada." }, { status: 400 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Confira os dados da sequência." }, { status: 400 });
  const existing = await prisma.storySequence.findFirst({ where: { id, workspaceId: context.workspaceId }, select: { id: true, instagramAccountId: true, status: true } });
  if (!existing) return NextResponse.json({ success: false, error: "Sequência não encontrada." }, { status: 404 });
  if (!["DRAFT", "SCHEDULED"].includes(existing.status)) return NextResponse.json({ success: false, error: "Esta sequência já começou a ser publicada e não pode ser editada." }, { status: 409 });
  const input = { ...parsed.data, instagramAccountId: existing.instagramAccountId };
  const checked = await validateInput(context.workspaceId, input);
  if ("error" in checked) return NextResponse.json({ success: false, error: checked.error }, { status: checked.status });
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.storySequence.updateMany({ where: { id, workspaceId: context.workspaceId, status: { in: ["DRAFT", "SCHEDULED"] } }, data: {
      title: parsed.data.title,
      status: checked.scheduledAt ? "SCHEDULED" : "DRAFT",
      scheduledAt: checked.scheduledAt,
      timeZone: parsed.data.timeZone,
      lastError: null,
      publishedAt: null,
    } });
    if (claimed.count !== 1) return null;
    await tx.storySlide.deleteMany({ where: { sequenceId: id } });
    await tx.storySlide.createMany({ data: checked.ordered.map((asset, position) => ({ sequenceId: id, mediaAssetId: asset.id, position })) });
    return tx.storySequence.findUnique({ where: { id }, include: includes });
  });
  if (!updated) return NextResponse.json({ success: false, error: "A sequência começou a ser publicada antes de salvar." }, { status: 409 });
  try {
    if (checked.scheduledAt) await queueStorySequence(id, checked.scheduledAt, true);
    else await removeStorySequenceJob(id);
  } catch (error) { console.error("[Stories] Queue update deferred to reconciliation:", error); }
  return NextResponse.json({ success: true, data: publicSequence(updated) }, { headers: { "Cache-Control": "no-store" } });
}
