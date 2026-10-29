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
    expect((screen.getByRole("button", { name: "saveAdditionalPrices" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
