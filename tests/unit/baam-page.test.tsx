// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";

const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), refetch: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: mocks.session }));
vi.mock("@/lib/trpc", () => ({ trpc: { baam: { overview: { useQuery: mocks.query } } } }));
vi.mock("@/components/page-header", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
import BaamPage from "@/app/(app)/baam/page";

const fixture = () => ({
  audience: { actorId: "actor" }, version: "completed-sales-kgs-v1",
  scope: { organizationId: "org", storeIds: ["store"], availableStores: [{ id: "store", name: "Authorized synthetic store" }] },
  period: { dateFrom: "2026-09-01", dateTo: "2026-09-02", timeZone: "Asia/Bishkek" },
  totals: { salesBeforeReturnsKgs: 90, returnsKgs: 120, netSalesKgs: -30, recordedDiscountKgs: 10, receiptCount: 2, returnCount: 1, averageReceiptKgs: 45 },
  quality: { emptyAccessibleStoreSet: false, qualifyingRecords: 3, paymentsReconcile: true, salesDifferenceKgs: 0, refundsDifferenceKgs: 0 },
  freshness: { queriedAt: "2026-09-05T12:00:00.000Z" },
  days: [{ date: "2026-09-01", salesBeforeReturnsKgs: 90, returnsKgs: 120, netSalesKgs: -30, receiptCount: 2 }],
});
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={{ baam: messages.baam, errors: messages.errors }}><BaamPage /></NextIntlClientProvider>);

describe("BAAM read-only presentation states", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockReturnValue({ status: "authenticated", data: { user: { id: "actor", organizationId: "org", role: "MANAGER" } } });
    mocks.query.mockReturnValue({ data: fixture(), error: null, isFetching: false, refetch: mocks.refetch });
  });
  afterEach(cleanup);

  it("shows negative recorded net sales and definition, applied scope and unknown completeness", () => {
    renderPage();
    expect(screen.getByTestId("baam-metric-net").textContent).toContain("-30.00 KGS");
    expect(screen.getByText(/Source completeness is unknown/)).toBeTruthy();
    expect(screen.getByText(/Applied period: 2026-09-01 to 2026-09-02/).textContent).toContain("Authorized synthetic store");
    expect(screen.getByText(/Metric definitions: completed-sales-kgs-v1/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Store" })).toBeTruthy();
  });

  it("retains the last authorized store label while refreshing but hides old figures", () => {
    const view = renderPage();
    fireEvent.change(screen.getByRole("combobox", { name: "Store" }), { target: { value: "store" } });
    mocks.query.mockReturnValue({ data: fixture(), error: null, isFetching: true, refetch: mocks.refetch });
    view.rerender(<NextIntlClientProvider locale="en" messages={{ baam: messages.baam, errors: messages.errors }}><BaamPage /></NextIntlClientProvider>);
    expect(screen.queryByTestId("baam-metric-net")).toBeNull();
    expect(screen.getByRole("option", { name: "Authorized synthetic store" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Store" }) as HTMLSelectElement).value).toBe("store");
    expect(screen.getByRole("status").textContent).toContain("Loading current figures");
  });

  it("hides failed-query figures and preserves input for retry", () => {
    const view = renderPage();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-08-01" } });
    mocks.query.mockReturnValue({ data: fixture(), error: new Error("storeAccessDenied"), isFetching: false, refetch: mocks.refetch });
    view.rerender(<NextIntlClientProvider locale="en" messages={{ baam: messages.baam, errors: messages.errors }}><BaamPage /></NextIntlClientProvider>);
    expect(screen.queryByTestId("baam-metric-net")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-08-01");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("does not render another actor or organization's cached figures", () => {
    mocks.query.mockReturnValue({ data: { ...fixture(), audience: { actorId: "previous-actor" } }, error: null, isFetching: true });
    renderPage();
    expect(screen.queryByTestId("baam-metric-net")).toBeNull();
    expect(screen.queryByRole("option", { name: "Authorized synthetic store" })).toBeNull();
  });

  it("keeps period and provenance visible for empty data, with an unknown average", () => {
    const data = fixture();
    mocks.query.mockReturnValue({ data: { ...data, quality: { ...data.quality, qualifyingRecords: 0 }, totals: { ...data.totals, receiptCount: 0, averageReceiptKgs: null } }, error: null, isFetching: false });
    renderPage();
    expect(screen.getByText(/No qualifying completed sales or returns/)).toBeTruthy();
    expect(screen.getByText(/Applied period: 2026-09-01/)).toBeTruthy();
    expect(screen.getByTestId("baam-metric-average").textContent).toContain("Not available");
  });

  it("blocks nonmanager rendering and query activation", () => {
    mocks.session.mockReturnValue({ status: "authenticated", data: { user: { id: "actor", organizationId: "org", role: "STAFF" } } });
    renderPage();
    expect(screen.queryByTestId("baam-metric-net")).toBeNull();
    expect(mocks.query.mock.calls[0][1].enabled).toBe(false);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
