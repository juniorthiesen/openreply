import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getFacebookPageVideos } from "@/lib/facebook/page-api";
import { PermissionError, TokenExpiredError } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";

const VIDEO_LIMIT = 50;

/**
 * The connected Pages and one Page's recent videos, for the campaign builder's
 * picker. Metrics are left out on purpose: they cost a Graph call per video,
 * and a picker only needs to recognise the video.
 */
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const pages = await prisma.facebookPage.findMany({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
    select: { id: true, name: true, webhookSubscribed: true },
  });
  if (pages.length === 0) {
    return NextResponse.json({ success: true, data: { pages: [], videos: [] } });
  }

  const requested = request.nextUrl.searchParams.get("pageId");
  const selected = pages.find((page) => page.id === requested) ?? pages[0];
  // The builder asks for the Pages alone until Facebook is switched on, so a
  // campaign made only for Instagram never pays for a Graph call here.
  if (request.nextUrl.searchParams.get("videos") === "0") {
    return NextResponse.json({
      success: true,
      data: { pages, selectedPageId: selected.id, videos: [] },
    });
  }

  const page = await prisma.facebookPage.findUnique({
    where: { id: selected.id },
    select: { facebookPageId: true, accessToken: true },
  });
  if (!page) {
    return NextResponse.json({ success: true, data: { pages, videos: [] } });
  }

  try {
    const videos = await getFacebookPageVideos(
      decryptToken(page.accessToken),
      page.facebookPageId,
      VIDEO_LIMIT
    );
    return NextResponse.json({
      success: true,
      data: {
        pages,
        selectedPageId: selected.id,
        videos: videos.map((video) => ({
          id: video.id,
          title: video.title ?? video.description,
          createdTime: video.createdTime,
          permalinkUrl: video.permalinkUrl,
          thumbnailUrl: video.thumbnailUrl,
          isReel: video.isReel,
          comments: video.comments,
        })),
      },
    });
  } catch (error) {
    const message =
      error instanceof TokenExpiredError
        ? "O acesso da Página expirou. Reconecte o Facebook em Configurações."
        : error instanceof PermissionError
          ? "O Facebook negou a leitura dos vídeos. Reconecte o Facebook em Configurações."
          : "Não foi possível carregar os vídeos do Facebook agora.";
    // The Pages are still returned: the person can pick "any video" without a list.
    return NextResponse.json({
      success: true,
      data: { pages, selectedPageId: selected.id, videos: [], videosError: message },
    });
  }
}
