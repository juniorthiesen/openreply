import { NextRequest } from "next/server";
import { z } from "zod";
import { generateCampaignDraft, MAX_DRAFT_REQUEST_LENGTH } from "@/lib/ai/campaign-draft";
import { describeFallback } from "@/lib/ai/client";
import { aiErrorResponse, aiFailure, aiJson, guardAiRequest } from "@/lib/ai/route-guard";
import { recordAiGeneration } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  prompt: z.string().trim().min(5, "Descreva a campanha com um pouco mais de detalhe.").max(MAX_DRAFT_REQUEST_LENGTH),
});

/** Turn a sentence into a campaign draft. It only suggests: nothing is saved or activated. */
export async function POST(request: NextRequest) {
  const guard = await guardAiRequest();
  if ("response" in guard) return guard.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return aiFailure(parsed.error.issues[0]?.message ?? "Pedido inválido.", 400);
  }

  try {
    const { draft, usage, modelUsed, failures } = await generateCampaignDraft(parsed.data.prompt, guard.config);
    await recordAiGeneration({
      workspaceId: guard.context.workspaceId,
      userId: guard.context.userId,
      kind: "campaign_draft",
      usage,
    });
    return aiJson({
      success: true,
      data: { draft, remaining: guard.remaining, model: modelUsed, notice: describeFallback(failures, modelUsed) },
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
