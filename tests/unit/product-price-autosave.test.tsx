// @vitest-environment jsdom
import { useRef } from "react";
import { FormProvider, useForm, Controller } from "react-hook-form";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ProductPriceAutosave,
  type PriceAutosaveHandle,
} from "@/components/products/product-price-autosave";
import { priceAutosavePendingKey, savePriceAutosavePending } from "@/lib/productPriceAutosave";
import { PriceInput } from "@/components/ui/price-input";
const api = vi.hoisted(() => ({
  save: vi.fn(),
  reconcile: vi.fn(),
  fetch: vi.fn(),
  setData: vi.fn(),
  invalidate: vi.fn(),
  state: vi.fn(),
  checking: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/trpc", () => {
  const cache = { invalidate: api.invalidate };
  const utils = {
    products: {
      storePricing: { ...cache, fetch: api.fetch, setData: api.setData },
      getById: cache,
      pricing: cache,
      list: cache,
      bootstrap: cache,
    },
  };
  return {
    trpc: {
      useUtils: () => utils,
      storePrices: {
        autosave: { useMutation: () => ({ mutateAsync: api.save }) },
        reconcileAutosave: { useMutation: () => ({ mutateAsync: api.reconcile }) },
      },
    },
  };
});
const v = "a".repeat(64),
  next = "b".repeat(64),
  ctx = { unitId: "each", currencyCode: "KGS" as const, currencyRateKgsPerUnit: 1 };
const receipt = (r: any) => ({
  status: "SAVED",
  version: next,
  changed: true,
  prices: r.prices,
  stored: [],
});
let control: { current: PriceAutosaveHandle | null };
function Harness({ currency = "KGS", rate = 1 }: { currency?: string; rate?: number }) {
  const form = useForm({
    defaultValues: {
      name: "Original",
      baseUnitId: "each",
      retailPriceKgs: "500",
      wholesalePriceKgs: "400",
      variants: [{ id: "variant", retailPriceKgs: "50", wholesalePriceKgs: "40" }],
    },
  });
  const ref = useRef<PriceAutosaveHandle | null>(null);
  control = ref;
  const config = {
    organizationId: "org",
    userId: "user",
    productId: "product",
    storeId: "store",
    version: v,
    controlRef: ref,
    onSaved: vi.fn(),
    onState: api.state,
  };
  return (
    <FormProvider {...form}>
      <input aria-label="Name" {...form.register("name")} />
      <input aria-label="Unit" {...form.register("baseUnitId")} />
      {(["retailPriceKgs", "wholesalePriceKgs", "variants.0.retailPriceKgs"] as const).map(
        (path) => (
          <Controller
            key={path}
            name={path}
            control={form.control}
            render={({ field }) => (
              <PriceInput
                aria-label={path}
                {...field}
                onChange={(e) => {
                  field.onChange(e);
                  ref.current?.edited(path);
                }}
                onBlur={() => {
                  field.onBlur();
                  ref.current?.blur(path);
                }}
              />
            )}
          />
        ),
      )}
      <output data-testid="dirty">{JSON.stringify(form.formState.dirtyFields)}</output>
      <ProductPriceAutosave
        ref={ref}
        productId="product"
        config={config}
        unitId="each"
        currencyCode={currency}
        currencyRateKgsPerUnit={rate}
        onChecking={api.checking}
      />
    </FormProvider>
  );
}
const edit = (path: string, value: string) => {
  fireEvent.change(screen.getByLabelText(path), { target: { value } });
  fireEvent.blur(screen.getByLabelText(path));
};
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  api.save.mockImplementation(async (r) => receipt(r));
  api.invalidate.mockResolvedValue(undefined);
  api.fetch.mockResolvedValue({
    basePriceKgs: null,
    stores: [
      {
        storeId: "store",
        priceVersion: next,
        currencyCode: "KGS",
        currencyRateKgsPerUnit: 1,
        retailPriceKgs: 1100,
        overridePriceKgs: 1100,
        wholesalePriceKgs: 850,
        variants: [{ variantId: "variant", retailPriceKgs: 70, wholesalePriceKgs: 60 }],
      },
    ],
  });
});
afterEach(cleanup);
it("saves a blurred price and resets only its own dirty baseline", async () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Unsaved name" } });
  edit("retailPriceKgs", "900");
  await waitFor(() => expect(screen.getByText("saved", { exact: true }).textContent).toBe("saved"));
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(api.save.mock.calls[0][0]).toMatchObject({
    ...ctx,
    prices: [{ variantId: null, retailPriceKgs: 900 }],
  });
  expect(screen.getByTestId("dirty").textContent).toContain('"name":true');
  expect(screen.getByTestId("dirty").textContent).not.toContain('"retailPriceKgs":true');
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Unsaved name");
});
it("leaves a price-only form clean so store preparation can be used immediately", async () => {
  render(<Harness />);
  edit("wholesalePriceKgs", "750");
  await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("{}"));
  expect(api.save).toHaveBeenCalledTimes(1);
});
it("preserves newer input while serializing a second blur behind a slow first response", async () => {
  let finish!: (r: any) => void;
  api.save.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  render(<Harness />);
  edit("retailPriceKgs", "900");
  edit("retailPriceKgs", "950");
  expect(api.save).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(receipt(api.save.mock.calls[0][0]));
  });
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
  expect(api.save.mock.calls[1][0]).toMatchObject({
    expectedVersion: next,
    prices: [{ variantId: null, retailPriceKgs: 950 }],
  });
  expect((screen.getByLabelText("retailPriceKgs") as HTMLInputElement).value).toBe("950");
});
it("retries an unknown response with the original key before saving a newer draft", async () => {
  api.save.mockRejectedValueOnce(new Error("offline"));
  render(<Harness />);
  edit("retailPriceKgs", "900");
  await screen.findByRole("alert");
  const first = api.save.mock.calls[0][0];
  fireEvent.change(screen.getByLabelText("retailPriceKgs"), { target: { value: "980" } });
  fireEvent.click(screen.getByRole("button", { name: "checkRetry" }));
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(3));
  expect(api.save.mock.calls[1][0]).toEqual(first);
  expect(api.save.mock.calls[2][0].prices[0].retailPriceKgs).toBe(980);
});
it("reloads current prices on a version conflict and preserves other unsaved fields", async () => {
  api.save.mockRejectedValueOnce(
    Object.assign(new Error("priceAutosaveConflict"), { data: { code: "CONFLICT" } }),
  );
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Keep me" } });
  edit("retailPriceKgs", "900");
  fireEvent.click(await screen.findByRole("button", { name: "reload" }));
  await waitFor(() =>
    expect((screen.getByLabelText("retailPriceKgs") as HTMLInputElement).value).toBe("1100"),
  );
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Keep me");
  expect(screen.getByTestId("dirty").textContent).toBe('{"name":true}');
});
it("recovers an unknown committed request using current data rather than old receipt prices", async () => {
  const r = {
    ...ctx,
    productId: "product",
    storeId: "store",
    expectedVersion: v,
    idempotencyKey: "recovery-key",
    prices: [{ retailPriceKgs: 900 }],
  };
  savePriceAutosavePending(
    sessionStorage,
    priceAutosavePendingKey("org", "user", "product", "store"),
    r,
  );
  api.reconcile.mockResolvedValue(receipt(r));
  render(<Harness />);
  await waitFor(() =>
    expect((screen.getByLabelText("retailPriceKgs") as HTMLInputElement).value).toBe("1100"),
  );
  expect(api.save).not.toHaveBeenCalled();
  expect(api.checking).toHaveBeenCalledWith(true);
  expect(api.checking).toHaveBeenLastCalledWith(false);
});
it("keeps an unsaved unit change in the ordinary full-form save", async () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "box" } });
  edit("retailPriceKgs", "900");
  await screen.findByRole("alert");
  expect(api.save).not.toHaveBeenCalled();
  expect(await control.current!.flushManual()).toBe(true);
});
it("saves existing variant IDs and converts foreign display amounts to canonical KGS", async () => {
  render(<Harness currency="USD" rate={87} />);
  edit("variants.0.retailPriceKgs", "10");
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  expect(api.save.mock.calls[0][0]).toMatchObject({
    currencyCode: "USD",
    currencyRateKgsPerUnit: 87,
    prices: [{ variantId: "variant", retailPriceKgs: 870 }],
  });
});
it.each(["68,50", "68.50"])(
  "autosaves locale price %s without changing its amount",
  async (raw) => {
    render(<Harness />);
    edit("retailPriceKgs", raw);
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save.mock.calls[0][0].prices).toEqual([{ variantId: null, retailPriceKgs: 68.5 }]);
    await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("{}"));
  },
);
it("keeps a separator draft until blur and converts a comma variant price to authoritative KGS", async () => {
  render(<Harness currency="USD" rate={87} />);
  const input = screen.getByLabelText("variants.0.retailPriceKgs") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "68," } });
  expect(input.value).toBe("68,");
  expect(api.save).not.toHaveBeenCalled();
  edit("variants.0.retailPriceKgs", "68,50");
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  expect(api.save.mock.calls[0][0].prices).toEqual([
    { variantId: "variant", retailPriceKgs: 5959.5 },
  ]);
});
it.each(["68,5x", "68,501", "-68,50"])("does not autosave invalid amount %s", async (raw) => {
  render(<Harness />);
  edit("wholesalePriceKgs", raw);
  await screen.findByRole("alert");
  expect(api.save).not.toHaveBeenCalled();
});
