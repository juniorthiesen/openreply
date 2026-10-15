"use client";

import { useParams } from "next/navigation";
import CampaignBuilder from "@/components/campaign-builder";

// A campaign that runs on Facebook only has no Instagram campaign behind it, so
// it is edited by the id of its Facebook rule.
export default function EditFacebookCampaignPage() {
  const params = useParams<{ id: string }>();
  return <CampaignBuilder mode="edit" facebookRuleId={params.id} />;
}
