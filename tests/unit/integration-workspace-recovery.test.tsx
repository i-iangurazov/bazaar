// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "ADMIN",
  failed: "",
  emptyStores: false,
  retries: [] as string[],
  queries: [] as Array<{ path: string; enabled: boolean }>,
  mutate: vi.fn(),
  stores: [{ id: "assigned-store", name: "Assigned store", code: "QA" }],
  catalogStores: [
    {
      storeId: "assigned-store",
      storeName: "Assigned store",
      status: "NOT_CONFIGURED",
      activeKeyCount: 0,
    },
  ],
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("storeId=assigned-store"),
  usePathname: () => "/operations/integrations",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "viewer", role: state.role, organizationId: "org" } },
    status: "authenticated",
  }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (ns: string) =>
    Object.assign((key: string) => ns + "." + key, { has: () => true }),
}));
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title, action }: { title: string; action?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {action}
    </header>
  ),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/trpc", () => {
  const paths = [
    "bakaiStore.apiSyncNow",
    "bakaiStore.apiSyncReadyNow",
    "bakaiStore.exportNow",
    "bakaiStore.exportReadyNow",
    "bakaiStore.jobs",
    "bakaiStore.overview",
    "bakaiStore.preflight",
    "bakaiStore.products",
    "bakaiStore.revealToken",
    "bakaiStore.saveBranchMappings",
    "bakaiStore.saveMappings",
    "bakaiStore.saveSettings",
    "bakaiStore.settings",
    "bakaiStore.startDescriptionGenerationJob",
    "bakaiStore.testConnection",
    "bakaiStore.updateProducts",
    "bazaarApi.apiKeys",
    "bazaarApi.createApiKey",
    "bazaarApi.listStores",
    "bazaarApi.revokeApiKey",
    "bazaarCatalog.getSettings",
    "bazaarCatalog.listStores",
    "bazaarCatalog.products",
    "bazaarCatalog.updateProducts",
    "bazaarCatalog.upsert",
    "emailMarketing.archiveCampaign",
    "emailMarketing.archiveSender",
    "emailMarketing.automations",
    "emailMarketing.cancelQueuedRecipients",
    "emailMarketing.checkSenderDomain",
    "emailMarketing.createSender",
    "emailMarketing.customers",
    "emailMarketing.deleteCampaignDraft",
    "emailMarketing.detail",
    "emailMarketing.duplicateCampaign",
    "emailMarketing.exportFailedRecipients",
    "emailMarketing.history",
    "emailMarketing.logoGallery",
    "emailMarketing.overview",
    "emailMarketing.preview",
    "emailMarketing.products",
    "emailMarketing.reconcileCampaign",
    "emailMarketing.resumeCampaign",
    "emailMarketing.retryTransientFailures",
    "emailMarketing.saveDraft",
    "emailMarketing.sendCampaign",
    "emailMarketing.sendTest",
    "emailMarketing.senders",
    "emailMarketing.testAutomation",
    "emailMarketing.updateAutomation",
    "mMarket.assignMissingCategory",
    "mMarket.bulkAutofillSpecs",
    "mMarket.bulkCreateBaseTemplates",
    "mMarket.exportNow",
    "mMarket.exportReadyNow",
    "mMarket.jobs",
    "mMarket.overview",
    "mMarket.preflight",
    "mMarket.products",
    "mMarket.revealToken",
    "mMarket.saveBranchMappings",
    "mMarket.saveConnection",
    "mMarket.settings",
    "mMarket.startDescriptionGenerationJob",
    "mMarket.updateProducts",
    "mMarket.validateLocal",
    "oMarket.exportNow",
    "oMarket.exportReadyNow",
    "oMarket.fullSyncNow",
    "oMarket.jobs",
    "oMarket.overview",
    "oMarket.preflight",
    "oMarket.products",
    "oMarket.revealToken",
    "oMarket.saveCategoryMappings",
    "oMarket.saveSettings",
    "oMarket.saveStoreMappings",
    "oMarket.settings",
    "oMarket.syncStockPriceNow",
    "oMarket.testConnection",
    "oMarket.updateProducts",
    "productImageStudio.create",
    "productImageStudio.job",
    "productImageStudio.jobs",
    "productImageStudio.overview",
    "productImageStudio.retry",
    "productImageStudio.saveToProduct",
    "products.descriptionGenerationAvailability",
    "products.descriptionGenerationJob",
    "products.retryDescriptionGenerationJobFailed",
    "products.searchQuick",
    "stores.list",
  ];
  const tree: Record<string, Record<string, unknown>> = {};
  for (const path of paths) {
    const [router, procedure] = path.split(".") as [string, string];
    const parent = (tree[router] ??= {});
    parent[procedure] = {
      useQuery: (_input?: unknown, options?: { enabled?: boolean }) => {
        const enabled = options?.enabled !== false;
        state.queries.push({ path, enabled });
        const error =
          state.failed === path
            ? { message: "serviceUnavailable", data: { code: "INTERNAL_SERVER_ERROR" } }
            : null;
        let data: unknown;
        if (path === "stores.list") data = state.emptyStores ? [] : state.stores;
        if (["bazaarApi.listStores", "bazaarCatalog.listStores"].includes(path))
          data = state.emptyStores ? [] : state.catalogStores;
        if (
          [
            "bazaarApi.apiKeys",
            "productImageStudio.jobs",
            "emailMarketing.history",
            "emailMarketing.logoGallery",
            "emailMarketing.automations",
          ].includes(path)
        )
          data = [];
        if (path === "productImageStudio.overview")
          data = {
            configured: false,
            status: "NOT_CONFIGURED",
            totalJobs: 0,
            succeededJobs: 0,
            failedJobs: 0,
          };
        if (path === "products.searchQuick") data = [];
        return {
          data: error ? undefined : data,
          error,
          isLoading: !error && data === undefined,
          isFetching: enabled && !error && data === undefined,
          refetch: () => {
            state.retries.push(path);
            return Promise.resolve({ data, error: null });
          },
        };
      },
      useMutation: () => ({ mutate: state.mutate, mutateAsync: state.mutate, isLoading: false }),
      invalidate: vi.fn(),
      getData: vi.fn(),
    };
  }
  return { trpc: { ...tree, useUtils: () => tree } };
});

