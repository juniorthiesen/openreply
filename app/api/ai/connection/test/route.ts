import { NextRequest } from "next/server";
import { z } from "zod";
import { listAiModels, pingAiModel } from "@/lib/ai/client";
import { resolveAiConfig, resolveFallbackModels } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { aiErrorResponse, aiFailure, aiJson, requireAiManager } from "@/lib/ai/route-guard";
import { assertAiTestAllowance } from "@/lib/ai/usage";
import { prisma } from "@/lib/db/client";
import { getAiConfig, parseReserveModels } from "@/lib/env";
import { decryptToken } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Every field is optional: whatever is left out is taken from what is already saved.
const bodySchema = z.object({
  baseUrl: z.string().trim().max(300).optional(),
  apiKey: z.string().trim().max(500).optional(),
  model: z.string().trim().max(100).optional(),
  fallbackModels: z.string().max(400).optional(),
});

interface ModelTestResult {
  model: string;
  role: "principal" | "reserva";
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/** Try a connection, typed in the form or already saved, without saving anything. */
export async function POST(request: NextRequest) {
  const manager = await requireAiManager();
  if ("response" in manager) return manager.response;
  const { workspaceId } = manager.context;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return aiFailure("Dados inválidos.", 400);

  try {
    await assertAiTestAllowance(workspaceId);

    const saved = await prisma.aiConnection.findUnique({ where: { workspaceId } });
    let savedKey: string | undefined;
    if (saved) {
      try {
        savedKey = decryptToken(saved.apiKeyEncrypted);
      } catch {
        savedKey = undefined;
      }
    }
    const fallback = saved ? null : await resolveAiConfig(workspaceId);

    const baseUrl = parsed.data.baseUrl || saved?.baseUrl || fallback?.baseUrl;
    const apiKey = parsed.data.apiKey || savedKey || fallback?.apiKey;
    const model = parsed.data.model || saved?.model || fallback?.model;
    if (!baseUrl || !apiKey) throw new AiError("Preencha o endereço e a chave para testar.", 400);

    // Look the models up first, so the list is useful even if no model is chosen yet.
    const models = await listAiModels({ baseUrl, apiKey });
    if (!model) return aiJson({ success: true, data: { ok: true, tested: false, models, results: [] } });

    // Reserve models: the ones typed in the form, else the saved ones, else the defaults that would apply.
    const reserve =
      parsed.data.fallbackModels !== undefined
        ? parseReserveModels(parsed.data.fallbackModels, model)
        : saved
          ? resolveFallbackModels({ baseUrl, model, fallbackModels: saved.fallbackModels }, getAiConfig())
          : (fallback?.fallbackModels ?? []).filter((name) => name !== model);

    const targets: Array<{ model: string; role: ModelTestResult["role"] }> = [
      { model, role: "principal" },
      ...reserve.map((name) => ({ model: name, role: "reserva" as const })),
    ];
    const results: ModelTestResult[] = await Promise.all(
      targets.map(async (target): Promise<ModelTestResult> => {
        try {
          const ping = await pingAiModel({ baseUrl, apiKey }, target.model);
          return { ...target, ok: true, latencyMs: ping.latencyMs };
        } catch (error) {
          return {
            ...target,
            ok: false,
            error: error instanceof AiError ? error.message : "Não foi possível testar este modelo.",
          };
        }
      })
    );

    const primary = results[0];
    // A refused key or an unreachable address is the same for every model: report it as the error.
    if (!primary.ok && results.every((result) => !result.ok)) {
      return aiFailure(primary.error ?? "Não foi possível testar a conexão.", 424);
    }
    return aiJson({
      success: true,
      data: { ok: primary.ok, tested: true, latencyMs: primary.latencyMs, model, models, results },
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
