import { prisma } from "@/lib/db/client";
import { getFacebookPageInstagramAccount } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";

/** Resolve the Facebook Page whose professional Instagram account matches this workspace account. */
export async function resolveStoryPublishingPage(workspaceId: string, instagramAccountId: string) {
  const account = await prisma.instagramAccount.findFirst({
    where: { id: instagramAccountId, workspaceId },
    select: { id: true, instagramId: true, facebookPageId: true },
  });
  if (!account) return null;

  if (account.facebookPageId) {
    const linkedPage = await prisma.facebookPage.findFirst({
      where: { workspaceId, facebookPageId: account.facebookPageId },
    });
    if (linkedPage) return linkedPage;
  }

  const pages = await prisma.facebookPage.findMany({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
    take: 100,
  });
  for (const page of pages) {
    try {
      const pageToken = decryptToken(page.accessToken);
      const linkedInstagram = await getFacebookPageInstagramAccount(pageToken, page.facebookPageId);
      if (linkedInstagram?.id !== account.instagramId) continue;

      await prisma.instagramAccount.updateMany({
        where: { id: account.id, workspaceId },
        data: { facebookPageId: page.facebookPageId },
      });
      return page;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Meta API error";
      console.warn(`[Stories] Could not check linked Instagram account for Page ${page.facebookPageId}: ${message.slice(0, 200)}`);
    }
  }
  return null;
}