import Hub from "@/app/(app)/operations/integrations/page";
import Api from "@/app/(app)/operations/integrations/bazaar-api/page";
import Catalog from "@/app/(app)/operations/integrations/bazaar-catalog/page";
import Bakai from "@/app/(app)/operations/integrations/bakai-store/page";
import MMarket from "@/app/(app)/operations/integrations/m-market/page";
import OMarket from "@/app/(app)/operations/integrations/o-market/page";
import Studio from "@/app/(app)/operations/integrations/product-image-studio/page";
import { EmailMarketingWorkspace as Email } from "@/app/(app)/operations/integrations/email-marketing/workspace";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "ADMIN";
  state.failed = "";
  state.emptyStores = false;
  state.retries = [];
  state.queries = [];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (media: string) => ({
      matches: true,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

const retryCases = [
  ["API stores", Api, "bazaarApi.listStores"],
  ["API keys", Api, "bazaarApi.apiKeys"],
  ["catalog stores", Catalog, "bazaarCatalog.listStores"],
  ["catalog settings", Catalog, "bazaarCatalog.getSettings"],
  ["Bakai settings", Bakai, "bakaiStore.settings"],
  ["M-market settings", MMarket, "mMarket.settings"],
  ["O-market settings", OMarket, "oMarket.settings"],
  ["Bakai products", Bakai, "bakaiStore.products"],
  ["Bakai jobs", Bakai, "bakaiStore.jobs"],
  ["M-market products", MMarket, "mMarket.products"],
  ["M-market jobs", MMarket, "mMarket.jobs"],
  ["O-market products", OMarket, "oMarket.products"],
  ["O-market jobs", OMarket, "oMarket.jobs"],
  ["O-market validation", OMarket, "oMarket.preflight"],
  ["studio overview", Studio, "productImageStudio.overview"],
  ["studio jobs", Studio, "productImageStudio.jobs"],
  ["email stores", Email, "stores.list"],
  ["email overview", Email, "emailMarketing.overview"],
  ["email history", Email, "emailMarketing.history"],
  ["email senders", Email, "emailMarketing.senders"],
  ["summary", Hub, "mMarket.overview"],
  ["catalog summary", Hub, "bazaarCatalog.listStores"],
  ["API summary", Hub, "bazaarApi.apiKeys"],
  ["Bakai summary", Hub, "bakaiStore.overview"],
  ["O-market summary", Hub, "oMarket.overview"],
  ["studio summary", Hub, "productImageStudio.overview"],
  ["email summary", Hub, "emailMarketing.overview"],
] as const;
const pages = [
  ["API", Api],
  ["catalog", Catalog],
  ["Bakai", Bakai],
  ["M-market", MMarket],
  ["O-market", OMarket],
  ["studio", Studio],
  ["email", Email],
  ["summary", Hub],
] as const;

describe("integration workspace recovery", () => {
  it.each(retryCases)("recovers %s using only its failed read query", (_name, Page, path) => {
    state.failed = path;
    render(<Page />);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((alert) => alert.textContent?.includes("errors.serviceUnavailable"))).toBe(
      true,
    );
    fireEvent.click(within(alerts[0]).getByRole("button", { name: "common.tryAgain" }));
    expect(state.retries).toEqual([path]);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("does not describe studio product-search failure as no results", () => {
    state.failed = "products.searchQuick";
    render(<Studio />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "productImageStudioSettings.input.productLabel" }),
      { target: { value: "tea" } },
    );
    expect(screen.queryByText("common.nothingFound")).toBeNull();
    fireEvent.click(
      within(screen.getByRole("alert")).getByRole("button", { name: "common.tryAgain" }),
    );
    expect(state.retries).toEqual(["products.searchQuick"]);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("recovers automation history without starting or sending an automation", () => {
    state.failed = "emailMarketing.automations";
    render(<Email />);
    fireEvent.click(screen.getByRole("tab", { name: "Автоматизации" }));
    fireEvent.click(
      within(screen.getByRole("alert")).getByRole("button", { name: "common.tryAgain" }),
    );
    expect(state.retries).toEqual(["emailMarketing.automations"]);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("does not label an unknown integration summary as not configured", () => {
    render(<Hub />);
    expect(screen.queryByText("integrations.mMarket.status.notConfigured")).toBeNull();
    expect(screen.getAllByText("common.loading").length).toBeGreaterThan(0);
  });

  it("offers a store choice instead of endless loading when the catalog has no stores", () => {
    state.emptyStores = true;
    render(<Catalog />);
    expect(screen.queryByText("common.loading")).toBeNull();
    expect(screen.getAllByText("common.selectStore").length).toBeGreaterThan(0);
  });

  it("does not keep the API summary loading when there are genuinely no stores", () => {
    state.emptyStores = true;
    render(<Hub />);
    const card = screen.getByText("integrations.bazaarApi.title").closest(".flex-col");
    expect(card).toBeTruthy();
    expect(within(card as HTMLElement).queryByText("common.loading")).toBeNull();
    expect(within(card as HTMLElement).getByText("integrations.status.notConfigured")).toBeTruthy();
  });

  it.each(pages)("retains manager access to %s", (_name, Page) => {
    state.role = "MANAGER";
    render(<Page />);
    expect(screen.queryByText("errors.forbidden")).toBeNull();
    expect(state.queries.some((query) => query.enabled)).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  for (const role of ["STAFF", "CASHIER"]) {
    it.each(pages)("explains existing server denial for " + role + " in %s", (_name, Page) => {
      state.role = role;
      render(<Page />);
      expect(screen.getByText("errors.forbidden")).toBeTruthy();
      expect(state.queries.every((query) => !query.enabled)).toBe(true);
      expect(state.mutate).not.toHaveBeenCalled();
    });
  }
});
