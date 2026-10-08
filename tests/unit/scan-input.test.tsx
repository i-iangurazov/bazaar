// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { ScanInput } from "@/components/ScanInput";

const { lookupFetchMock, searchQuickUseQueryMock } = vi.hoisted(() => ({
  lookupFetchMock: vi.fn(),
  searchQuickUseQueryMock: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      products: {
        lookupScan: {
          fetch: lookupFetchMock,
        },
      },
    }),
    products: {
      searchQuick: {
        useQuery: searchQuickUseQueryMock,
      },
    },
  },
}));

vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: () => (key: string) =>
    ({
      loading: "Loading",
      nothingFound: "Nothing found",
      imageUnavailable: "No image",
      bundleProductLabel: "Bundle",
      searchResultBarcode: "Barcode",
      searchResultPrice: "Price",
      searchResultStock: "Stock",
    })[key] ?? key,
}));

const exactItem = {
  id: "prod-1",
  name: "Milk",
  sku: "SKU-1",
  type: "product" as const,
  primaryImage: null,
  matchType: "barcode" as const,
};

describe("ScanInput", () => {
  beforeEach(() => {
    lookupFetchMock.mockReset();
    searchQuickUseQueryMock.mockReset();
    searchQuickUseQueryMock.mockReturnValue({ data: [], isFetching: false });
  });

  it("selects the query on first focus and lets later clicks edit part of it", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<ScanInput context="pos" placeholder="scan" ariaLabel="scan"
      value="Смеситель GF-2106 Titan" onValueChange={change} selectOnInteraction />);
    const input = screen.getByLabelText("scan") as HTMLInputElement;
    await user.click(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    await user.pointer({ target: input, keys: "[MouseLeft>]" });
    input.setSelectionRange(10, 10);
    await user.pointer({ target: input, keys: "[/MouseLeft]" });
    expect([input.selectionStart, input.selectionEnd]).toEqual([10, 10]);
    await user.keyboard("X");
    expect(change).toHaveBeenLastCalledWith("Смеситель XGF-2106 Titan");
  });

  it("preserves a manually selected substring and selects all again after leaving the field", async () => {
    const user = userEvent.setup();
    render(<><ScanInput context="pos" placeholder="scan" ariaLabel="scan"
      value="Milk chocolate" selectOnInteraction /><button>Outside</button></>);
    const input = screen.getByLabelText("scan") as HTMLInputElement;
    await user.click(input);
    await user.pointer({ target: input, keys: "[MouseLeft>]" });
    input.setSelectionRange(5, 14);
    await user.pointer({ target: input, keys: "[/MouseLeft]" });
    expect([input.selectionStart, input.selectionEnd]).toEqual([5, 14]);
    await user.click(screen.getByText("Outside"));
    await user.click(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 14]);
  });

  it("selects on keyboard focus without forcing later clicks to select all", async () => {
    const user = userEvent.setup();
    render(<ScanInput context="pos" placeholder="scan" ariaLabel="scan"
      value="Milk chocolate" selectOnInteraction />);
    const input = screen.getByLabelText("scan") as HTMLInputElement;
    await user.tab();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 14]);
    input.setSelectionRange(5, 5);
    fireEvent.click(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([5, 5]);
  });

  it("releases the automatic full selection on a second touch while preserving partial selections", async () => {
    const user = userEvent.setup();
    render(<ScanInput context="pos" placeholder="scan" ariaLabel="scan"
      value="Milk chocolate" selectOnInteraction />);
    const input = screen.getByLabelText("scan") as HTMLInputElement;
    await user.pointer({ target: input, keys: "[TouchA]" });
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 14]);
    await user.pointer({ target: input, keys: "[TouchA]" });
    expect(input.selectionStart).toBe(input.selectionEnd);
    input.setSelectionRange(5, 14);
    await user.pointer({ target: input, keys: "[TouchA>]" });
    expect([input.selectionStart, input.selectionEnd]).toEqual([5, 14]);
    await user.pointer({ target: input, keys: "[/TouchA]" });
  });

  it("submits on Enter", async () => {
    lookupFetchMock.mockResolvedValue({ exactMatch: true, items: [exactItem] });
    const onResolved = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <ScanInput context="global" placeholder="scan" ariaLabel="scan" onResolved={onResolved} />,
    );

    const input = screen.getByLabelText("scan");
    await user.type(input, "000123{Enter}");

    await waitFor(() => {
      expect(lookupFetchMock).toHaveBeenCalledWith({ q: "000123" });
    });
    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "exact", item: expect.objectContaining({ id: "prod-1" }) }),
      );
    });
  });

  it("submits on Tab when enabled for scanner-oriented contexts", async () => {
    lookupFetchMock.mockResolvedValue({ exactMatch: true, items: [exactItem] });
    const onResolved = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <ScanInput
        context="global"
        placeholder="scan"
        ariaLabel="scan"
        onResolved={onResolved}
        supportsTabSubmit
      />,
    );

    const input = screen.getByLabelText("scan");
    await user.type(input, "7");
    await user.keyboard("[Tab]");

    await waitFor(() => {
      expect(lookupFetchMock).toHaveBeenCalledWith({ q: "7" });
    });
  });

  it("keeps command panel tab guard for short input", async () => {
    lookupFetchMock.mockResolvedValue({ exactMatch: true, items: [exactItem] });
    const onResolved = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <ScanInput
        context="commandPanel"
        placeholder="scan"
        ariaLabel="scan"
        onResolved={onResolved}
        supportsTabSubmit
      />,
    );

    const input = screen.getByLabelText("scan");
    await user.type(input, "7");
    await user.keyboard("[Tab]");

    await waitFor(() => {
      expect(lookupFetchMock).not.toHaveBeenCalled();
    });
  });

  it("shows a dropdown for multiple matches", async () => {
    lookupFetchMock.mockResolvedValue({
      exactMatch: false,
      items: [
        { ...exactItem, id: "prod-1", name: "Milk", sku: "SKU-1", matchType: "name" as const },
        { ...exactItem, id: "prod-2", name: "Bread", sku: "SKU-2", matchType: "name" as const },
      ],
    });
    const onResolved = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <ScanInput context="global" placeholder="scan" ariaLabel="scan" onResolved={onResolved} />,
    );

    const input = screen.getByLabelText("scan");
    await user.type(input, "br{Enter}");

    expect(await screen.findByText("Milk")).toBeTruthy();
    expect(screen.getByText("Bread")).toBeTruthy();
  });

  it("supports keyboard navigation in multiple-match dropdown", async () => {
    lookupFetchMock.mockResolvedValue({
      exactMatch: false,
      items: [
        { ...exactItem, id: "prod-1", name: "Milk", sku: "SKU-1", matchType: "name" as const },
        { ...exactItem, id: "prod-2", name: "Bread", sku: "SKU-2", matchType: "name" as const },
      ],
    });
    const onResolved = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <ScanInput context="global" placeholder="scan" ariaLabel="scan" onResolved={onResolved} />,
    );

    const input = screen.getByLabelText("scan");
    await user.type(input, "br{Enter}");
    expect(await screen.findByText("Milk")).toBeTruthy();

    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      expect(onResolved).toHaveBeenLastCalledWith(
        expect.objectContaining({
          kind: "exact",
          item: expect.objectContaining({ id: "prod-2" }),
        }),
      );
    });
  });

  it("shows live product search results with image preview when enabled", async () => {
    searchQuickUseQueryMock.mockReturnValue({
      data: [
        {
          id: "prod-1",
          name: "Milk",
          sku: "SKU-1",
          type: "product",
          isBundle: false,
          primaryImage: "/products/milk.jpg",
          primaryBarcode: "4600001",
          category: "Dairy",
          categories: ["Dairy"],
          basePriceKgs: 120,
          effectivePriceKgs: 120,
          onHandQty: 8,
        },
      ],
      isFetching: false,
    });
    const onResolved = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <ScanInput
        context="global"
        placeholder="scan"
        ariaLabel="scan"
        onResolved={onResolved}
        enableProductSearch
      />,
    );

    const input = screen.getByLabelText("scan");
    await user.type(input, "mi");

    expect(await screen.findByText("Milk")).toBeTruthy();
    expect((screen.getByAltText("Milk") as HTMLImageElement).getAttribute("src")).toBe(
      "/products/milk.jpg",
    );

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "exact",
          item: expect.objectContaining({ id: "prod-1" }),
        }),
      );
    });
  });

  it("shows error state and keeps focus on not found", async () => {
    lookupFetchMock.mockResolvedValue({ exactMatch: false, items: [] });
    const onResolved = vi.fn().mockResolvedValue(false);
    const user = userEvent.setup();

    render(
      <ScanInput context="global" placeholder="scan" ariaLabel="scan" onResolved={onResolved} />,
    );

    const input = screen.getByLabelText("scan") as HTMLInputElement;
    await user.type(input, "404404{Enter}");

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ kind: "notFound" }));
    });

    expect(document.activeElement).toBe(input);
    expect(input.className.includes("border-danger")).toBe(true);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("looks up the current query instead of selecting stale live suggestions", async () => {
    searchQuickUseQueryMock.mockReturnValue({
      data: [{ ...exactItem, id: "old", name: "Milk" }],
      isFetching: false,
    });
    lookupFetchMock.mockResolvedValue({
      exactMatch: true,
      items: [{ ...exactItem, id: "new", name: "Bread" }],
    });
    const onResolved = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(
      <ScanInput
        context="global"
        placeholder="scan"
        ariaLabel="scan"
        enableProductSearch
        onResolved={onResolved}
      />,
    );
    const input = screen.getByLabelText("scan");
    await user.type(input, "mi");
    expect(await screen.findByText("Milk")).toBeTruthy();
    await user.clear(input);
    await user.type(input, "br{Enter}");
    await waitFor(() => expect(lookupFetchMock).toHaveBeenCalledWith({ q: "br" }));
    await waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith(
        expect.objectContaining({ item: expect.objectContaining({ id: "new" }) }),
      ),
    );
  });

  it("ignores an outdated scan response when the user has typed another query", async () => {
    let finish!: (value: unknown) => void;
    lookupFetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onResolved = vi.fn();
    const user = userEvent.setup();
    render(
      <ScanInput context="global" placeholder="scan" ariaLabel="scan" onResolved={onResolved} />,
    );
    const input = screen.getByLabelText("scan") as HTMLInputElement;
    await user.type(input, "old{Enter}");
    await user.clear(input);
    await user.type(input, "new");
    finish({ exactMatch: true, items: [exactItem] });
    await waitFor(() =>
      expect(screen.queryByRole("combobox")?.getAttribute("aria-expanded")).toBe("false"),
    );
    expect(onResolved).not.toHaveBeenCalled();
    expect(input.value).toBe("new");
  });

  it("submits only once while a scan lookup is pending", async () => {
    let finish!: (value: unknown) => void;
    lookupFetchMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<ScanInput context="global" placeholder="scan" ariaLabel="scan" />);
    await user.type(screen.getByLabelText("scan"), "123{Enter}{Enter}");
    expect(lookupFetchMock).toHaveBeenCalledTimes(1);
    finish({ exactMatch: true, items: [exactItem] });
    await waitFor(() => expect((screen.getByLabelText("scan") as HTMLInputElement).value).toBe(""));
  });

  it("preserves spaces in multiword product lookup while normalizing scanner characters", async () => {
    lookupFetchMock.mockResolvedValue({ exactMatch: false, items: [] });
    const user = userEvent.setup();
    render(<ScanInput context="linePicker" placeholder="scan" ariaLabel="scan" />);
    await user.type(screen.getByLabelText("scan"), "щит 12 секций{Enter}");
    await waitFor(() => expect(lookupFetchMock).toHaveBeenCalledWith({ q: "щит 12 секций" }));
  });

  it("keeps Enter available to an input method while composing text", async () => {
    render(<ScanInput context="global" placeholder="scan" ariaLabel="scan" />);
    const input = screen.getByLabelText("scan");
    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(lookupFetchMock).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
  });

  it("adds the sole name match on Enter in POS without a suggestion dropdown", async () => {
    lookupFetchMock.mockResolvedValue({
      exactMatch: false,
      items: [{ ...exactItem, matchType: "name" }],
    });
    const onResolved = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(
      <ScanInput
        context="pos"
        placeholder="scan"
        ariaLabel="scan"
        showDropdown={false}
        onResolved={onResolved}
      />,
    );
    await user.type(screen.getByLabelText("scan"), "Milk{Enter}");
    await waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "exact",
          item: expect.objectContaining({ id: "prod-1" }),
        }),
      ),
    );
    await waitFor(() => expect((screen.getByLabelText("scan") as HTMLInputElement).value).toBe(""));
  });

  it("closes a portal dropdown on an outside click and keeps it closed after results settle", async () => {
    searchQuickUseQueryMock.mockReturnValue({ data: [exactItem], isFetching: false });
    const user = userEvent.setup();
    render(
      <>
        <ScanInput
          context="global"
          placeholder="scan"
          ariaLabel="scan"
          enableProductSearch
          portalDropdown
        />
        <button>Outside</button>
      </>,
    );
    const input = screen.getByLabelText("scan");
    await user.type(input, "mi");
    expect(await screen.findByRole("listbox")).toBeTruthy();
    await user.click(screen.getByText("Outside"));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await user.click(input);
    expect(await screen.findByRole("listbox")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
