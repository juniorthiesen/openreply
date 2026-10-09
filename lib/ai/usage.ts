import { prisma } from "@/lib/db/client";
import { getRedisConnection } from "@/lib/queue/client";
import { AiError, type AiUsage } from "@/lib/ai/client";

export type AiGenerationKind = "campaign_draft" | "reply_variations";

const RATE_LIMIT_PER_MINUTE = 5;

function monthStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Generations a workspace has used this calendar month. */
export async function countMonthlyGenerations(workspaceId: string, now: Date = new Date()): Promise<number> {
  return prisma.aiGeneration.count({
    where: { workspaceId, createdAt: { gte: monthStart(now) } },
  });
}

/**
 * Throw an AiError (HTTP 429) when the workspace is asking too fast or has used
 * its monthly allowance. Returns how many generations remain after this one.
 */
export async function assertAiAllowance(
  workspaceId: string,
  limits: { monthlyLimit: number }
): Promise<{ remaining: number }> {
  try {
    const redis = getRedisConnection();
    const key = `ai:rate:${workspaceId}`;
    const hits = await redis.incr(key);
    if (hits === 1) await redis.expire(key, 60);
    if (hits > RATE_LIMIT_PER_MINUTE) {
      throw new AiError("Muitas solicitações em pouco tempo. Aguarde um minuto e tente de novo.", 429);
    }
  } catch (error) {
    if (error instanceof AiError) throw error;
    // Without Redis the per-minute guard cannot run; the monthly limit below still does.
    console.warn("[AI] Limite por minuto indisponível:", error instanceof Error ? error.message : error);
  }

  const used = await countMonthlyGenerations(workspaceId);
  if (used >= limits.monthlyLimit) {
    throw new AiError(
      `Você usou as ${limits.monthlyLimit} gerações de IA deste mês. O limite volta no começo do próximo mês.`,
      429
    );
  }
  return { remaining: limits.monthlyLimit - used - 1 };
}

const TEST_LIMIT_PER_MINUTE = 10;

/** Connection tests are cheap but reach out to a typed address, so they are rate limited too. */
export async function assertAiTestAllowance(workspaceId: string): Promise<void> {
  try {
    const redis = getRedisConnection();
    const key = `ai:test:${workspaceId}`;
    const hits = await redis.incr(key);
    if (hits === 1) await redis.expire(key, 60);
    if (hits > TEST_LIMIT_PER_MINUTE) {
      throw new AiError("Muitos testes em pouco tempo. Aguarde um minuto e tente de novo.", 429);
    }
  } catch (error) {
    if (error instanceof AiError) throw error;
    console.warn("[AI] Limite de testes indisponível:", error instanceof Error ? error.message : error);
  }
}

/** Record that a generation happened. Only counts and the model name are kept, never the text. */
export async function recordAiGeneration(input: {
  workspaceId: string;
  userId: string;
  kind: AiGenerationKind;
  usage: AiUsage;
}): Promise<void> {
  await prisma.aiGeneration.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      kind: input.kind,
      model: input.usage.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
    },
  });
}
