import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { generateApiToken } from "@/lib/mcp/tokens";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

// A workspace rarely needs more than a handful; the cap keeps a runaway script
// from filling the table.
const MAX_ACTIVE_TOKENS = 20;

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(["READ", "WRITE"]),
});

async function requireManager() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return { error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }
  // A token acts for the whole workspace, so only people who can manage it may
  // issue or revoke one.
  if (!canManageWorkspace(context.role)) {
    return {
      error: NextResponse.json(
        { success: false, error: "Apenas proprietários e administradores gerenciam tokens." },
        { status: 403 }
      ),
    };
  }
  return { context };
}

export async function GET() {
  const { context, error } = await requireManager();
  if (!context) return error;

  const tokens = await prisma.apiToken.findMany({
    where: { workspaceId: context.workspaceId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      scope: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ success: true, data: { tokens } });
}

export async function POST(request: NextRequest) {
  const { context, error } = await requireManager();
  if (!context) return error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Informe um nome e o tipo de acesso." },
      { status: 400 }
    );
  }

  const active = await prisma.apiToken.count({
    where: { workspaceId: context.workspaceId, revokedAt: null },
  });
  if (active >= MAX_ACTIVE_TOKENS) {
    return NextResponse.json(
      { success: false, error: "Limite de tokens atingido. Revogue algum antes de criar outro." },
      { status: 409 }
    );
  }

  const { token, tokenHash, tokenPrefix } = generateApiToken();
  const created = await prisma.apiToken.create({
    data: {
      workspaceId: context.workspaceId,
      createdById: context.userId,
      name: parsed.data.name,
      scope: parsed.data.scope,
      tokenHash,
      tokenPrefix,
    },
    select: { id: true, name: true, tokenPrefix: true, scope: true, createdAt: true },
  });

  // The only time the plain token exists outside the caller's clipboard.
  return NextResponse.json(
    { success: true, data: { token: created, secret: token } },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(request: NextRequest) {
  const { context, error } = await requireManager();
  if (!context) return error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: "id é obrigatório" }, { status: 400 });

  const result = await prisma.apiToken.updateMany({
    where: { id, workspaceId: context.workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count !== 1) {
    return NextResponse.json({ success: false, error: "Token não encontrado." }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
