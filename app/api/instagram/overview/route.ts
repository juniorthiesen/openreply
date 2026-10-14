import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import {
  buildInstagramOverview,
  parseOverviewCount,
} from "@/lib/instagram/overview-data";

// The overview itself is built in lib/instagram/overview-data.ts so the MCP
// server reports the same numbers; the types stay importable from here.
export type { OverviewPost, OverviewResponse } from "@/lib/instagram/overview-data";

// Allow time for paginated media + per-post insight calls on larger accounts.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );

  if (!account) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Instagram account not connected. Please connect your account first.",
      },
      { status: 400 }
    );
  }

  try {
    const data = await buildInstagramOverview(
      workspaceId,
      account,
      parseOverviewCount(request.nextUrl.searchParams.get("count"))
    );
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Instagram Overview] Error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to load Instagram overview" },
      { status: 500 }
    );
  }
}
