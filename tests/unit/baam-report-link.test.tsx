// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAnalyticsReportHref, parseAnalyticsReportScope } from "@/lib/analyticsReportLink";

const mocks = vi.hoisted(() => ({
  query: "", session: vi.fn(), replace: vi.fn(), stores: vi.fn(), overview: vi.fn(), options: vi.fn(),
  products: vi.fn(), day: vi.fn(), receipts: vi.fn(), registers: vi.fn(), cashiers: vi.fn(),
  exportProducts: vi.fn(), download: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ useSession: mocks.session }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.query), usePathname: () => "/reports/analytics", useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: (namespace: string) => Object.assign((key: string) => `${namespace}.${key}`, { has: () => true }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/fileExport", () => ({ downloadTableFile: mocks.download }));
// Excluded operational implementation never loads; this test exercises report filters only.
vi.mock("@/components/pos/receipt-preview-modal", () => ({ ReceiptPreviewModal: () => null }));
vi.mock("@/components/page-header", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange: (value: string) => void }) => <select value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
}));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ client: { analytics: { soldProductsExport: { query: mocks.exportProducts } } } }),
  stores: { list: { useQuery: mocks.stores } },
  pos: { registers: { list: { useQuery: mocks.registers } }, cashiers: { list: { useQuery: mocks.cashiers } } },
  analytics: {
    salesOverview: { useQuery: mocks.overview }, salesFilterOptions: { useQuery: mocks.options },
    soldProducts: { useQuery: mocks.products }, salesDayDetail: { useQuery: mocks.day }, productReceipts: { useQuery: mocks.receipts },
  },
} }));
import AnalyticsPage from "@/app/(app)/reports/analytics/page";

const parse = (query: string) => parseAnalyticsReportScope(new URLSearchParams(query));
const input = { dateFrom: "2024-02-29", dateTo: "2024-03-01", storeId: "store-a" };
const stores = [{ id: "store-a", name: "Authorized A" }, { id: "store-b", name: "Authorized B" }];
const queryResult = (data: unknown) => ({ data, error: null, isLoading: false, isFetching: false });
const queries = () => [mocks.overview, mocks.options, mocks.products, mocks.day, mocks.receipts, mocks.registers, mocks.cashiers];
const active = (query: typeof mocks.overview) => query.mock.calls.filter(call => call[1]?.enabled);
const setUrl = (href: string) => { mocks.query = href.split("?")[1] ?? ""; };

beforeEach(() => {
  vi.clearAllMocks(); mocks.query = "";
  mocks.session.mockReturnValue({ status: "authenticated", data: { user: { id: "actor", organizationId: "org", role: "MANAGER" } } });
  mocks.stores.mockReturnValue(queryResult(stores));
  mocks.overview.mockReturnValue(queryResult({ series: [], totals: { netSalesKgs: 321, grossSalesKgs: 321 }, range: { timeZone: "Asia/Bishkek" }, meta: {} }));
  mocks.options.mockReturnValue(queryResult({ categories: [] })); mocks.products.mockReturnValue(queryResult({ items: [], total: 0, meta: {} }));
  mocks.day.mockReturnValue(queryResult(null)); mocks.receipts.mockReturnValue(queryResult(null));
  mocks.registers.mockReturnValue(queryResult([])); mocks.cashiers.mockReturnValue(queryResult([]));
  mocks.exportProducts.mockReset(); mocks.download.mockReset(); mocks.download.mockResolvedValue(undefined);
});

