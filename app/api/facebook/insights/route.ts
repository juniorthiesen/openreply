import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  FACEBOOK_FEATURE_SCOPES,
  getFacebookPageInsights,
  getFacebookPageSummary,
  getFacebookPageVideos,
  getFacebookVideoInsights,
  getPageTokenScopes,
  mapWithConcurrency,
  missingScopes,
  type FacebookPageInsights,
  type FacebookPageSummary,
  type FacebookVideo,
} from "@/lib/facebook/page-api";
import { facebookObjectId } from "@/lib/facebook/comment-events";
import { MetaApiError, PermissionError, TokenExpiredError } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";

export interface FacebookVideoRow extends FacebookVideo {
  /** Active comment rules bound to this video. */
  activeRules: number;
}

export interface FacebookInsightsResponse {
  page: { id: string; name: string; webhookSubscribed: boolean; webhookError: string | null };
  summary: FacebookPageSummary | null;
  insights: FacebookPageInsights | null;
  videos: FacebookVideoRow[];
  /** Permissions the metrics screen needs and the Page token lacks. */
  missingMetricScopes: string[];
  missingReplyScopes: string[];
}

const VIDEO_LIMIT = 25;

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const pageParam = request.nextUrl.searchParams.get("pageId");
  const page = await prisma.facebookPage.findFirst({
    where: { workspaceId, ...(pageParam ? { id: pageParam } : {}) },
    orderBy: { connectedAt: "desc" },
  });
  if (!page) {
    return NextResponse.json(
      { success: false, error: "Conecte uma Página do Facebook em Configurações.", code: "no_page" },
      { status: 404 }
    );
  }

  const token = decryptToken(page.accessToken);

  try {
    const [summary, insights, videos, scopes, rules] = await Promise.all([
      getFacebookPageSummary(token, page.facebookPageId).catch((error) => {
        if (error instanceof TokenExpiredError) throw error;
        return null;
      }),
      getFacebookPageInsights(token, page.facebookPageId),
      getFacebookPageVideos(token, page.facebookPageId, VIDEO_LIMIT),
      getPageTokenScopes(token),
      prisma.facebookAutomation.findMany({
        where: { facebookPageId: page.id, isActive: true },
        select: { videoId: true },
      }),
    ]);

    const rulesByVideo = new Map<string, number>();
    for (const rule of rules) {
      if (!rule.videoId) continue;
      const key = facebookObjectId(rule.videoId);
      rulesByVideo.set(key, (rulesByVideo.get(key) ?? 0) + 1);
    }

    const rows = await mapWithConcurrency(videos, 5, async (video): Promise<FacebookVideoRow> => {
      const videoInsights = await getFacebookVideoInsights(token, video.id).catch((error) => {
        if (error instanceof TokenExpiredError) throw error;
        return { impressions: null, reach: null, reactions: null };
      });
      return {
        ...video,
        ...videoInsights,
        activeRules: rulesByVideo.get(facebookObjectId(video.id)) ?? 0,
      };
    });

    const body: FacebookInsightsResponse = {
      page: {
        id: page.id,
        name: page.name,
        webhookSubscribed: page.webhookSubscribed,
        webhookError: page.webhookError,
      },
      summary,
      insights,
      videos: rows,
      missingMetricScopes: missingScopes(scopes, FACEBOOK_FEATURE_SCOPES.metrics),
      missingReplyScopes: missingScopes(scopes, FACEBOOK_FEATURE_SCOPES.commentReplies),
    };
    return NextResponse.json({ success: true, data: body });
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      return NextResponse.json(
        {
          success: false,
          code: "token_expired",
          error: "O acesso da Página expirou. Reconecte o Facebook em Configurações.",
        },
        { status: 409 }
      );
    }
    if (error instanceof PermissionError) {
      return NextResponse.json(
        {
          success: false,
          code: "permission",
          error:
            "O Facebook negou a leitura da Página. Reconecte e aceite todas as permissões pedidas.",
          detail: error.message,
        },
        { status: 403 }
      );
    }
    console.error("[Facebook Insights] Failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Não foi possível ler os dados do Facebook agora.",
        detail: error instanceof MetaApiError || error instanceof Error ? error.message : undefined,
      },
      { status: 502 }
    );
  }
}
