import { acquisitionFromSearch } from "@/lib/acquisition";

// Controlled GA4 exports and Meta URL checks, not first-party attribution.
// Keep these public labels in sync with the reviewed launch materials; future
// campaigns are not exported until their exact combinations are added here.
const campaigns: readonly {
  source: string;
  medium: string;
  campaign: string;
  contents: readonly string[];
  term?: string;
  id?: string;
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
    // Meta adds these exact campaign/ad-set IDs to the current landing ad.
    // Accept the reviewed pair together, never arbitrary numeric UTM values.
    source: "instagram", medium: "paid_social", campaign: "bishkek_take6",
    contents: ["take6_landing"], id: "52573740529697", term: "52573740529897",
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
  | "campaign_content" | "campaign_term" | "campaign_id";

export function marketingCampaignOverrides(search: URLSearchParams): Partial<Record<CampaignField, string>> {
  if (["utm_id", "utm_term"].some(key => search.getAll(key).length > 1)) return {};
  const acquisition = acquisitionFromSearch(search);
  if (!acquisition) return {};
  const registered = campaigns.find((entry) =>
    entry.source === acquisition.utm_source &&
    entry.medium === acquisition.utm_medium &&
    entry.campaign === acquisition.utm_campaign &&
    entry.term === acquisition.utm_term &&
    entry.id === (search.get("utm_id") ?? undefined) &&
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
    ...(registered.id ? { campaign_id: registered.id } : {}),
  };
}
