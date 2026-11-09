import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import messages from "../../messages/ru.json";

const state = vi.hoisted(() => ({
  data: null as null | {
    billingCatalogVersion: string;
    lifetimeAccess: boolean;
    featureFlags: { marketplaces: boolean };
    selectedMarketplaceChannel: string | null;
  },
}));
vi.mock("@/lib/trpc", () => ({ trpc: { billing: { features: { useQuery: () => state } } } }));
vi.mock("next-intl", () => ({
  useTranslations: (scope: string) => {
    const catalog: Record<string, unknown> =
      scope === "errors" ? messages.errors : messages.billing.marketplace;
    return Object.assign(
      (key: string, values?: Record<string, string>) => {
        const entry = catalog[key];
        let value = typeof entry === "string" ? entry : key;
        for (const [name, replacement] of Object.entries(values ?? {}))
          value = value.replace(`{${name}}`, replacement);
        return value;
      },
      { has: (key: string) => Object.hasOwn(catalog, key) },
    );
  },
}));
import {
  MarketplacePlanNotice,
  MarketplaceSubscriptionFailure,
} from "@/components/billing/marketplace-plan-notice";

describe("marketplace allowance explanation", () => {
  beforeEach(() => {
    state.data = null;
  });
  it("does not imply a restriction before the account's terms are known", () => {
    expect(renderToStaticMarkup(<MarketplacePlanNotice />)).toBe("");
  });
  it("does not advertise new limits to existing or lifetime-free accounts", () => {
    state.data = {
      billingCatalogVersion: "2026-10",
      lifetimeAccess: false,
      featureFlags: { marketplaces: true },
      selectedMarketplaceChannel: null,
    };
    expect(renderToStaticMarkup(<MarketplacePlanNotice />)).toBe("");
    state.data.billingCatalogVersion = "2026-11";
    state.data.lifetimeAccess = true;
    expect(renderToStaticMarkup(<MarketplacePlanNotice />)).toBe("");
  });
  it("clearly distinguishes the Business XLSX file from live exchange", () => {
    state.data = {
      billingCatalogVersion: "2026-11",
      lifetimeAccess: false,
      featureFlags: { marketplaces: false },
      selectedMarketplaceChannel: null,
    };
    const view = renderToStaticMarkup(<MarketplacePlanNotice />);
    expect(view).toContain("выгрузку файла Bakai Store XLSX");
    expect(view).toContain("Живой обмен через API доступен в Монополисте");
    expect(view).not.toContain("24 запусков");
  });
  it("shows the selected provider and the shared daily ceilings", () => {
    state.data = {
      billingCatalogVersion: "2026-11",
      lifetimeAccess: false,
      featureFlags: { marketplaces: true },
      selectedMarketplaceChannel: "BAKAI",
    };
    const view = renderToStaticMarkup(<MarketplacePlanNotice />);
    expect(view).toContain("Bakai Store API");
    expect(view).toContain("24 запусков обмена в сутки");
    expect(view).toContain("не более одной полной выгрузки");
    expect(view).toContain("дождитесь завершения его заданий");
  });
  it("shows the localized allowance failure in both provider report shapes", () => {
    for (const report of [
      { reason: "billingUsageLimitReached" },
      { error: { code: "NETWORK_API_ERROR", message: "billingUsageLimitReached" } },
    ]) {
      const view = renderToStaticMarkup(<MarketplaceSubscriptionFailure report={report} />);
      expect(view).toContain(messages.errors.billingUsageLimitReached);
      expect(view).not.toContain("NETWORK_API_ERROR");
    }
  });
  it("does not expose arbitrary provider text as a subscription failure", () => {
    for (const report of [
      null,
      { reason: "unknown-provider-error" },
      { error: { message: "secret" } },
    ])
      expect(renderToStaticMarkup(<MarketplaceSubscriptionFailure report={report} />)).toBe("");
  });
});
