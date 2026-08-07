// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import path from "node:path";

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SalesOrderReturnRedirect } from "@/components/sales-order-return-redirect";
import { resolveLegacySalesReturnRedirect } from "@/lib/salesOrderReturnRoute";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

describe("legacy sales return route", () => {
  beforeEach(() => {
    navigation.replace.mockClear();
  });

  it("redirects direct return-mode URLs to the authoritative receipt return flow", () => {
    expect(resolveLegacySalesReturnRedirect(new URLSearchParams("mode=return"))).toBe(
      "/pos/history",
    );
    expect(
      resolveLegacySalesReturnRedirect(
        new URLSearchParams("mode=return&registerId=register%2Fone&storeId=ignored"),
      ),
    ).toBe("/pos/history?registerId=register%2Fone");
  });

  it("leaves ordinary customer-order creation on its own route", () => {
    expect(resolveLegacySalesReturnRedirect(new URLSearchParams())).toBeNull();
    expect(resolveLegacySalesReturnRedirect(new URLSearchParams("mode=sale"))).toBeNull();
    expect(resolveLegacySalesReturnRedirect(new URLSearchParams("mode=RETURN"))).toBeNull();
  });

  it("performs the browser redirect without exposing the ordinary sale form", async () => {
    render(<SalesOrderReturnRedirect href="/pos/history?registerId=register-1" label="Loading" />);

    expect(screen.getByRole("status").textContent).toContain("Loading");
    expect(screen.queryByRole("button")).toBeNull();
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledTimes(1);
      expect(navigation.replace).toHaveBeenCalledWith("/pos/history?registerId=register-1");
    });
  });

  it("removes the misleading normal-sale return presentation branch", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/app/(app)/sales/orders/new/page.tsx"),
      "utf8",
    );

    expect(source).toContain("<SalesOrderReturnRedirect");
    expect(source).toContain("if (legacyReturnRedirect)");
    expect(source).not.toContain("isReturnMode");
    expect(source).not.toContain('t("returnModeHint")');
    expect(source).not.toContain('t("newReturn")');
  });
});
