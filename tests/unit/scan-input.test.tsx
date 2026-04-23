// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { ScanInput } from "@/components/ScanInput";

const { lookupFetchMock, searchQuickUseQueryMock } = vi.hoisted(() => ({
  lookupFetchMock: vi.fn(),
  searchQuickUseQueryMock: vi.fn(),
}));

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

  it("submits on Enter", async () => {
    lookupFetchMock.mockResolvedValue({ exactMatch: true, items: [exactItem] });
    const onResolved = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <ScanInput
        context="global"
        placeholder="scan"
        ariaLabel="scan"
        onResolved={onResolved}
      />,
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
      <ScanInput
        context="global"
        placeholder="scan"
        ariaLabel="scan"
        onResolved={onResolved}
      />,
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
      <ScanInput
        context="global"
        placeholder="scan"
        ariaLabel="scan"
        onResolved={onResolved}
      />,
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
      <ScanInput
        context="global"
        placeholder="scan"
        ariaLabel="scan"
        onResolved={onResolved}
      />,
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
});
