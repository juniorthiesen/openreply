import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAbPanelData } from "@/lib/ab/results";
import { AbTestError, endAbTest, startAbTest } from "@/lib/ab/tests";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function failure(error: string, status: number) {
  return json({ success: false, error }, status);
}

function errorResponse(error: unknown) {
  if (error instanceof AbTestError) return failure(error.message, error.status);
  console.error("[A/B] Erro inesperado:", error instanceof Error ? error.message : error);
  return failure("Não foi possível concluir agora. Tente de novo.", 500);
}

// Only web addresses: the redirect sends people there.
const webUrl = z
  .string()
  .trim()
  .max(2000)
  .url("Informe um link válido.")
  .refine((value) => /^https?:\/\//i.test(value), "O link deve começar com http:// ou https://.");

const startSchema = z.object({
  weightA: z.number().int().min(10).max(90).default(50),
  aDestinationUrl: z.union([webUrl, z.literal("")]).optional(),
  b: z.object({
    dmMessage: z.string().trim().min(1, "Escreva a mensagem da variante B.").max(1000),
    // Instagram button titles are short.
    linkButtonLabel: z.string().trim().max(20, "O texto do botão deve ter até 20 caracteres.").nullish(),
    destinationUrl: webUrl,
  }),
});

const endSchema = z.object({ winner: z.enum(["A", "B"]).nullable() });

function campaignId(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("id");
}

/** The latest test of a campaign with its results. Any member of the workspace can read it. */
export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return failure("Unauthorized", 401);
  const automationId = campaignId(request);
  if (!automationId) return failure("Falta o id da campanha.", 400);

  try {
    const data = await getAbPanelData(context.workspaceId, automationId);
    if (!data) return failure("Campanha não encontrada.", 404);
    return json({ success: true, data });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Start a test. Variant A is the campaign as it is; the body describes B. */
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return failure("Unauthorized", 401);
  if (!canManageWorkspace(context.role)) return failure("Só donos e administradores criam testes A/B.", 403);
  const automationId = campaignId(request);
  if (!automationId) return failure("Falta o id da campanha.", 400);

  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failure(parsed.error.issues[0]?.message ?? "Dados inválidos.", 400);

  try {
    await startAbTest({
      workspaceId: context.workspaceId,
      automationId,
      weightA: parsed.data.weightA,
      aDestinationUrl: parsed.data.aDestinationUrl || null,
      b: {
        dmMessage: parsed.data.b.dmMessage,
        linkButtonLabel: parsed.data.b.linkButtonLabel ?? null,
        destinationUrl: parsed.data.b.destinationUrl,
      },
    });
    const data = await getAbPanelData(context.workspaceId, automationId);
    return json({ success: true, data }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

/** End the running test, with a winner ("A" or "B") or without one (null). */
export async function PUT(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return failure("Unauthorized", 401);
  if (!canManageWorkspace(context.role)) return failure("Só donos e administradores encerram testes A/B.", 403);
  const automationId = campaignId(request);
  if (!automationId) return failure("Falta o id da campanha.", 400);

  const parsed = endSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failure("Escolha A, B ou nenhum vencedor.", 400);

  try {
    await endAbTest({ workspaceId: context.workspaceId, automationId, winner: parsed.data.winner });
    const data = await getAbPanelData(context.workspaceId, automationId);
    return json({ success: true, data });
  } catch (error) {
    return errorResponse(error);
  }
}
