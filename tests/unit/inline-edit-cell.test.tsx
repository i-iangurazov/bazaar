// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineEditableCell, InlineEditTableProvider } from "@/components/table/InlineEditableCell";
import { inlineEditRegistry, type InlineMutationOperation } from "@/lib/inlineEdit/registry";
import en from "../../messages/en.json";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));
window.matchMedia = vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})) as unknown as typeof window.matchMedia;
const item = {
  id: "product",
  name: "Product",
  category: null,
  unit: "each",
  baseUnitId: "each",
  basePriceKgs: null,
  onHandQty: 12,
  inventorySnapshots: [{ storeId: "store", onHand: 12, variantId: null, version: 4 }],
};
function Fixture({
  generation = 0,
  value = 12,
  version = 4,
  execute,
}: {
  generation?: number;
  value?: number;
  version?: number;
  execute: (operation: InlineMutationOperation) => Promise<void>;
}) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{ inlineEditing: en.inlineEditing, errors: en.errors }}
    >
      <InlineEditTableProvider>
        <InlineEditableCell
          key={generation}
          rowId="product"
          row={{
            ...item,
            onHandQty: value,
            inventorySnapshots: [{ ...item.inventorySnapshots[0], onHand: value, version }],
          }}
          value={value}
          definition={inlineEditRegistry.products.onHand}
          context={{ storeId: "store", categories: [], stockAdjustReason: "Counted" }}
          role="MANAGER"
          locale="en"
          columnLabel="Stock"
          tTable={(key) => key}
          tCommon={(key) => key}
          enabled
          executeMutation={execute}
        />
      </InlineEditTableProvider>
    </NextIntlClientProvider>
  );
}
describe("inline stock editor behavior", () => {
  afterEach(cleanup);
  it("retains the typed draft and original stock revision across cell remounts", async () => {
    const execute = vi
      .fn<(operation: InlineMutationOperation) => Promise<void>>()
      .mockResolvedValue(undefined);
    const view = render(<Fixture execute={execute} />);
    fireEvent.doubleClick(screen.getByText("12"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "18" } });
    view.rerender(<Fixture generation={1} value={11} version={5} execute={execute} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("18");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0][0]).toMatchObject({
      route: "inventory.setOnHand",
      input: {
        productId: "product",
        storeId: "store",
        expectedOnHand: 12,
        expectedVersion: 4,
        targetOnHand: 18,
      },
    });
  });

  it("makes Enter/blur single-flight and Escape never saves", async () => {
    let complete!: () => void;
    const execute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const view = render(<Fixture execute={execute} />);
    fireEvent.doubleClick(screen.getByText("12"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(execute).toHaveBeenCalledTimes(1);
    await act(async () => complete());
    view.rerender(<Fixture value={0} version={5} execute={execute} />);
    fireEvent.doubleClick(screen.getByText("0"));
    const canceled = screen.getByRole("textbox");
    fireEvent.change(canceled, { target: { value: "20" } });
    fireEvent.keyDown(canceled, { key: "Escape" });
    fireEvent.blur(canceled);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("retries a failed transport with the same operation identity after a remount", async () => {
    let fail!: (error: Error) => void;
    const execute = vi
      .fn<(operation: InlineMutationOperation) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const view = render(<Fixture execute={execute} />);
    fireEvent.doubleClick(screen.getByText("12"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "18" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    view.rerender(<Fixture generation={1} execute={execute} />);
    await act(async () => fail(new Error("network disconnected")));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1][0]).toEqual(execute.mock.calls[0][0]);
  });
});
