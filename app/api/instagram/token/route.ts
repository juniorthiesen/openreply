import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import {
  getUserInfo,
  MetaApiError,
  subscribeInstagramAccountToWebhooks,
  type InstagramUser,
} from "@/lib/meta/client";
import { encryptToken } from "@/lib/meta/oauth";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

const MAX_TOKEN_LENGTH = 4096;

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Forbidden" },
      { status: 403 }
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_TOKEN_LENGTH + 128) {
    return NextResponse.json(
      { success: false, error: "Token inválido." },
      { status: 413 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const accessToken =
    typeof body.token === "string" ? body.token.trim() : "";
  if (accessToken.length < 20 || accessToken.length > MAX_TOKEN_LENGTH) {
    return NextResponse.json(
      { success: false, error: "Informe um token de acesso válido." },
      { status: 400 }
    );
  }

  let userInfo: InstagramUser;
  try {
    // Validate the pasted token directly. This path intentionally skips the
    // OAuth code and long-lived-token exchange that the Meta app is rejecting.
    userInfo = await getUserInfo(accessToken);
  } catch (error) {
    const message =
      error instanceof MetaApiError
        ? `A Meta recusou esse token: ${error.message}`
        : "Não foi possível validar esse token. Confirme que ele pertence à conta profissional e ao app da Meta usados pelo OpenReply.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  const instagramId = userInfo.user_id ?? userInfo.id;
  if (!instagramId || !userInfo.username) {
    return NextResponse.json(
      {
        success: false,
        error: "A Meta não retornou um perfil profissional válido para esse token.",
      },
      { status: 400 }
    );
  }

  const connection = await canConnectInstagramAccount({
    workspaceId: context.workspaceId,
    instagramId,
  });
  if (!connection.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Esse perfil já está conectado a outro espaço de trabalho.",
      },
      { status: 409 }
    );
  }

  let webhookSubscribed = false;
  try {
    const subscription = await subscribeInstagramAccountToWebhooks(
      instagramId,
      accessToken
    );
    webhookSubscribed = Boolean(subscription.success);
  } catch {
    // Keep the valid account connection even if Meta declines webhook setup.
  }

  const encryptedToken = encryptToken(accessToken);
  await prisma.instagramAccount.upsert({
    where: { instagramId },
    create: {
      workspaceId: context.workspaceId,
      instagramId,
      username: userInfo.username,
      name: userInfo.name,
      accessToken: encryptedToken,
      tokenExpiresAt: null,
      webhookSubscribed,
      authProvider: "INSTAGRAM_LOGIN",
      publishingPermissionGranted: true,
    },
    update: {
      workspaceId: context.workspaceId,
      username: userInfo.username,
      name: userInfo.name,
      accessToken: encryptedToken,
      tokenExpiresAt: null,
      webhookSubscribed,
      authProvider: "INSTAGRAM_LOGIN",
      publishingPermissionGranted: true,
    },
  });

  return NextResponse.json({
    success: true,
    data: { username: userInfo.username },
  });
}
