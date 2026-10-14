import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

const text = (max: number) => z.string().trim().min(1).max(max);

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "Informe um link começando com https://");

const ruleSchema = z.object({
  facebookPageId: z.string().min(1),
  name: text(120),
  videoId: z.string().trim().max(100).nullish(),
  videoTitle: z.string().trim().max(300).nullish(),
  videoUrl: z.string().trim().max(2000).nullish(),
  matchAnyPost: z.boolean().default(false),
  keywords: z.array(text(60)).max(30).default([]),
  matchAnyWord: z.boolean().default(false),
  wholeWordMatch: z.boolean().default(true),
  dmMessage: text(2000),
  linkUrl: httpUrl.nullish(),
  linkButtonLabel: z.string().trim().max(20).nullish(),
  publicReplyEnabled: z.boolean().default(false),
  publicReplyMessages: z.array(text(500)).max(10).default([]),
  isActive: z.boolean().default(true),
});

type RuleInput = z.infer<typeof ruleSchema>;

/** Cross-field rules that a per-field schema can't express. */
function validateRule(rule: Pick<
  RuleInput,
  "matchAnyPost" | "videoId" | "matchAnyWord" | "keywords" | "publicReplyEnabled" | "publicReplyMessages"
>): string | null {
  if (!rule.matchAnyPost && !rule.videoId) return "Escolha o vídeo da campanha.";
  if (!rule.matchAnyWord && rule.keywords.length === 0) {
    return "Informe ao menos uma palavra-chave, ou responda a qualquer comentário.";
  }
  if (rule.publicReplyEnabled && rule.publicReplyMessages.length === 0) {
    return "Escreva ao menos uma resposta pública, ou desligue essa opção.";
  }
  return null;
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const rules = await prisma.facebookAutomation.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  const counts = await prisma.facebookCommentLog.groupBy({
    by: ["automationId", "status"],
    where: { automation: { workspaceId: context.workspaceId } },
    _count: { _all: true },
  });
  const recentFailures = await prisma.facebookCommentLog.findMany({
    where: { automation: { workspaceId: context.workspaceId }, status: "FAILED" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { automationId: true, commenterName: true, errorMessage: true, createdAt: true },
  });

  const stats = new Map<string, { sent: number; failed: number }>();
  for (const row of counts) {
    const entry = stats.get(row.automationId) ?? { sent: 0, failed: 0 };
    if (row.status === "SENT") entry.sent += row._count._all;
    if (row.status === "FAILED") entry.failed += row._count._all;
    stats.set(row.automationId, entry);
  }

  return NextResponse.json({
    success: true,
    data: {
      rules: rules.map((rule) => ({
        ...rule,
        sent: stats.get(rule.id)?.sent ?? 0,
        failed: stats.get(rule.id)?.failed ?? 0,
      })),
      recentFailures,
    },
  });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const parsed = ruleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const problem = validateRule(input);
  if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });

  const page = await prisma.facebookPage.findFirst({
    where: { id: input.facebookPageId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!page) {
    return NextResponse.json({ success: false, error: "Página não encontrada." }, { status: 404 });
  }

  const rule = await prisma.facebookAutomation.create({
    data: {
      ...input,
      workspaceId: context.workspaceId,
      videoId: input.matchAnyPost ? null : input.videoId,
      linkUrl: input.linkUrl || null,
      linkButtonLabel: input.linkUrl ? input.linkButtonLabel || null : null,
    },
  });
  return NextResponse.json({ success: true, data: { rule } });
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: "id é obrigatório" }, { status: 400 });

  const existing = await prisma.facebookAutomation.findFirst({
    where: { id, workspaceId: context.workspaceId },
  });
  if (!existing) {
    return NextResponse.json({ success: false, error: "Campanha não encontrada." }, { status: 404 });
  }

  const parsed = ruleSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    );
  }
  // The Page a rule belongs to never changes: its token and webhook are per Page.
  const { facebookPageId: _ignored, ...changes } = parsed.data;
  void _ignored;

  const merged = { ...existing, ...changes };
  const problem = validateRule(merged);
  if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });

  const rule = await prisma.facebookAutomation.update({
    where: { id },
    data: {
      ...changes,
      ...(changes.matchAnyPost ? { videoId: null } : {}),
      ...(changes.linkUrl !== undefined ? { linkUrl: changes.linkUrl || null } : {}),
    },
  });
  return NextResponse.json({ success: true, data: { rule } });
}

export async function DELETE(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: "id é obrigatório" }, { status: 400 });

  const result = await prisma.facebookAutomation.deleteMany({
    where: { id, workspaceId: context.workspaceId },
  });
  if (result.count !== 1) {
    return NextResponse.json({ success: false, error: "Campanha não encontrada." }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