describe("all-filtered report export behavior", () => {
  const product = (index: number) => ({ productId:`p-${index}`,variantId:null,variantKey:"BASE",productName:`Product ${index}`,productSku:`SKU-${index}`,baseSku:`SKU-${index}`,variantName:null,barcode:null,category:"Food",quantitySold:1,quantityReturned:0,netQuantity:1,grossRevenueKgs:90,returnedRevenueKgs:0,netRevenueKgs:90,averagePriceKgs:90,stockRemaining:0,receiptCount:1 });
  const loaded = () => { setUrl(buildAnalyticsReportHref(input)); mocks.products.mockReturnValue(queryResult({items:[product(0)],total:26,meta:{}})); };

  it("requests all current filters without pagination and downloads off-page rows", async () => {
    loaded(); const rows=Array.from({length:26},(_,index)=>product(index));
    mocks.exportProducts.mockResolvedValue({items:rows,total:26}); render(<AnalyticsPage/>);
    fireEvent.change(screen.getByLabelText("analytics.filters.productSearch"),{target:{value:"Product"}});
    fireEvent.click(screen.getByRole("button",{name:"analytics.actions.exportAllProducts"}));
    await waitFor(()=>expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(mocks.exportProducts).toHaveBeenCalledWith({...input,registerId:undefined,cashierId:undefined,category:undefined,search:"Product"});
    const file=mocks.download.mock.calls[0][0];
    expect(file.fileNameBase).toBe("sold-products-all-filtered-2024-02-29-2024-03-01");
    expect(file.rows).toHaveLength(26); expect(file.rows[25][0]).toBe("Product 25");
    expect(file.header).not.toContain("stockRemaining");
  });

  it("shows a row-limit failure without downloading a truncated file", async () => {
    loaded(); mocks.exportProducts.mockRejectedValue(Error("analyticsExportRowLimit")); render(<AnalyticsPage/>);
    fireEvent.click(screen.getByRole("button",{name:"analytics.actions.exportAllProducts"}));
    await waitFor(()=>expect(screen.getByRole("alert").textContent).toBe("errors.analyticsExportRowLimit"));
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it.each(["filters","audience","unmount"])("discards an in-flight export after %s changes", async (change) => {
    loaded(); let complete!: (value: unknown)=>void;
    mocks.exportProducts.mockReturnValue(new Promise(resolve=>{complete=resolve;}));
    const view=render(<AnalyticsPage/>);
    fireEvent.click(screen.getByRole("button",{name:"analytics.actions.exportAllProducts"}));
    expect(screen.getByRole("button",{name:"analytics.actions.exportingProducts"}).hasAttribute("disabled")).toBe(true);
    if(change==="filters") fireEvent.change(screen.getByLabelText("analytics.filters.productSearch"),{target:{value:"another product"}});
    else if(change==="audience") {
      mocks.session.mockReturnValue({status:"authenticated",data:{user:{id:"other-actor",organizationId:"other-org",role:"MANAGER"}}});
      view.rerender(<AnalyticsPage/>);
    } else view.unmount();
    await act(async()=>{complete({items:[product(0)],total:1});});
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
afterEach(cleanup);

describe("analytics report URL contract", () => {
  it("builds and round-trips real business dates and a concrete store", () => {
    expect(buildAnalyticsReportHref(input)).toBe("/reports/analytics?dateFrom=2024-02-29&dateTo=2024-03-01&storeId=store-a");
    expect(parse(buildAnalyticsReportHref(input).split("?")[1])).toEqual({ kind: "valid", scope: input });
  });
  it("represents all accessible stores by omission, preserving explicit dates", () => {
    const scope = { dateFrom: "2026-01-01", dateTo: "2026-01-02" };
    expect(parse(buildAnalyticsReportHref(scope).split("?")[1])).toEqual({ kind: "valid", scope });
    expect(parse("")).toEqual({ kind: "default" });
  });
  it("accepts366 inclusive days but rejects367", () => {
    expect(() => buildAnalyticsReportHref({ dateFrom: "2024-01-01", dateTo: "2024-12-31" })).not.toThrow();
    expect(() => buildAnalyticsReportHref({ dateFrom: "2024-01-01", dateTo: "2025-01-01" })).toThrow("invalidInput");
  });
  it.each([
    "dateFrom=2026-02-29&dateTo=2026-03-01", "dateFrom=2026-04-31&dateTo=2026-05-01",
    "dateFrom=2026-01-02&dateTo=2026-01-01", "dateFrom=2026-1-01&dateTo=2026-01-02",
    "dateFrom=2026-01-01", "dateTo=2026-01-02", "storeId=store-a",
    "dateFrom=&dateTo=2026-01-02", "dateFrom=2026-01-01&dateTo=2026-01-02&storeId=",
    "dateFrom=2026-01-01&dateFrom=2026-01-01&dateTo=2026-01-02",
    "dateFrom=2026-01-01&dateTo=2026-01-02&storeId=store-a&storeId=store-b",
    "dateFrom=2026-01-01&dateTo=2026-01-02&storeId[]=store-a",
    "dateFrom=2026-01-01&dateTo=2026-01-02&storeId=all",
    "dateFrom=2026-01-01&dateTo=2026-01-02&date_from=2026-01-01",
  ])("rejects invalid/partial/polluted query %s", query => {
    expect(parse(query)).toEqual({ kind: "invalid", error: "invalidInput" });
  });
});

describe("report scope behavior", () => {
  it("waits for fresh authorized stores and never fetches the default period for a deep link", () => {
    setUrl(buildAnalyticsReportHref(input));
    mocks.stores.mockReturnValue({ ...queryResult(stores), isFetching: true });
    const view = render(<AnalyticsPage />);
    expect((screen.getByLabelText("analytics.filters.dateFrom") as HTMLInputElement).value).toBe(input.dateFrom);
    expect((screen.getByLabelText("analytics.filters.dateTo") as HTMLInputElement).value).toBe(input.dateTo);
    expect(screen.queryByText("Authorized A")).toBeNull();
    for (const query of queries()) expect(active(query)).toHaveLength(0);
    mocks.stores.mockReturnValue(queryResult(stores)); view.rerender(<AnalyticsPage />);
    expect(active(mocks.overview).length).toBeGreaterThan(0);
    for (const [request] of active(mocks.overview)) expect(request).toMatchObject(input);
  });
  it("rejects an unauthorized store without silently broadening to all stores or rendering results", () => {
    setUrl(buildAnalyticsReportHref({ ...input, storeId: "other-tenant-store" })); render(<AnalyticsPage />);
    expect(screen.getByRole("alert").textContent).toBe("errors.storeAccessDenied");
    for (const query of queries()) expect(active(query)).toHaveLength(0);
    expect(screen.queryByText("analytics.kpis.netSales")).toBeNull();
  });
  it.each(["dateFrom=2026-04-31&dateTo=2026-05-01", "dateFrom=2026-01-01&dateFrom=2026-01-02&dateTo=2026-01-03"])("blocks all report queries for invalid URL %s", query => {
    mocks.query = query; render(<AnalyticsPage />);
    expect(screen.getByRole("alert").textContent).toBe("errors.invalidInput");
    for (const call of queries()) expect(active(call)).toHaveLength(0);
  });
  it("uses the newly navigated scope atomically and reapplies the old scope on back navigation", () => {
    const first = buildAnalyticsReportHref(input), next = buildAnalyticsReportHref({ dateFrom: "2026-08-01", dateTo: "2026-08-04", storeId: "store-b" });
    setUrl(first); const view = render(<AnalyticsPage />);
    for (const href of [next, first]) {
      mocks.overview.mockClear(); setUrl(href); view.rerender(<AnalyticsPage />);
      const expected = parse(href.split("?")[1]); expect(expected.kind).toBe("valid");
      if (expected.kind !== "valid") throw Error("fixture invalid");
      for (const [request] of active(mocks.overview)) expect(request).toMatchObject(expected.scope);
      expect((screen.getByLabelText("analytics.filters.dateFrom") as HTMLInputElement).value).toBe(expected.scope.dateFrom);
    }
  });
  it("writes manual dates/store selection to the URL and restores them on refresh", () => {
    setUrl(buildAnalyticsReportHref(input)); const view = render(<AnalyticsPage />);
    fireEvent.change(screen.getByLabelText("analytics.filters.dateTo"), { target: { value: "2024-03-02" } });
    expect(mocks.replace).toHaveBeenLastCalledWith("/reports/analytics?dateFrom=2024-02-29&dateTo=2024-03-02&storeId=store-a", { scroll: false });
    setUrl(mocks.replace.mock.lastCall![0]); view.rerender(<AnalyticsPage />);
    fireEvent.change(screen.getByLabelText("analytics.filters.store"), { target: { value: "all" } });
    expect(mocks.replace).toHaveBeenLastCalledWith("/reports/analytics?dateFrom=2024-02-29&dateTo=2024-03-02", { scroll: false });
    setUrl(mocks.replace.mock.lastCall![0]); view.unmount(); render(<AnalyticsPage />);
    expect((screen.getByLabelText("analytics.filters.dateTo") as HTMLInputElement).value).toBe("2024-03-02");
    expect(mocks.overview.mock.lastCall?.[0]).toMatchObject({ dateFrom: "2024-02-29", dateTo: "2024-03-02", storeId: undefined });
    fireEvent.change(screen.getByLabelText("analytics.filters.productSearch"), { target: { value: "allowed product" } });
    expect(active(mocks.products).at(-1)?.[0].search).toBe("allowed product");
  });
  it("keeps a cleared manual date explicit and blocks queries until corrected", () => {
    setUrl(buildAnalyticsReportHref(input)); const view = render(<AnalyticsPage />);
    fireEvent.change(screen.getByLabelText("analytics.filters.dateFrom"), { target: { value: "" } });
    setUrl(mocks.replace.mock.lastCall![0]); queries().forEach(query => query.mockClear()); view.rerender(<AnalyticsPage />);
    expect(screen.getByRole("alert").textContent).toBe("errors.invalidInput");
    expect((screen.getByLabelText("analytics.filters.dateFrom") as HTMLInputElement).value).toBe("");
    for (const query of queries()) expect(active(query)).toHaveLength(0);
  });
  it("hides an existing report when its selected store access is revoked", () => {
    setUrl(buildAnalyticsReportHref(input)); const view = render(<AnalyticsPage />);
    expect(screen.getByText("analytics.kpis.netSales")).toBeTruthy();
    mocks.stores.mockReturnValue(queryResult(stores.slice(1))); queries().forEach(query => query.mockClear()); view.rerender(<AnalyticsPage />);
    expect(screen.getByRole("alert").textContent).toBe("errors.storeAccessDenied");
    expect(screen.queryByText("analytics.kpis.netSales")).toBeNull();
    for (const query of queries()) expect(active(query)).toHaveLength(0);
  });
});
