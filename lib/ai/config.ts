import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getAiConfig, getAiMonthlyLimit, parseReserveModels, type AiConfig } from "@/lib/env";

export interface ResolvedAiConfig extends AiConfig {
  /** Where the connection data came from. */
  source: "workspace" | "environment";
}

function sameAddress(a: string, b: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}

/**
 * Models to fall back to for a saved connection: the list typed in Settings, or,
 * when it is empty and the connection points at the same service as the server's
 * own default, the server's default models. That way a workspace that only picked
 * a main model still has a reserve.
 */
export function resolveFallbackModels(
  saved: { baseUrl: string; model: string; fallbackModels: string | null },
  environment: AiConfig | null
): string[] {
  const own = parseReserveModels(saved.fallbackModels, saved.model);
  if (own.length > 0) return own;
  if (!environment || !sameAddress(environment.baseUrl, saved.baseUrl)) return [];
  return [...new Set([environment.model, ...environment.fallbackModels])]
    .filter((name) => name !== saved.model)
    .slice(0, 3);
}

/**
 * The AI connection a workspace should use. A connection saved in Settings wins
 * over the AI_* environment variables, and turning it off in Settings turns the
 * assistant off for that workspace even when the server has defaults.
 */
export async function resolveAiConfig(workspaceId: string): Promise<ResolvedAiConfig | null> {
  const environment = getAiConfig();
  const saved = await prisma.aiConnection.findUnique({ where: { workspaceId } });
  if (saved) {
    if (!saved.enabled) return null;
    try {
      return {
        baseUrl: saved.baseUrl,
        apiKey: decryptToken(saved.apiKeyEncrypted),
        model: saved.model,
        fallbackModels: resolveFallbackModels(saved, environment),
        monthlyLimit: getAiMonthlyLimit(),
        source: "workspace",
      };
    } catch {
      console.error("[AI] Não foi possível ler a chave salva para este workspace. Salve a chave de novo.");
      return null;
    }
  }

  return environment ? { ...environment, source: "environment" } : null;
}
