import CampaignBuilder from "@/components/campaign-builder";

interface NewCampaignPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewCampaignPage({
  searchParams,
}: NewCampaignPageProps) {
  const params = await searchParams;
  const instagramAccountId = params.instagramAccountId;
  const postId = params.postId;
  const rawPostUrl = params.postUrl;
  const postUrl = Array.isArray(rawPostUrl) ? rawPostUrl[0] : rawPostUrl;

  return (
    <CampaignBuilder
      mode="new"
      initialPost={
        typeof instagramAccountId === "string" && typeof postId === "string"
          ? { instagramAccountId, postId, postUrl: postUrl ?? null }
          : undefined
      }
    />
  );
}
