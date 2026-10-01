export interface CampaignForOverview {
  id: string;
  name: string;
  postId: string | null;
  isActive: boolean;
  matchAnyPost: boolean;
}

export interface OverviewCampaign {
  id: string;
  name: string;
  isActive: boolean;
  target: "post" | "all";
}

/** Return campaigns that can be triggered by this post, with specific-post
 * campaigns first and active campaigns ahead of paused ones. */
export function getCampaignsForOverviewPost(
  postId: string,
  campaigns: CampaignForOverview[]
): OverviewCampaign[] {
  return campaigns
    .filter((campaign) => campaign.matchAnyPost || campaign.postId === postId)
    .map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      isActive: campaign.isActive,
      target: campaign.matchAnyPost ? ("all" as const) : ("post" as const),
    }))
    .sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) ||
        Number(a.target === "all") - Number(b.target === "all")
    );
}
