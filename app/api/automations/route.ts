import { NextRequest, NextResponse } from "next/server";
import { NOT_AB_VARIANT_LINK } from "@/lib/ab/link-filter";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  createCampaign,
  createCampaignSchema,
  updateCampaign,
  updateCampaignSchema,
  type CampaignResult,
} from "@/lib/campaigns/service";
import {
  calculateCtr,
  CLICK_ROW_SELECT,
  countUniqueClicksBy,
  normalizeTopKeywords,
} from "@/lib/tracking/analytics";
import { buildTrackedUrl } from "@/lib/tracking/message";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";
import { buildReportUrl, generateReportShareSlug } from "@/lib/reports/share";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

// This list is read-your-writes (created/imported campaigns must show up
// immediately), so never cache it at the route or CDN layer.
export const dynamic = "force-dynamic";

// The create/update rules live in lib/campaigns/service.ts so the MCP server
// applies exactly the same ones; the handlers below only add auth and parsing.
function failureResponse(result: Extract<CampaignResult<unknown>, { ok: false }>) {
  return NextResponse.json(
    {
      success: false,
      error: result.error,
      ...(result.details ? { details: result.details } : {}),
    },
    { status: result.status }
  );
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  const instagramAccountId =
    request.nextUrl.searchParams.get("instagramAccountId");
  const accountFilter =
    instagramAccountId && instagramAccountId !== "all"
      ? { instagramAccountId }
      : {};

  const automations = await prisma.automation.findMany({
    where: { workspaceId, ...accountFilter },
    include: {
      instagramAccount: {
        select: { username: true, instagramId: true },
      },
      _count: {
        select: { dmLogs: true },
      },
      trackedLinks: {
        // The links of an A/B test variant are not buttons of the campaign.
        where: NOT_AB_VARIANT_LINK,
        select: {
          id: true,
          slug: true,
          label: true,
          destinationUrl: true,
          _count: { select: { clicks: true } },
        },
        orderBy: TRACKED_LINK_ORDER,
      },
      // Lets the list tell that a test is running without a second request.
      abTests: { where: { status: "RUNNING" }, select: { id: true }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  const automationsWithReports = await Promise.all(
    automations.map(async (automation) => {
      if (automation.reportShareSlug) return automation;

      const updated = await prisma.automation.update({
        where: { id: automation.id },
        data: { reportShareSlug: generateReportShareSlug() },
        select: { reportShareSlug: true },
      });

      return {
        ...automation,
        reportShareSlug: updated.reportShareSlug,
      };
    })
  );

  const [statusCounts, clickRows, keywordCounts] = await Promise.all([
    prisma.dmLog.groupBy({
      by: ["automationId", "status"],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.linkClick.findMany({
      where: { workspaceId },
      select: CLICK_ROW_SELECT,
    }),
    prisma.dmLog.groupBy({
      by: ["automationId", "matchedKeyword"],
      where: { workspaceId, matchedKeyword: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const analytics = new Map<
    string,
    {
      sent: number;
      skipped: number;
      failed: number;
      clicks: number;
      topKeywords: { keyword: string; count: number }[];
    }
  >();

  for (const automation of automationsWithReports) {
    analytics.set(automation.id, {
      sent: 0,
      skipped: 0,
      failed: 0,
      clicks: 0,
      topKeywords: [],
    });
  }

  for (const row of statusCounts) {
    const item = analytics.get(row.automationId);
    if (!item) continue;
    const count = row._count._all;
    if (row.status === "SENT") item.sent += count;
    if (row.status === "FAILED") item.failed += count;
    if (row.status.startsWith("SKIPPED_")) item.skipped += count;
  }

  const clickCounts = countUniqueClicksBy(clickRows, (row) => row.automationId);
  for (const [automationId, clicks] of clickCounts) {
    const item = analytics.get(automationId);
    if (item) item.clicks = clicks;
  }

  for (const automation of automationsWithReports) {
    const item = analytics.get(automation.id);
    if (!item) continue;
    item.topKeywords = normalizeTopKeywords(
      keywordCounts
        .filter((row) => row.automationId === automation.id)
        .map((row) => ({
          matchedKeyword: row.matchedKeyword,
          _count: row._count._all,
        })),
      3
    );
  }

  return NextResponse.json(
    {
    success: true,
    data: automationsWithReports.map((automation) => {
      const item = analytics.get(automation.id) ?? {
        sent: 0,
        skipped: 0,
        failed: 0,
        clicks: 0,
        topKeywords: [],
      };

      return {
        ...automation,
        trackedLinks: automation.trackedLinks.map((link) => ({
          ...link,
          trackedUrl: buildTrackedUrl(link.slug),
        })),
        reportUrl: automation.reportShareSlug
          ? buildReportUrl(automation.reportShareSlug)
          : null,
        analytics: {
          ...item,
          ctr: calculateCtr(item.clicks, item.sent),
        },
      };
    }),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

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
      { success: false, error: "Only owners and admins can create campaigns" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = createCampaignSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid input",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const result = await createCampaign(context.workspaceId, parsed.data);
  if (!result.ok) return failureResponse(result);

  return NextResponse.json({ success: true, data: result.data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can update campaigns" },
      { status: 403 }
    );
  }

  const automationId = request.nextUrl.searchParams.get("id");
  if (!automationId) {
    return NextResponse.json(
      { success: false, error: "Missing campaign ID" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = updateCampaignSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid input",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const result = await updateCampaign(context.workspaceId, automationId, parsed.data);
  if (!result.ok) return failureResponse(result);

  return NextResponse.json({ success: true, data: result.data });
}

export async function DELETE(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can delete campaigns" },
      { status: 403 }
    );
  }

  const workspaceId = context.workspaceId;

  const automationId = request.nextUrl.searchParams.get("id");
  if (!automationId) {
    return NextResponse.json(
      { success: false, error: "Missing campaign ID" },
      { status: 400 }
    );
  }

  const existing = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
  });

  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Campaign not found" },
      { status: 404 }
    );
  }

  await prisma.automation.delete({ where: { id: automationId } });

  return NextResponse.json({ success: true, data: { deleted: true } });
}
