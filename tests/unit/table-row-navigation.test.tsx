// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { DataTable } from "@/components/ui/data-table";

const open = vi.spyOn(window, "open").mockImplementation(() => null);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function Fixture({ navigation = true }: { navigation?: boolean }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ common: { nothingFound: "Empty" } }}>
      <DataTable
        columns={[
          { id: "name", header: "Name", cell: ({ row }) => <span>{row.original.name}</span> },
          {
            id: "controls",
            header: "Actions",
            cell: () => (
              <>
                <button>Action</button>
                <a href="/other">Other</a>
                <input aria-label="Choose" type="checkbox" />
                <span role="button" tabIndex={0}>
                  Inline editor
                </span>
                <span data-inline-cell="price">Price</span>
                <span data-testid="editable" contentEditable suppressContentEditableWarning>
                  Edit
                </span>
              </>
            ),
          },
        ]}
        data={[{ id: "product", name: "Product" }]}
        getRowHref={
          navigation ? (row) => `/products/${row.id}?storeId=store&returnTo=%2Fproducts` : undefined
        }
      />
    </NextIntlClientProvider>
  );
}
describe("entity table row navigation", () => {
  it("opens free row content in a protected new tab and keeps the current list", () => {
    render(<Fixture />);
    fireEvent.click(screen.getByText("Product"));
    expect(open).toHaveBeenCalledWith(
      "/products/product?storeId=store&returnTo=%2Fproducts",
      "_blank",
      "noopener,noreferrer",
    );
  });
  it.each(["Action", "Other", "Inline editor", "Price", "Edit"])(
    "keeps %s control events independent",
    (label) => {
      render(<Fixture />);
      const control = screen.getByText(label);
      if (label === "Other") control.addEventListener("click", (e) => e.preventDefault());
      fireEvent.click(control);
      expect(open).not.toHaveBeenCalled();
    },
  );
  it("keeps selection independent", () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(open).not.toHaveBeenCalled();
  });
  it("does not navigate when copying text", () => {
    render(<Fixture />);
    vi.spyOn(window, "getSelection").mockReturnValueOnce({
      toString: () => "selected",
    } as Selection);
    fireEvent.click(screen.getByText("Product"));
    expect(open).not.toHaveBeenCalled();
  });
  it("does not change tables without row navigation", () => {
    render(<Fixture navigation={false} />);
    fireEvent.click(screen.getByText("Product"));
    expect(open).not.toHaveBeenCalled();
  });
});
