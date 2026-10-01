import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import {
  exchangeFacebookCodeForToken,
  getFacebookManagedPages,
  toFacebookPageCandidate,
} from "@/lib/meta/client";
import { encryptToken, verifyOAuthState } from "@/lib/meta/oauth";
import { canManageWorkspace } from "@/lib/workspace-access";
import { Prisma } from "@/app/generated/prisma/client";

const PICKER_TTL_MS = 10 * 60 * 1000;

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl();
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state"));

  if (error) return NextResponse.redirect(`${baseUrl}/settings?facebook=denied`);
  if (!code || !state || state.provider !== "facebook") {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=invalid`);
  }

  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(`${baseUrl}/login`);

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: state.workspaceId, userId: session.user.id },
  });
  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=forbidden`);
  }

  try {
    const { accessToken } = await exchangeFacebookCodeForToken(
      code,
      `${baseUrl}/api/facebook/callback`
    );
    const pages = await getFacebookManagedPages(accessToken);
    if (!pages.length) {
      return NextResponse.redirect(`${baseUrl}/settings?facebook=no_pages`);
    }

    await prisma.facebookOAuthConnection.deleteMany({
      where: { workspaceId: state.workspaceId, expiresAt: { lt: new Date() } },
    });
    const connection = await prisma.facebookOAuthConnection.create({
      data: {
        workspaceId: state.workspaceId,
        accessToken: encryptToken(accessToken),
        pages: pages.map(toFacebookPageCandidate) as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + PICKER_TTL_MS),
      },
    });

    return NextResponse.redirect(
      `${baseUrl}/settings?facebook=pick_page&connection=${connection.id}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Facebook Callback] Error:", error);
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "ERROR",
          workspaceId: state.workspaceId,
          message: "Facebook connection failed",
          payload: { reason: message },
        },
      })
      .catch(() => {});
    return NextResponse.redirect(`${baseUrl}/settings?facebook=failed`);
  }
}
