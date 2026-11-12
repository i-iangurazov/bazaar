import { describe, expect, it } from "vitest";
import { acquisitionFromSearch } from "@/lib/acquisition";
import { marketingCampaignOverrides } from "@/lib/marketingCampaigns";

const labels = (content: string, term?: string) => new URLSearchParams({
  utm_source: term ? "google" : "instagram",
  utm_medium: term ? "cpc" : "paid_social",
  utm_campaign: "kg_store_launch_202611",
  utm_content: content,
  ...(term ? { utm_term: term } : {}),
});

describe("controlled GA4 campaign export", () => {
  it.each(["take6_signup", "take6_landing"])("exports the reviewed Take 6 destination %s", content => {
    expect(marketingCampaignOverrides(new URLSearchParams({
      utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "bishkek_take6", utm_content: content,
    }))).toEqual({
      campaign_source: "instagram", campaign_medium: "paid_social", campaign_name: "bishkek_take6", campaign_content: content,
    });
  });

  it.each(["bio", "highlight_start"])("exports the approved organic profile link %s", (content) => {
    expect(marketingCampaignOverrides(new URLSearchParams({
      utm_source: "instagram", utm_medium: "organic_social",
      utm_campaign: "profile", utm_content: content,
    }))).toEqual({
      campaign_source: "instagram", campaign_medium: "organic_social",
      campaign_name: "profile", campaign_content: content,
    });
  });

  it("exports exactly the approved Facebook Page website link", () => {
    expect(marketingCampaignOverrides(new URLSearchParams({
      utm_source: "facebook", utm_medium: "organic_social",
      utm_campaign: "profile", utm_content: "page",
    }))).toEqual({
      campaign_source: "facebook", campaign_medium: "organic_social",
      campaign_name: "profile", campaign_content: "page",
    });
  });

  it.each([
    ["utm_content", "bio"], ["utm_source", "instagram"],
    ["utm_medium", "paid_social"], ["utm_term", "inventory"],
  ])("rejects an unapproved Facebook Page variation %s=%s", (key, value) => {
    const search = new URLSearchParams({
      utm_source: "facebook", utm_medium: "organic_social", utm_campaign: "profile", utm_content: "page",
    });
    search.set(key, value);
    expect(marketingCampaignOverrides(search)).toEqual({});
  });

  it.each(["ad01_ru", "ad02_ru", "ad01_ru_direct", "ad02_ru_direct"])("exports only the approved Meta creative %s", (content) => {
    expect(marketingCampaignOverrides(labels(content))).toEqual({
      campaign_source: "instagram", campaign_medium: "paid_social",
      campaign_name: "kg_store_launch_202611", campaign_content: content,
    });
  });

  it.each([
    ["inventory", "search_inventory_a"], ["inventory", "search_inventory_b"],
    ["pos", "search_pos_a"], ["pos", "search_pos_b"],
    ["retail", "search_retail_a"], ["retail", "search_retail_b"],
  ])("keeps the Search group %s bound to its creative %s", (term, content) => {
    expect(marketingCampaignOverrides(labels(content, term))).toEqual({
      campaign_source: "google", campaign_medium: "cpc",
      campaign_name: "kg_store_launch_202611", campaign_content: content, campaign_term: term,
    });
  });

  it.each([
    ["utm_source", "private_person"], ["utm_medium", "unknown"],
    ["utm_campaign", "unreviewed_launch"], ["utm_content", "unreviewed_creative"],
    ["utm_term", "996700000000"], ["utm_term", "person_name"],
  ])("rejects unregistered %s=%s even when first-party syntax permits it", (key, value) => {
    const search = labels("ad01_ru");
    search.set(key, value);
    expect(acquisitionFromSearch(search)).toBeDefined();
    expect(marketingCampaignOverrides(search)).toEqual({});
  });

  it("rejects mismatched or missing Search terms rather than classifying another group", () => {
    expect(marketingCampaignOverrides(labels("search_inventory_a", "pos"))).toEqual({});
    const search = labels("search_inventory_a", "inventory");
    search.delete("utm_term");
    expect(marketingCampaignOverrides(search)).toEqual({});
    search.set("utm_term", "{keyword}");
    expect(marketingCampaignOverrides(search)).toEqual({});
  });

  it("exports no raw query, click IDs or unrelated personal values with an otherwise approved campaign", () => {
    const search = labels("ad02_ru");
    search.set("email", "private@example.invalid");
    search.set("phone", "996700000000");
    search.set("gclid", "private-click-id");
    search.set("fbclid", "another-private-id");
    const exported = marketingCampaignOverrides(search);
    expect(Object.keys(exported).sort()).toEqual([
      "campaign_content", "campaign_medium", "campaign_name", "campaign_source",
    ]);
    expect(JSON.stringify(exported)).not.toMatch(/private|996700000000|gclid|fbclid|capturedAt|utm_/);
    expect(marketingCampaignOverrides(new URLSearchParams())).toEqual({});
  });
});
