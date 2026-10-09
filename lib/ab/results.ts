import { prisma } from "@/lib/db/client";
import { NOT_AB_VARIANT_LINK } from "@/lib/ab/link-filter";
import { clickRate, summarizeAbTest, type AbSummary } from "@/lib/ab/stats";
import type { AbVariantKey } from "@/lib/ab/variants";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";

/** Link previews and crawlers fetch a link without a person tapping it. */
const AUTOMATED_USER_AGENT = /bot|crawl|spider|preview|facebookexternalhit|meta-external|whatsapp|slack|telegram/i;
const MAX_CLICK_ROWS = 50_000;

export interface AbVariantResult {
  key: AbVariantKey;
  dmMessage: string;
  linkButtonLabel: string | null;
  destinationUrl: string | null;
  /** DMs sent to people who got this variant. */
  sent: number;
  /** Link opens, ignoring link-preview robots. */
  clicks: number;
  /** People who opened the link at least once. */
  clickers: number;
  /** clickers / sent, in percent with one decimal. */
  ratePercent: number;
}

export interface AbTestView {
  id: string;
  status: "RUNNING" | "ENDED";
  weightA: number;
  winnerKey: AbVariantKey | null;
  startedAt: string;
  endedAt: string | null;
  variants: [AbVariantResult, AbVariantResult];
  summary: AbSummary;
}

export interface AbPanelData {
  test: AbTestView | null;
  /** The campaign as it is now, to start variant A from. */
  defaults: {
    dmMessage: string;
    linkButtonLabel: string | null;
    destinationUrl: string | null;
  };
}

async function countClicks(trackedLinkId: string | null): Promise<{ clicks: number; clickers: number }> {
  if (!trackedLinkId) return { clicks: 0, clickers: 0 };
  const rows = await prisma.linkClick.findMany({
    where: { trackedLinkId },
    select: { recipientHash: true, ipHash: true, userAgent: true },
    take: MAX_CLICK_ROWS,
  });
  const people = rows.filter((row) => !(row.userAgent && AUTOMATED_USER_AGENT.test(row.userAgent)));
  const unique = new Set(
    people.map((row, index) =>
      row.recipientHash ? `r:${row.recipientHash}` : row.ipHash ? `i:${row.ipHash}` : `n:${index}`
    )
  );
  return { clicks: people.length, clickers: unique.size };
}

const toPercent = (fraction: number) => Math.round(fraction * 1000) / 10;

/** The latest test of a campaign with its numbers, plus the campaign's current content. Null when the campaign is not found. */
export async function getAbPanelData(workspaceId: string, automationId: string): Promise<AbPanelData | null> {
  const automation = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
    select: {
      dmMessage: true,
      linkButtonLabel: true,
      trackedLinks: {
        where: NOT_AB_VARIANT_LINK,
        orderBy: TRACKED_LINK_ORDER,
        take: 1,
        select: { destinationUrl: true },
      },
    },
  });
  if (!automation) return null;

  const defaults = {
    dmMessage: automation.dmMessage,
    linkButtonLabel: automation.linkButtonLabel,
    destinationUrl: automation.trackedLinks[0]?.destinationUrl ?? null,
  };

  const test = await prisma.abTest.findFirst({
    where: { automationId },
    orderBy: { startedAt: "desc" },
  });
  if (!test) return { test: null, defaults };

  const [sentByVariant, clicksA, clicksB] = await Promise.all([
    prisma.dmLog.groupBy({
      by: ["abVariantKey"],
      where: { abTestId: test.id, status: "SENT" },
      _count: { _all: true },
    }),
    countClicks(test.aTrackedLinkId),
    countClicks(test.bTrackedLinkId),
  ]);
  const sentFor = (key: AbVariantKey) =>
    sentByVariant.find((row) => row.abVariantKey === key)?._count._all ?? 0;

  const build = (
    key: AbVariantKey,
    content: { dmMessage: string; linkButtonLabel: string | null; destinationUrl: string | null },
    clicks: { clicks: number; clickers: number }
  ): AbVariantResult => {
    const sent = sentFor(key);
    return {
      key,
      ...content,
      sent,
      clicks: clicks.clicks,
      clickers: clicks.clickers,
      ratePercent: toPercent(clickRate({ sent, clickers: clicks.clickers })),
    };
  };

  const a = build(
    "A",
    { dmMessage: test.aDmMessage, linkButtonLabel: test.aLinkButtonLabel, destinationUrl: test.aDestinationUrl },
    clicksA
  );
  const b = build(
    "B",
    { dmMessage: test.bDmMessage, linkButtonLabel: test.bLinkButtonLabel, destinationUrl: test.bDestinationUrl },
    clicksB
  );

  return {
    defaults,
    test: {
      id: test.id,
      status: test.status,
      weightA: test.weightA,
      winnerKey: test.winnerKey === "A" || test.winnerKey === "B" ? test.winnerKey : null,
      startedAt: test.startedAt.toISOString(),
      endedAt: test.endedAt?.toISOString() ?? null,
      variants: [a, b],
      summary: summarizeAbTest(
        { sent: a.sent, clickers: a.clickers },
        { sent: b.sent, clickers: b.clickers }
      ),
    },
  };
}
