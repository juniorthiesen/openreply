import { resolveAiConfig } from "@/lib/ai/config";
import { aiFailure, aiJson } from "@/lib/ai/route-guard";
import { countMonthlyGenerations } from "@/lib/ai/usage";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Tells the app whether to show the AI assistant, and how much of the month is left. */
export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return aiFailure("Unauthorized", 401);

  const config = canManageWorkspace(context.role) ? await resolveAiConfig(context.workspaceId) : null;
  if (!config) return aiJson({ success: true, data: { enabled: false } });

  const used = await countMonthlyGenerations(context.workspaceId);
  return aiJson({
    success: true,
    data: { enabled: true, remaining: Math.max(0, config.monthlyLimit - used), limit: config.monthlyLimit },
  });
}
