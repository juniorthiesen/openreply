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

  // Coming from a video on the Facebook screen: start with Facebook on.
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const facebookVideoId = first(params.facebookVideoId) ?? null;
  const startsOnFacebook = first(params.channel) === "facebook" || Boolean(facebookVideoId);

  return (
    <CampaignBuilder
      mode="new"
      initialFacebook={
        startsOnFacebook
          ? {
              videoId: facebookVideoId,
              videoTitle: first(params.facebookVideoTitle) ?? null,
              videoUrl: first(params.facebookVideoUrl) ?? null,
            }
          : undefined
      }
      initialPost={
        typeof instagramAccountId === "string" && typeof postId === "string"
          ? { instagramAccountId, postId, postUrl: postUrl ?? null }
          : undefined
      }
    />
  );
}
