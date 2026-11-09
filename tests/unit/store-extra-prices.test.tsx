// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const state = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ products: { invalidate: vi.fn() } }),
    storePrices: { upsert: { useMutation: () => ({ mutate: state.mutate, isLoading: false }) } },
  },
}));
import { StoreExtraPrices } from "@/components/products/store-extra-prices";
const props = {
  storeId: "store",
  productId: "first",
  retail: 100,
  wholesale: 80,
  onSaved: vi.fn(),
};
const retail = () => screen.getByLabelText("retailPrice · KGS") as HTMLInputElement;
const wholesale = () => screen.getByLabelText("wholesalePrice · KGS") as HTMLInputElement;
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
describe("individual price editor during shared publication", () => {
  it.each(["68,50", "68.50"])("saves locale price %s as the same amount", (raw) => {
    render(<StoreExtraPrices {...props} />);
    expect(retail().inputMode).toBe("decimal");
    fireEvent.change(retail(), { target: { value: "68," } });
    expect(retail().value).toBe("68,");
    fireEvent.change(retail(), { target: { value: raw } });
    fireEvent.click(screen.getByRole("button", { name: "saveAdditionalPrices" }));
    expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ retailPriceKgs: 68.5 }));
  });
  it.each(["68,5x", "68,501", "-68,50"])("blocks invalid extra price %s", (raw) => {
    render(<StoreExtraPrices {...props} />);
    fireEvent.change(retail(), { target: { value: raw } });
    expect(
      (screen.getByRole("button", { name: "saveAdditionalPrices" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "saveAdditionalPrices" }));
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it("preserves a more precise untouched foreign-currency price while editing another kind", () => {
    render(
      <StoreExtraPrices {...props} currencyCode="USD" currencyRateKgsPerUnit={87} retail={700} />,
    );
    fireEvent.change(screen.getByLabelText("wholesalePrice · USD"), { target: { value: "2,50" } });
    const save = screen.getByRole("button", { name: "saveAdditionalPrices" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        retailPriceKgs: undefined,
        wholesalePriceKgs: 217.5,
      }),
    );
  });
  it("refreshes untouched prices, preserves the edited kind and submits only that kind", () => {
    const view = render(<StoreExtraPrices {...props} />);
    fireEvent.change(retail(), { target: { value: "115" } });
    view.rerender(<StoreExtraPrices {...props} retail={130} wholesale={90} />);
    expect(retail().value).toBe("115");
    expect(wholesale().value).toBe("90");
    fireEvent.click(screen.getByRole("button", { name: "saveAdditionalPrices" }));
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "first",
        retailPriceKgs: 115,
        wholesalePriceKgs: undefined,
      }),
    );
  });
  it("does not carry an unsaved price to a different product in the same store", () => {
    const view = render(<StoreExtraPrices {...props} />);
    fireEvent.change(retail(), { target: { value: "999" } });
    view.rerender(<StoreExtraPrices {...props} productId="second" retail={200} wholesale={150} />);
    expect(retail().value).toBe("200");
    expect(wholesale().value).toBe("150");
    expect(
      (screen.getByRole("button", { name: "saveAdditionalPrices" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
