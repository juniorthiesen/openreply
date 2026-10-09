import { NextRequest } from "next/server";
import { z } from "zod";
import { describeFallback } from "@/lib/ai/client";
import {
  generateReplyVariations,
  MAX_REPLY_BASE_LENGTH,
  MAX_VARIATIONS,
  MIN_VARIATIONS,
} from "@/lib/ai/reply-variations";
import { aiErrorResponse, aiFailure, aiJson, guardAiRequest } from "@/lib/ai/route-guard";
import { recordAiGeneration } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  message: z.string().trim().min(3, "Escreva a resposta base primeiro.").max(MAX_REPLY_BASE_LENGTH),
  count: z.number().int().min(MIN_VARIATIONS).max(MAX_VARIATIONS).default(5),
});

/** Rewrite one public reply into several versions with the same meaning. */
export async function POST(request: NextRequest) {
  const guard = await guardAiRequest();
  if ("response" in guard) return guard.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return aiFailure(parsed.error.issues[0]?.message ?? "Pedido inválido.", 400);
  }

  try {
    const { variations, usage, modelUsed, failures } = await generateReplyVariations(
      parsed.data.message,
      parsed.data.count,
      guard.config
    );
    if (variations.length === 0) {
      return aiFailure("A IA não conseguiu gerar versões diferentes. Tente de novo.", 502);
    }
    await recordAiGeneration({
      workspaceId: guard.context.workspaceId,
      userId: guard.context.userId,
      kind: "reply_variations",
      usage,
    });
    return aiJson({
      success: true,
      data: { variations, remaining: guard.remaining, model: modelUsed, notice: describeFallback(failures, modelUsed) },
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
