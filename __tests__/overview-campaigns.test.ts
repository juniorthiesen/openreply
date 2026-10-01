import { describe, expect, it } from "vitest";
import { getCampaignsForOverviewPost } from "../lib/overview-campaigns";

describe("getCampaignsForOverviewPost", () => {
  it("returns campaigns for the post and active campaigns targeting every post", () => {
    const campaigns = getCampaignsForOverviewPost("post-1", [
      {
        id: "other-post",
        name: "Outra publicação",
        postId: "post-2",
        isActive: true,
        matchAnyPost: false,
      },
      {
        id: "global",
        name: "Todos os posts",
        postId: null,
        isActive: true,
        matchAnyPost: true,
      },
      {
        id: "specific",
        name: "Este post",
        postId: "post-1",
        isActive: false,
        matchAnyPost: false,
      },
    ]);

    expect(campaigns).toEqual([
      { id: "global", name: "Todos os posts", isActive: true, target: "all" },
      { id: "specific", name: "Este post", isActive: false, target: "post" },
    ]);
  });

  it("does not include campaigns waiting for the next post or reel", () => {
    expect(
      getCampaignsForOverviewPost("post-1", [
        {
          id: "next",
          name: "Próximo reel",
          postId: null,
          isActive: true,
          matchAnyPost: false,
        },
      ])
    ).toEqual([]);
  });
});
