import { NextResponse } from "next/server";
import { AiError } from "@/lib/ai/client";
import { resolveAiConfig, type ResolvedAiConfig } from "@/lib/ai/config";
import { assertAiAllowance } from "@/lib/ai/usage";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
  type WorkspaceContext,
} from "@/lib/workspace-access";

const NO_STORE = { "Cache-Control": "private, no-store" };

export function aiJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function aiFailure(error: string, status: number) {
  return aiJson({ success: false, error }, status);
}

/** Turn any error thrown while generating into a safe response. */
export function aiErrorResponse(error: unknown) {
  if (error instanceof AiError) return aiFailure(error.message, error.status);
  console.error("[AI] Erro inesperado:", error instanceof Error ? error.message : error);
  return aiFailure("Não foi possível gerar agora. Tente de novo em instantes.", 500);
}

/** Signed-in person who may manage the workspace. Used by the generation and the Settings routes. */
export async function requireAiManager(): Promise<
  { context: WorkspaceContext } | { response: NextResponse }
> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { response: aiFailure("Unauthorized", 401) };
  if (!canManageWorkspace(context.role)) return { response: aiFailure("Forbidden", 403) };
  return { context };
}

/**
 * Checks shared by every generation route: the person may manage the
 * workspace, the AI is configured and on for it, and it is within its limits.
 */
export async function guardAiRequest(): Promise<
  { context: WorkspaceContext; config: ResolvedAiConfig; remaining: number } | { response: NextResponse }
> {
  const manager = await requireAiManager();
  if ("response" in manager) return manager;
  const { context } = manager;

  const config = await resolveAiConfig(context.workspaceId);
  // 404 when off, so a disabled feature looks like it does not exist.
  if (!config) return { response: aiFailure("Not found", 404) };

  try {
    const { remaining } = await assertAiAllowance(context.workspaceId, config);
    return { context, config, remaining };
  } catch (error) {
    return { response: aiErrorResponse(error) };
  }
}
