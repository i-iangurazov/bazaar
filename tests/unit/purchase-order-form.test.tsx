// @vitest-environment jsdom
import React from "react";
import { NextIntlClientProvider } from "next-intl";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewPurchaseOrderPage from "@/app/(app)/purchase-orders/new/page";
import { TooltipProvider } from "@/components/ui/tooltip";
import messages from "../../messages/ru.json";

const api = vi.hoisted(() => {
  const product = {
    id: "product-pack", name: "QA Товар в упаковке", sku: "QA-PACK", variants: [],
    baseUnit: { id: "unit-each", code: "pcs", labelRu: "шт", labelKg: "даана" },
    packs: [{ id: "pack-six", packName: "Упаковка 6", multiplierToBase: 6,
      allowInPurchasing: true, allowInReceiving: true }],
  };
  return {
    product,
    stores: [{ id: "store", name: "QA Магазин", currencyCode: "KGS", currencyRateKgsPerUnit: 1 }],
    suppliers: [],
    search: [{ id: product.id, name: product.name, sku: product.sku }],
    session: { data: { user: { id: "qa-admin", role: "ADMIN" } }, status: "authenticated" },
    create: vi.fn(), toast: vi.fn(), push: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: api.push }),
  useSearchParams: () => new URLSearchParams("storeId=store"),
}));
vi.mock("next-auth/react", () => ({ useSession: () => api.session }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  stores: { list: { useQuery: () => ({ data: api.stores }) } },
  suppliers: { list: { useQuery: () => ({ data: api.suppliers }) } },
  products: {
    searchQuick: { useQuery: () => ({ data: api.search, isLoading: false }) },
    getById: { useQuery: ({ productId }: { productId: string }) => ({ data: productId ? api.product : undefined }) },
  },
  purchaseOrders: { create: { useMutation: () => ({ mutate: api.create, isLoading: false }) } },
} }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: api.toast }) }));
vi.mock("@/components/ui/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(), confirmDialog: null }),
}));
vi.mock("@/components/page-header", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/ScanInput", async () => {
  const { forwardRef } = await import("react");
  type ScannerProps = {
    value?: string; ariaLabel: string; placeholder: string; autoFocus?: boolean;
    onValueChange?: (value: string) => void; onFocus?: () => void; onBlur?: () => void;
  };
  return { ScanInput: forwardRef<HTMLInputElement, ScannerProps>(function Scanner(props, ref) {
    return <input ref={ref} aria-label={props.ariaLabel} placeholder={props.placeholder}
      value={props.value ?? ""} autoFocus={props.autoFocus}
      onChange={event => props.onValueChange?.(event.target.value)}
      onFocus={props.onFocus} onBlur={props.onBlur} />;
  }) };
});

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function renderForm() {
  render(<NextIntlClientProvider locale="ru" messages={messages} timeZone="Asia/Bishkek">
    <TooltipProvider><NewPurchaseOrderPage /></TooltipProvider>
  </NextIntlClientProvider>);
}

async function addPack(cost: string) {
  fireEvent.click(screen.getByRole("button", { name: messages.purchaseOrders.addLine }));
  const dialog = screen.getByRole("dialog", { name: messages.purchaseOrders.addLineTitle });
  fireEvent.change(within(dialog).getByLabelText(messages.purchaseOrders.productSearchPlaceholder), {
    target: { value: api.product.name },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(api.product.name) }));
  const unit = within(dialog).getByRole("combobox", { name: messages.purchaseOrders.unit });
  await waitFor(() => expect(unit.getAttribute("disabled")).toBeNull());
  fireEvent.keyDown(unit, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: /Упаковка 6/ }));
  const quantity = within(dialog).getByLabelText<HTMLInputElement>(messages.purchaseOrders.orderQty, { exact: true });
  expect(quantity.inputMode).toBe("decimal");
  await act(async () => quantity.focus());
  fireEvent.change(quantity, { target: { value: "1.2" } });
  expect(quantity.checkValidity()).toBe(true);
  fireEvent.change(quantity, { target: { value: "1.2345" } });
  expect(quantity.checkValidity()).toBe(false);
  fireEvent.change(quantity, {
    target: { value: "2" },
  });
  await waitFor(() => expect(within(dialog).getByText("В базе: 12 шт")).toBeTruthy());
  fireEvent.change(within(dialog).getByLabelText(messages.purchaseOrders.unitCost, { exact: true }), {
    target: { value: cost },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: messages.purchaseOrders.addLine }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

function expectTotal(amount: string) {
  const total = screen.getByText(new RegExp(`^${messages.purchaseOrders.total}:`));
  expect(total.textContent?.replace(/\s/g, " ")).toContain(amount);
}

async function saveDraft(expectedCost: number | undefined) {
  fireEvent.click(screen.getByRole("button", { name: messages.purchaseOrders.saveDraft }));
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  const payload: unknown = api.create.mock.calls[0][0];
  expect(payload).toMatchObject({ storeId: "store", submit: false,
    lines: [{ productId: api.product.id, qtyOrdered: 2, unitCost: expectedCost, packId: "pack-six" }] });
  expect(api.toast).not.toHaveBeenCalled();
}

describe("purchase order real line form and resolver", () => {
  it("keeps the current product search open after an earlier blur is followed by refocus", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: messages.purchaseOrders.addLine }));
    const dialog = screen.getByRole("dialog", { name: messages.purchaseOrders.addLineTitle });
    const search = within(dialog).getByLabelText(messages.purchaseOrders.productSearchPlaceholder);
    fireEvent.change(search, { target: { value: api.product.name } });
    expect(within(dialog).getByRole("button", { name: new RegExp(api.product.name) })).toBeTruthy();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.blur(search);
    fireEvent.focus(search);
    await act(async () => vi.advanceTimersByTime(151));
    expect(within(dialog).getByRole("button", { name: new RegExp(api.product.name) })).toBeTruthy();
  });

  it.each([
    { input: "", parsed: undefined, total: messages.common.notAvailable },
    { input: "0", parsed: 0, total: "0,00" },
    { input: "4.25", parsed: 4.25, total: "51,00" },
  ])("keeps pack metadata and parsed cost $input after adding and saving", async ({ input, parsed, total }) => {
    renderForm();
    await addPack(input);
    expectTotal(total);
    await saveDraft(parsed);
  });

  it("retains the chosen pack when editing a draft, including explicit zero and cleared cost", async () => {
    renderForm();
    await addPack("4.25");
    expectTotal("51,00");
    for (const [before, next, total] of [
      ["4.25", "0", "0,00"],
      ["0", "", messages.common.notAvailable],
      ["", "4.25", "51,00"],
    ]) {
      fireEvent.click(screen.getAllByRole("button", { name: messages.purchaseOrders.editLine })[0]);
      const dialog = screen.getByRole("dialog", { name: messages.purchaseOrders.editLineTitle });
      const quantity = within(dialog).getByLabelText(messages.purchaseOrders.orderQty, { exact: true });
      const cost = within(dialog).getByLabelText(messages.purchaseOrders.unitCost, { exact: true });
      expect((quantity as HTMLInputElement).value).toBe("2");
      expect((cost as HTMLInputElement).value).toBe(before);
      expect(within(dialog).getByRole("combobox", { name: messages.purchaseOrders.unit }).textContent)
        .toContain("Упаковка 6");
      fireEvent.change(cost, { target: { value: next } });
      fireEvent.click(within(dialog).getByRole("button", { name: messages.purchaseOrders.saveLine }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expectTotal(total);
    }
    await saveDraft(4.25);
  });
});
