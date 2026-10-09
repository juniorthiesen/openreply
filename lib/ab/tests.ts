import { prisma } from "@/lib/db/client";
import { NOT_AB_VARIANT_LINK } from "@/lib/ab/link-filter";
import { clampWeightA, withUtmParams } from "@/lib/ab/variants";
import { syncCampaignLinks } from "@/lib/campaigns/links";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";

/** An error whose message is safe to show to the user (Portuguese). */
export class AbTestError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = "AbTestError";
  }
}

export interface StartAbTestInput {
  workspaceId: string;
  automationId: string;
  /** Percent of people who get A. Clamped to 10 to 90. */
  weightA: number;
  /** Needed only when the campaign has no link of its own to use as variant A. */
  aDestinationUrl?: string | null;
  b: {
    dmMessage: string;
    linkButtonLabel: string | null;
    destinationUrl: string;
  };
}

const comparableUrl = (url: string) => url.trim().replace(/\/+$/, "").toLowerCase();

/**
 * Start a test. Variant A is the campaign exactly as it is now; B is the
 * change. Each variant gets its own tracked link, so a click is counted for
 * the variant that sent it and nothing else.
 */
export async function startAbTest(input: StartAbTestInput) {
  const { workspaceId, automationId } = input;

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
    select: {
      id: true,
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
  if (!automation) throw new AbTestError("Campanha não encontrada.", 404);

  const running = await prisma.abTest.findFirst({
    where: { automationId, status: "RUNNING" },
    select: { id: true },
  });
  if (running) throw new AbTestError("Já existe um teste A/B em andamento nesta campanha. Encerre-o antes de criar outro.", 409);

  const aUrl = automation.trackedLinks[0]?.destinationUrl ?? input.aDestinationUrl?.trim() ?? "";
  if (!aUrl) {
    throw new AbTestError("Esta campanha não tem link. Informe o link da variante A para poder medir os cliques.");
  }

  const bLabel = input.b.linkButtonLabel?.trim() || null;
  const identical =
    automation.dmMessage.trim() === input.b.dmMessage.trim() &&
    (automation.linkButtonLabel ?? "") === (bLabel ?? "") &&
    comparableUrl(aUrl) === comparableUrl(input.b.destinationUrl);
  if (identical) {
    throw new AbTestError("As duas variantes são iguais. Mude a mensagem, o botão ou o link da variante B.");
  }

  return prisma.$transaction(async (tx) => {
    const linkA = await tx.trackedLink.create({
      data: {
        workspaceId,
        automationId,
        slug: generateTrackedLinkSlug(),
        label: "Teste A/B: variante A",
        destinationUrl: withUtmParams(aUrl, "A", automationId),
        position: 90,
      },
      select: { id: true },
    });
    const linkB = await tx.trackedLink.create({
      data: {
        workspaceId,
        automationId,
        slug: generateTrackedLinkSlug(),
        label: "Teste A/B: variante B",
        destinationUrl: withUtmParams(input.b.destinationUrl, "B", automationId),
        position: 91,
      },
      select: { id: true },
    });

    return tx.abTest.create({
      data: {
        automationId,
        weightA: clampWeightA(input.weightA),
        aDmMessage: automation.dmMessage,
        aLinkButtonLabel: automation.linkButtonLabel,
        aDestinationUrl: aUrl,
        aTrackedLinkId: linkA.id,
        bDmMessage: input.b.dmMessage.trim(),
        bLinkButtonLabel: bLabel,
        bDestinationUrl: input.b.destinationUrl.trim(),
        bTrackedLinkId: linkB.id,
      },
    });
  });
}

/**
 * End the running test. With a winner, that variant's message, button label and
 * link become the campaign's own and the other one is dropped. Without one, the
 * campaign stays as it was. Either way the numbers stay for review.
 */
export async function endAbTest(input: {
  workspaceId: string;
  automationId: string;
  winner: "A" | "B" | null;
}) {
  const { workspaceId, automationId, winner } = input;

  const test = await prisma.abTest.findFirst({
    where: { automationId, status: "RUNNING", automation: { workspaceId } },
  });
  if (!test) throw new AbTestError("Não há teste A/B em andamento nesta campanha.", 404);

  return prisma.$transaction(async (tx) => {
    const ended = await tx.abTest.update({
      where: { id: test.id },
      data: { status: "ENDED", endedAt: new Date(), winnerKey: winner },
    });

    if (winner) {
      const isA = winner === "A";
      const winningUrl = isA ? test.aDestinationUrl : test.bDestinationUrl;
      await tx.automation.update({
        where: { id: automationId },
        data: {
          dmMessage: isA ? test.aDmMessage : test.bDmMessage,
          linkButtonLabel: isA ? test.aLinkButtonLabel : test.bLinkButtonLabel,
        },
      });
      if (winningUrl) {
        await syncCampaignLinks(tx, { workspaceId, automationId, primaryUrl: winningUrl });
      }
    }

    return ended;
  });
}
