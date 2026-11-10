// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ReceivingCommerceLine } from "@/components/inventory/receiving-commerce-line";
import { formatCurrencyKGS } from "@/lib/i18nFormat";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";

const valuation = {
  current: { quantity: 10, unitCostKgs: 100, status: "KNOWN" as const, reason: null },
  projected: { quantity: 20, unitCostKgs: 150, status: "KNOWN" as const, reason: null },
};
const context = { productId: "product-one", variantId: null, unitId: "pcs", unitLabel: "pcs",
  currentSalePriceKgs: 200, sharedRetail: true, changesSalePrice: false, valuation };
const callbacks = { onSaleChange: vi.fn(), onSaleFocus: vi.fn(), onSaleKeyDown: vi.fn(), inputRef: null };
const defaults = { lineKey: "product-one:BASE", context, valuation, currencyCode: "KGS", currencyRateKgsPerUnit: 1,
  saleInput: "", pricingAllowed: true, loading: false, disabled: false, ...callbacks };
function view(overrides: Partial<Parameters<typeof ReceivingCommerceLine>[0]> = {}, locale: "ru" | "kg" | "en" = "ru") {
  return render(<NextIntlClientProvider locale={locale} timeZone="Asia/Bishkek" messages={{ inventory: { ru, kg, en }[locale].inventory }}>
    <ReceivingCommerceLine {...defaults} {...overrides} />
  </NextIntlClientProvider>);
}
afterEach(cleanup);

describe("receiving price and reference valuation presentation", () => {
  it.each(["ru", "kg", "en"] as const)("labels current and projected per-store costs and preserved discounts in %s", locale => {
    const copy = { ru, kg, en }[locale].inventory.receivingPricing;
    const { container } = view({}, locale);
    expect(screen.getByText(copy.costTitle)).toBeTruthy();
    expect(Array.from(container.querySelectorAll('[data-receiving-cost-state="KNOWN"]')).map(node => node.textContent))
      .toEqual([formatCurrencyKGS(100, locale), formatCurrencyKGS(150, locale)]);
    expect(container.textContent).toContain(copy.discountsKept);
    expect(container.textContent).not.toMatch(/undefined|\{currency\}|\{unit\}|\{price\}/);
    expect(container.querySelector('input')?.getAttribute('inputmode')).toBe('decimal');
    expect(container.querySelector('input')?.getAttribute('type')).toBe('text');
  });
  it("does not turn unknown history into a zero cost or hide the reason", () => {
    const unknown = { current: { quantity: 10, unitCostKgs: null, status: "UNKNOWN" as const, reason: "UNVALUED_STOCK" },
      projected: { quantity: 20, unitCostKgs: null, status: "UNKNOWN" as const, reason: "UNVALUED_STOCK" } };
    const { container } = view({ valuation: unknown });
    expect(container.querySelectorAll('[data-receiving-cost-state="UNKNOWN"]').length).toBe(2);
    expect(container.querySelector('[data-receiving-cost-state="KNOWN"]')).toBeNull();
    expect(screen.getByText(ru.inventory.receivingPricing.reasons.UNVALUED_STOCK)).toBeTruthy();
  });
  it("distinguishes an empty store from missing cost information", () => {
    const { container } = view({ valuation: { ...valuation, current: { quantity: 0, unitCostKgs: null, status: "UNKNOWN", reason: "NO_STOCK" } } });
    expect(screen.getByText(ru.inventory.receivingPricing.noStock)).toBeTruthy();
    expect(container.querySelector('[data-receiving-cost-state="KNOWN"]')?.textContent).toBe(formatCurrencyKGS(150, "ru"));
  });
  it("preserves blank and explicit zero while warning only about an actual shared-price change", () => {
    const first = view({ saleInput: "" });
    expect(first.container.textContent).not.toContain(ru.inventory.receivingPricing.sharedWarning);
    first.unmount();
    const changed = view({ saleInput: "0" });
    expect(changed.container.textContent).toContain(ru.inventory.receivingPricing.sharedWarning);
    changed.unmount();
    const same = view({ saleInput: "0", context: { ...context, currentSalePriceKgs: 0 } });
    expect(same.container.textContent).not.toContain(ru.inventory.receivingPricing.sharedWarning);
  });
  it("shows prices in store currency but keeps stock cost explicitly in KGS", () => {
    const { container } = view({ currencyCode: "USD", currencyRateKgsPerUnit: 100 });
    expect(container.textContent).toContain("USD");
    expect(container.textContent).toContain(formatCurrencyKGS(150, "ru"));
    expect(container.textContent).not.toContain("200,00 $");
  });
  it("does not promise a shared-price override when currency rounding makes it a no-op", () => {
    const { container } = view({ currencyCode: "USD", currencyRateKgsPerUnit: 3.003,
      saleInput: "3.33", context: { ...context, currentSalePriceKgs: 10 } });
    expect(container.textContent).not.toContain(ru.inventory.receivingPricing.sharedWarning);
  });
  it("locks sale-price edits when unavailable or during unresolved posting", () => {
    const unavailable = view({ pricingAllowed: false });
    expect(unavailable.container.querySelector('input')?.disabled).toBe(true);
    unavailable.unmount();
    const locked = view({ disabled: true });
    expect(locked.container.querySelector('input')?.disabled).toBe(true);
  });
  it.each(["ru", "kg", "en"] as const)("omits a dangling unit separator before context is available in %s", locale => {
    const { container } = view({ context: undefined }, locale);
    const label = container.querySelector('label')?.textContent;
    expect(label).toContain("KGS");
    expect(label).not.toContain("/");
  });
  it("retains the decimal comma draft instead of discarding the iPhone separator", () => {
    function Controlled() {
      const [value, setValue] = useState("68");
      return <NextIntlClientProvider locale="ru" timeZone="Asia/Bishkek" messages={{ inventory: ru.inventory }}>
        <ReceivingCommerceLine {...defaults} saleInput={value} onSaleChange={setValue} />
      </NextIntlClientProvider>;
    }
    const { container } = render(<Controlled />);
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: "68," } });
    expect(input.value).toBe("68,");
    fireEvent.change(input, { target: { value: "68,50" } });
    expect(input.value).toBe("68,50");
    fireEvent.change(input, { target: { value: "68.50" } });
    expect(input.value).toBe("68.50");
  });
});
