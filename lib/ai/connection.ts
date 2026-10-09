import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { resolveFallbackModels } from "@/lib/ai/config";
import { getAiConfig, parseModelList } from "@/lib/env";

/** What the Settings screen needs to know. The key itself is never included. */
export interface AiConnectionView {
  /** Whether any connection (saved or from the server) exists. */
  configured: boolean;
  source: "workspace" | "environment" | "none";
  enabled: boolean;
  baseUrl: string;
  model: string;
  /** Reserve models typed in Settings. */
  fallbackModels: string[];
  /** Reserve models used when that field is left blank (the server's own defaults, for the same service). */
  implicitFallbackModels: string[];
  /** Masked tail of the saved key, to show that one is stored. */
  keyHint: string | null;
  /** The server has its own default connection that is used when nothing is saved. */
  environmentAvailable: boolean;
}

export function maskKey(key: string): string {
  return key.length >= 12 ? `••••${key.slice(-4)}` : "••••";
}

export async function describeConnection(workspaceId: string): Promise<AiConnectionView> {
  const environment = getAiConfig();
  const saved = await prisma.aiConnection.findUnique({ where: { workspaceId } });

  if (saved) {
    let keyHint: string | null = null;
    try {
      keyHint = maskKey(decryptToken(saved.apiKeyEncrypted));
    } catch {
      keyHint = null;
    }
    return {
      configured: true,
      source: "workspace",
      enabled: saved.enabled,
      baseUrl: saved.baseUrl,
      model: saved.model,
      fallbackModels: parseModelList(saved.fallbackModels),
      implicitFallbackModels: resolveFallbackModels({ ...saved, fallbackModels: null }, environment),
      keyHint,
      environmentAvailable: environment !== null,
    };
  }

  if (environment) {
    return {
      configured: true,
      source: "environment",
      enabled: true,
      baseUrl: environment.baseUrl,
      model: environment.model,
      fallbackModels: environment.fallbackModels,
      implicitFallbackModels: [],
      keyHint: null,
      environmentAvailable: true,
    };
  }

  return {
    configured: false,
    source: "none",
    enabled: false,
    baseUrl: "",
    model: "",
    fallbackModels: [],
    implicitFallbackModels: [],
    keyHint: null,
    environmentAvailable: false,
  };
}
