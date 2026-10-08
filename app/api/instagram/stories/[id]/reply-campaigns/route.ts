import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { buildInitialCampaignLinks } from "@/lib/campaigns/links";
import { generateReportShareSlug } from "@/lib/reports/share";
import { getCurrentWorkspaceContext, canManageWorkspace } from "@/lib/workspace-access";

/**
 * "Reply with a keyword" rules of a Stories sequence. Each rule is a regular
 * DM-triggered campaign bound to the sequence (storySequenceId), so the worker
 * only fires it for replies to this sequence's Stories. Two or more rules work
 * as a poll: the share of people per keyword is the result.
 */

const createSchema = z.object({
  keyword: z
    .string()
    .trim()
    .min(1, "Informe a palavra-chave.")
    .max(30, "Use uma palavra-chave de até 30 caracteres."),
  message: z
    .string()
    .trim()
    .min(1, "Escreva a mensagem que será enviada.")
    .max(1000, "A mensagem pode ter até 1.000 caracteres."),
  linkUrl: z
    .string()
    .trim()
    .url("Informe um link válido, começando com https://.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

type Params = { params: Promise<{ id: string }> };

async function loadSequence(id: string, workspaceId: string) {
  return prisma.storySequence.findFirst({
    where: { id, workspaceId },
    select: {
      id: true,
      title: true,
      instagramAccountId: true,
      slides: { select: { instagramMediaId: true, position: true } },
    },
  });
}

export async function GET(_request: Request, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const sequence = await loadSequence(id, context.workspaceId);
  if (!sequence) return NextResponse.json({ success: false, error: "Sequência não encontrada." }, { status: 404 });

  const campaigns = await prisma.automation.findMany({
    where: { storySequenceId: sequence.id, workspaceId: context.workspaceId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      keywords: true,
      dmMessage: true,
      isActive: true,
      trackedLinks: { select: { destinationUrl: true }, orderBy: { position: "asc" }, take: 1 },
    },
  });

  const logs = campaigns.length
    ? await prisma.dmLog.findMany({
        where: { automationId: { in: campaigns.map((campaign) => campaign.id) } },
        select: { automationId: true, commenterId: true, status: true, storyMediaId: true },
      })
    : [];

  const positionByMedia = new Map(
    sequence.slides
      .filter((slide) => slide.instagramMediaId)
      .map((slide) => [slide.instagramMediaId as string, slide.position + 1])
  );

  const data = campaigns.map((campaign) => {
    const own = logs.filter((log) => log.automationId === campaign.id);
    const bySlide = new Map<number, Set<string>>();
    for (const log of own) {
      const position = log.storyMediaId ? positionByMedia.get(log.storyMediaId) : undefined;
      if (!position) continue;
      if (!bySlide.has(position)) bySlide.set(position, new Set());
      bySlide.get(position)!.add(log.commenterId);
    }
    return {
      id: campaign.id,
      keyword: campaign.keywords[0] ?? "",
      message: campaign.dmMessage,
      linkUrl: campaign.trackedLinks[0]?.destinationUrl ?? null,
      isActive: campaign.isActive,
      // People, not messages: replying twice with the same word counts once.
      people: new Set(own.map((log) => log.commenterId)).size,
      sent: own.filter((log) => log.status === "SENT").length,
      bySlide: [...bySlide.entries()]
        .sort(([a], [b]) => a - b)
        .map(([position, people]) => ({ position, people: people.size })),
    };
  });

  return NextResponse.json({ success: true, data });
}

export async function POST(request: Request, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Só pessoas administradoras podem criar respostas automáticas." }, { status: 403 });
  }
  const { id } = await params;
  const sequence = await loadSequence(id, context.workspaceId);
  if (!sequence) return NextResponse.json({ success: false, error: "Sequência não encontrada." }, { status: 404 });

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  }
  const { keyword, message, linkUrl } = parsed.data;

  const existing = await prisma.automation.findMany({
    where: { storySequenceId: sequence.id },
    select: { keywords: true },
  });
  if (existing.some((campaign) => campaign.keywords.some((word) => word.toLowerCase() === keyword.toLowerCase()))) {
    return NextResponse.json({ success: false, error: `A palavra ${keyword} já tem uma resposta nesta sequência.` }, { status: 409 });
  }

  const links = buildInitialCampaignLinks({ workspaceId: context.workspaceId, primaryUrl: linkUrl });
  const campaign = await prisma.automation.create({
    data: {
      workspaceId: context.workspaceId,
      instagramAccountId: sequence.instagramAccountId,
      storySequenceId: sequence.id,
      name: `Stories · ${sequence.title} · ${keyword}`,
      goal: "Resposta a Stories",
      keywords: [keyword],
      matchAnyWord: false,
      wholeWordMatch: true,
      dmTriggerEnabled: true,
      dmMessage: message,
      linkButtonLabel: linkUrl ? "Abrir link" : null,
      isActive: true,
      reportShareSlug: generateReportShareSlug(),
      ...(links.length > 0 ? { trackedLinks: { create: links } } : {}),
    },
    select: { id: true },
  });

  return NextResponse.json({ success: true, data: campaign }, { status: 201 });
}

export async function DELETE(request: Request, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Só pessoas administradoras podem remover respostas automáticas." }, { status: 403 });
  }
  const { id } = await params;
  const campaignId = new URL(request.url).searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ success: false, error: "Resposta não informada." }, { status: 400 });

  const deleted = await prisma.automation.deleteMany({
    where: { id: campaignId, storySequenceId: id, workspaceId: context.workspaceId },
  });
  if (deleted.count !== 1) return NextResponse.json({ success: false, error: "Resposta não encontrada." }, { status: 404 });
  return NextResponse.json({ success: true });
}
