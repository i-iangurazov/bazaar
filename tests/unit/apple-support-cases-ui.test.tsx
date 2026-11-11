// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import { AppleSupportCases } from "@/components/billing/apple-support-cases";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AppleSupportCase } from "@/server/billing/appleSupportCases";
const item = (): AppleSupportCase => ({ caseId: "transaction:synthetic-case", organization: { id: "synthetic-org", name: "Synthetic merchant" },
  state: "FINANCIAL_REVIEW", productId: "synthetic.product", environment: "Sandbox", createdAt: "2026-11-11T00:00:00Z",
  reason: "applePaymentNeedsReview", payerState: "DEPARTED", completionCapability: true, hasAppleReference: true,
  transaction: { transactionId: "100000000000001", originalTransactionId: "100000000000001", status: "REVIEW", currency: "USD", priceMillis: "9990" } });
const mock = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn(), lookup: vi.fn(), recheck: vi.fn(), ingest: vi.fn(),
  data: null as { items: AppleSupportCase[]; nextCursor: string | null } | null, loading: false, failed: false }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ platformOwner: { appleCase: { fetch: mock.lookup } } }), platformOwner: {
  appleCases: { useQuery: (input: unknown, options: unknown) => { mock.query(input, options); return { data: mock.data, isLoading: mock.loading,
    isError: mock.failed, error: new Error("serviceUnavailable"), isFetching: false, refetch: mock.refetch }; } },
  recheckAppleCase: { useMutation: () => ({ mutateAsync: mock.recheck }) }, importAppleEvidence: { useMutation: () => ({ mutateAsync: mock.ingest }) },
} } }));
vi.mock("@/components/query-error-state", () => ({ QueryErrorState: ({ onRetry }: { onRetry: () => void }) => <button onClick={onRetry}>Retry case list</button> }));
beforeEach(() => {
  vi.clearAllMocks(); mock.loading = false; mock.failed = false; mock.data = { items: [item()], nextCursor: null };
  mock.lookup.mockResolvedValue(item()); mock.refetch.mockResolvedValue(undefined);
  mock.recheck.mockResolvedValue({ status: "RECHECKED", case: item() }); mock.ingest.mockResolvedValue({ case: { ...item(), state: "RESOLVED", reason: null } });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const translations = { en, ru, kg };
const mount = (enabled = true, locale: keyof typeof translations = "en") => render(<NextIntlClientProvider locale={locale} messages={translations[locale]} timeZone="Asia/Bishkek">
  <TooltipProvider><AppleSupportCases enabled={enabled} /></TooltipProvider></NextIntlClientProvider>);
const strings = () => (en.platformOwner as typeof en.platformOwner & { appleSupport: Record<string, string> }).appleSupport;
const open = () => { fireEvent.click(screen.getByRole("button", { name: strings().view })); return screen.getByRole("dialog"); };
const fill = (dialog: HTMLElement) => {
  fireEvent.change(within(dialog).getByLabelText(strings().evidenceLabel), { target: { value: "synthetic.signed-apple-transaction.evidence" } });
  fireEvent.click(within(dialog).getByRole("checkbox"));
};
describe("scoped Apple support case UI", () => {
  it.each(["en", "ru", "kg"] as const)("shows actual USD charges and icon-only localized row actions in %s", (locale) => {
    const rendered = mount(true, locale), expected = new Intl.NumberFormat(locale === "kg" ? "ky-KG" : locale, { style: "currency", currency: "USD" }).format(9.99);
    expect(rendered.container.textContent).toContain(expected);
    const t = (translations[locale].platformOwner as typeof en.platformOwner & { appleSupport: Record<string, string> }).appleSupport;
    expect(screen.getByRole("button", { name: t.view }).textContent).toBe("");
    expect(screen.getByRole("button", { name: t.recheck }).textContent).toBe("");
    expect(mock.ingest).not.toHaveBeenCalled();
  });
  it("disables queries for a forbidden role and provides loading, empty and retry states", () => {
    const view = mount(false); expect(screen.queryByText(strings().title)).toBeNull();
    expect(mock.query).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
    view.unmount(); mock.loading = true; const loading = mount(); expect(screen.getByText(en.common.loading)).toBeTruthy();
    loading.unmount(); mock.loading = false; mock.data = { items: [], nextCursor: null }; const empty = mount(); expect(screen.getByText(strings().empty)).toBeTruthy();
    empty.unmount(); mock.failed = true; mount(); fireEvent.click(screen.getByRole("button", { name: "Retry case list" })); expect(mock.refetch).toHaveBeenCalledOnce();
  });
  it("keeps reference-less rechecks unresolved and never offers absence-based clearance", async () => {
    mock.data = { items: [{ ...item(), caseId: "intent:synthetic-pending", state: "NATIVE_PENDING", transaction: null, hasAppleReference: false }], nextCursor: null };
    mock.recheck.mockResolvedValue({ status: "NO_APPLE_REFERENCE", case: mock.data.items[0] }); mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: strings().recheck })); });
    expect(mock.recheck).toHaveBeenCalledWith({ caseId: "intent:synthetic-pending" });
    expect(screen.getByRole("status").textContent).toBe(strings().noReference); expect(mock.ingest).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /clear|mark paid|mark unpaid/i })).toBeNull();
  });
  it("requires explicit scoped signed evidence and prevents repeated submission while awaiting a server result", async () => {
    let resolve!: (value: unknown) => void; mock.ingest.mockImplementation(() => new Promise((yes) => { resolve = yes; }));
    mount(); const dialog = open(), submit = within(dialog).getByRole("button", { name: strings().importAction });
    expect((submit as HTMLButtonElement).disabled).toBe(true); fill(dialog);
    await act(async () => { fireEvent.click(submit); fireEvent.click(submit); });
    expect(mock.ingest).toHaveBeenCalledTimes(1);
    expect(mock.ingest).toHaveBeenCalledWith({ caseId: item().caseId, signedTransactionInfo: "synthetic.signed-apple-transaction.evidence" });
    await act(async () => { resolve({ case: { ...item(), state: "RESOLVED", reason: null } }); });
    expect(within(dialog).getByRole("status").textContent).toBe(strings().evidenceRecorded);
    expect((within(dialog).getByLabelText(strings().evidenceLabel) as HTMLTextAreaElement).value).toBe("");
  });
  it("keeps failed evidence available for an intentional retry and displays the server authorization error", async () => {
    mock.ingest.mockRejectedValueOnce(Object.assign(new Error("forbidden"), { data: { code: "FORBIDDEN" } }));
    mount(); const dialog = open(); fill(dialog);
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: strings().importAction })); });
    expect(within(dialog).getByRole("alert").textContent).toBe(en.errors.forbidden);
    expect((within(dialog).getByLabelText(strings().evidenceLabel) as HTMLTextAreaElement).value).not.toBe("");
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: strings().importAction })); });
    expect(mock.ingest).toHaveBeenCalledTimes(2);
  });
  it("pages cases and looks up a complete reference without sending drafts or invalid identifiers", async () => {
    mock.data = { items: [item()], nextCursor: "next-cursor" }; mount();
    fireEvent.click(screen.getByRole("button", { name: strings().nextPage }));
    expect(mock.query).toHaveBeenLastCalledWith({ limit: 20, cursor: "next-cursor" }, expect.anything());
    fireEvent.change(screen.getByLabelText(strings().searchLabel), { target: { value: "invalid" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: strings().search })); });
    expect(mock.lookup).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toBe(strings().invalidCase);
    fireEvent.change(screen.getByLabelText(strings().searchLabel), { target: { value: item().caseId } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: strings().search })); });
    expect(mock.lookup).toHaveBeenCalledWith({ caseId: item().caseId }); expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("discards form data and a late success after the operator loses access", async () => {
    let resolve!: (value: unknown) => void; mock.ingest.mockImplementation(() => new Promise((yes) => { resolve = yes; }));
    const tree = (enabled: boolean) => <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Bishkek"><TooltipProvider><AppleSupportCases enabled={enabled} /></TooltipProvider></NextIntlClientProvider>;
    const view = render(tree(true)), dialog = open(); fill(dialog);
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: strings().importAction })); });
    view.rerender(tree(false)); expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { resolve({ case: { ...item(), state: "RESOLVED" } }); });
    view.rerender(tree(true));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.queryByText(strings().evidenceRecorded)).toBeNull();
    expect((screen.getByRole("button", { name: strings().view }) as HTMLButtonElement).disabled).toBe(false);
    expect(mock.ingest).toHaveBeenCalledOnce();
  });
});
