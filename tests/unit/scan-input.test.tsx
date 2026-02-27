// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { ScanInput } from "@/components/ScanInput";

const { lookupFetchMock } = vi.hoisted(() => ({
  lookupFetchMock: vi.fn(),
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
  },
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

  it("submits on Tab when enabled and input length is at least 4", async () => {
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
    await user.type(input, "1234");
    await user.keyboard("[Tab]");

    await waitFor(() => {
      expect(lookupFetchMock).toHaveBeenCalledWith({ q: "1234" });
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
