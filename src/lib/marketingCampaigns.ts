import { acquisitionFromSearch } from "@/lib/acquisition";

// GA4 export only. This registry does not restrict first-party attribution.
// Keep these public labels in sync with the reviewed launch materials; future
// campaigns are not exported until their exact combinations are added here.
const campaigns: readonly {
  source: string;
  medium: string;
  campaign: string;
  contents: readonly string[];
  term?: string;
}[] = [
  {
    source: "instagram", medium: "organic_social", campaign: "profile",
    contents: ["bio", "highlight_start"],
  },
  {
    source: "facebook", medium: "organic_social", campaign: "profile",
    contents: ["page"],
  },
  {
    source: "instagram", medium: "paid_social", campaign: "bishkek_take6",
    contents: ["take6_signup", "take6_landing"],
  },
  {
    source: "instagram", medium: "paid_social", campaign: "kg_store_launch_202611",
    contents: ["ad01_ru", "ad02_ru", "ad01_ru_direct", "ad02_ru_direct"],
  },
  ...["inventory", "pos", "retail"].map((term) => ({
    source: "google", medium: "cpc", campaign: "kg_store_launch_202611", term,
    contents: [`search_${term}_a`, `search_${term}_b`],
  })),
];

type CampaignField =
  | "campaign_source" | "campaign_medium" | "campaign_name"
  | "campaign_content" | "campaign_term";

export function marketingCampaignOverrides(search: URLSearchParams): Partial<Record<CampaignField, string>> {
  const acquisition = acquisitionFromSearch(search);
  if (!acquisition) return {};
  const registered = campaigns.find((entry) =>
    entry.source === acquisition.utm_source &&
    entry.medium === acquisition.utm_medium &&
    entry.campaign === acquisition.utm_campaign &&
    entry.term === acquisition.utm_term &&
    entry.contents.includes(acquisition.utm_content ?? ""));
  if (!registered) return {};
  // Export only values from the controlled registry, never arbitrary URL values.
  const content = registered.contents.find((value) => value === acquisition.utm_content)!;
  return {
    campaign_source: registered.source,
    campaign_medium: registered.medium,
    campaign_name: registered.campaign,
    campaign_content: content,
    ...(registered.term ? { campaign_term: registered.term } : {}),
  };
}
