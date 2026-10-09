import { NextRequest } from "next/server";
import { z } from "zod";
import { AiError } from "@/lib/ai/errors";
import { describeConnection } from "@/lib/ai/connection";
import { aiErrorResponse, aiFailure, aiJson, requireAiManager } from "@/lib/ai/route-guard";
import { assertSafeAiUrl } from "@/lib/ai/url-safety";
import { prisma } from "@/lib/db/client";
import { parseReserveModels } from "@/lib/env";
import { encryptToken } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  baseUrl: z.string().trim().min(1, "Informe o endereço (URL) da IA.").max(300),
  // Left out or empty means "keep the key that is already saved".
  apiKey: z.string().trim().max(500).optional(),
  model: z.string().trim().min(1, "Informe o modelo.").max(100),
  // Reserve models, separated by commas. Empty clears them; left out keeps what is saved.
  fallbackModels: z.string().max(400).optional(),
  enabled: z.boolean(),
});

/** The saved connection, without the key. */
export async function GET() {
  const manager = await requireAiManager();
  if ("response" in manager) return manager.response;
  return aiJson({ success: true, data: await describeConnection(manager.context.workspaceId) });
}

/** Save the address, key and model for this workspace. The key is stored encrypted. */
export async function PUT(request: NextRequest) {
  const manager = await requireAiManager();
  if ("response" in manager) return manager.response;
  const { workspaceId, userId } = manager.context;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return aiFailure(parsed.error.issues[0]?.message ?? "Dados inválidos.", 400);
  }

  try {
    const baseUrl = await assertSafeAiUrl(parsed.data.baseUrl);
    const existing = await prisma.aiConnection.findUnique({ where: { workspaceId } });

    const newKey = parsed.data.apiKey?.trim();
    if (!newKey && !existing) throw new AiError("Informe a chave da IA.", 400);
    if (newKey && newKey.length < 8) throw new AiError("Essa chave parece curta demais. Confira e cole de novo.", 400);

    const apiKeyEncrypted = newKey ? encryptToken(newKey) : existing!.apiKeyEncrypted;
    const fallbackModels =
      parsed.data.fallbackModels === undefined
        ? (existing?.fallbackModels ?? null)
        : parseReserveModels(parsed.data.fallbackModels, parsed.data.model).join(", ") || null;
    await prisma.aiConnection.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        baseUrl,
        apiKeyEncrypted,
        model: parsed.data.model,
        fallbackModels,
        enabled: parsed.data.enabled,
        updatedByUserId: userId,
      },
      update: {
        baseUrl,
        apiKeyEncrypted,
        model: parsed.data.model,
        fallbackModels,
        enabled: parsed.data.enabled,
        updatedByUserId: userId,
      },
    });
    return aiJson({ success: true, data: await describeConnection(workspaceId) });
  } catch (error) {
    return aiErrorResponse(error);
  }
}

/** Remove the saved connection. The workspace goes back to the server defaults, if any. */
export async function DELETE() {
  const manager = await requireAiManager();
  if ("response" in manager) return manager.response;
  const { workspaceId } = manager.context;

  await prisma.aiConnection.deleteMany({ where: { workspaceId } });
  return aiJson({ success: true, data: await describeConnection(workspaceId) });
}
