// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import path from "node:path";

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DynamicResourceTerminalState } from "@/components/dynamic-resource-terminal-state";
import { DynamicRouteIdGuard } from "@/components/dynamic-route-id-guard";
import { normalizeDynamicRouteId } from "@/lib/dynamicRouteId";
import { resolveProductMovementEditDocumentKey } from "@/lib/productMovementEditDocumentKey";

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/components/page-header", () => ({ PageHeader: () => null }));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

const allAuthenticatedDynamicPatterns = [
  "/sales/orders/{id}",
  "/products/{id}",
  "/inventory/counts/{id}",
  "/inventory/movements/{id}",
  "/inventory/movements/{id}/print",
  "/inventory/receiving/{id}/edit",
  "/inventory/transfers/{id}/edit",
  "/inventory/write-offs/{id}/edit",
  "/purchase-orders/{id}",
  "/stores/{id}/compliance",
  "/stores/{id}/hardware",
] as const;

describe("authenticated dynamic resource terminal states", () => {
  it.each(allAuthenticatedDynamicPatterns)(
    "distinguishes malformed and well-formed nonexistent IDs for %s",
    () => {
      expect(normalizeDynamicRouteId("bad!id")).toBeNull();
      expect(normalizeDynamicRouteId("czzzzzzzzzzzzzzzzzzzzzzzz")).toBe(
        "czzzzzzzzzzzzzzzzzzzzzzzz",
      );
    },
  );

  it("accepts current and legacy opaque IDs while rejecting unsafe path segments", () => {
    expect(normalizeDynamicRouteId("cmtg4l3gt000313b3t7rp1gd3")).toBe("cmtg4l3gt000313b3t7rp1gd3");
    expect(normalizeDynamicRouteId("50f7161e-061c-4df2-943f-5654ae215eb6")).toBe(
      "50f7161e-061c-4df2-943f-5654ae215eb6",
    );
    expect(normalizeDynamicRouteId("legacy_record-1")).toBe("legacy_record-1");

    for (const invalid of ["", " bad", "bad id", "bad/id", "bad%2Fid", "../id", "💥"]) {
      expect(normalizeDynamicRouteId(invalid), invalid).toBeNull();
    }
  });

  it("server guard terminates malformed IDs and preserves valid route children", () => {
    const child = <span>Owned resource</span>;

    expect(() => DynamicRouteIdGuard({ id: "bad!id", children: child })).toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(notFoundMock).toHaveBeenCalledOnce();
    expect(
      DynamicRouteIdGuard({ id: "cmtg4l3gt000313b3t7rp1gd3", children: child }),
    ).toBe(child);
  });

  it("renders a terminal alert without editor or mutation controls", () => {
    const { container } = render(
      <DynamicResourceTerminalState title="Customer order" message="Customer order not found" />,
    );

    expect(screen.getByRole("alert").textContent).toContain("Customer order not found");
    expect(container.querySelector("[data-dynamic-resource-terminal]")).toBeTruthy();
    expect(container.querySelector("button, input, select, textarea, form")).toBeNull();
  });

  it("keeps an inventory edit document key bound to the route ID", () => {
    expect(
      resolveProductMovementEditDocumentKey({
        routeId: "rcv_1",
        requestedDocumentKey: "STOCK_RECEIVING:STOCK_RECEIVING:rcv_1",
        fallbackDocumentType: "STOCK_RECEIVING",
        fallbackReferenceType: "STOCK_RECEIVING",
      }),
    ).toBe("STOCK_RECEIVING:STOCK_RECEIVING:rcv_1");
    expect(
      resolveProductMovementEditDocumentKey({
        routeId: "rcv_1",
        requestedDocumentKey: "STOCK_RECEIVING:STOCK_RECEIVING:another_record",
        fallbackDocumentType: "STOCK_RECEIVING",
        fallbackReferenceType: "STOCK_RECEIVING",
      }),
    ).toBeNull();
    expect(
      resolveProductMovementEditDocumentKey({
        routeId: "rcv_1",
        requestedDocumentKey: "WRITE_OFF:WRITE_OFF:rcv_1",
        fallbackDocumentType: "STOCK_RECEIVING",
        fallbackReferenceType: "STOCK_RECEIVING",
      }),
    ).toBeNull();
    expect(
      resolveProductMovementEditDocumentKey({
        routeId: "rcv_1",
        requestedDocumentKey: "STOCK_RECEIVING:TRANSFER:rcv_1",
        fallbackDocumentType: "STOCK_RECEIVING",
        fallbackReferenceType: "STOCK_RECEIVING",
      }),
    ).toBeNull();
    expect(
      resolveProductMovementEditDocumentKey({
        routeId: "rcv_1",
        fallbackDocumentType: "STOCK_RECEIVING",
        fallbackReferenceType: "STOCK_RECEIVING",
      }),
    ).toBe("STOCK_RECEIVING:STOCK_RECEIVING:rcv_1");
  });

  it("server-guards malformed IDs for all eight formerly failing route patterns", async () => {
    const sharedLayouts = await Promise.all(
      [
        "src/app/(app)/sales/orders/[id]/layout.tsx",
        "src/app/(app)/products/[id]/layout.tsx",
        "src/app/(app)/inventory/counts/[id]/layout.tsx",
        "src/app/(app)/stores/[id]/layout.tsx",
      ].map(readSource),
    );
    sharedLayouts.forEach((source) => {
      expect(source).toContain("DynamicRouteIdGuard");
      expect(source).toContain("params: Promise<");
      expect(source).toContain("await params");
    });

    const editRouteSources = await Promise.all(
      [
        "src/app/(app)/inventory/receiving/[id]/edit/page.tsx",
        "src/app/(app)/inventory/transfers/[id]/edit/page.tsx",
        "src/app/(app)/inventory/write-offs/[id]/edit/page.tsx",
      ].map(readSource),
    );
    editRouteSources.forEach((source) => {
      expect(source).toContain("params: Promise<");
      expect(source).toContain("await Promise.all([params, searchParams])");
      expect(source).toContain("normalizeDynamicRouteId(id)");
      expect(source).toContain("notFound()");
    });
  });

  it("makes all five client-owned resource queries terminal and non-retrying", async () => {
    const routes = [
      {
        file: "src/app/(app)/sales/orders/[id]/page.tsx",
        missingGuard: "if (!order)",
      },
      {
        file: "src/app/(app)/products/[id]/page.tsx",
        missingGuard: "if (!productQuery.data)",
      },
      {
        file: "src/app/(app)/inventory/counts/[id]/page.tsx",
        missingGuard: "if (!count)",
      },
      {
        file: "src/app/(app)/stores/[id]/compliance/page.tsx",
        missingGuard: "if (!store)",
      },
      {
        file: "src/app/(app)/stores/[id]/hardware/page.tsx",
        missingGuard: "if (!settingsQuery.data)",
      },
    ] as const;

    for (const route of routes) {
      const source = await readSource(route.file);
      expect(source, route.file).toContain("normalizeDynamicRouteId");
      expect(source, route.file).toContain("retry: false");
      expect(source, route.file).toContain(route.missingGuard);
      expect(source, route.file).toContain("<DynamicResourceTerminalState");
    }
  });

  it("terminates missing inventory edit documents before their forms render", async () => {
    const workflowSources = await Promise.all(
      [
        "src/components/inventory/receiving-workflow.tsx",
        "src/components/inventory/transfer-workflow.tsx",
        "src/components/inventory/write-off-workflow.tsx",
      ].map(readSource),
    );

    workflowSources.forEach((source) => {
      expect(source).toContain("retry: false");
      expect(source).toContain("editableDocumentQuery.isSuccess && !editableDocument");
      expect(source).toContain("<DynamicResourceTerminalState");
      expect(source).toContain('t("movementJournal.documentNotFound")');
    });
  });

  it("retains explicit terminal handling on the three previously passing patterns", async () => {
    const movement = await readSource("src/app/(app)/inventory/movements/[id]/page.tsx");
    const movementPrint = await readSource("src/app/inventory/movements/[id]/print/page.tsx");
    const purchaseOrder = await readSource("src/app/(app)/purchase-orders/[id]/page.tsx");

    expect(movement).toContain("!document ?");
    expect(movement).toContain('t("documentNotFound")');
    expect(movementPrint).toContain("notFound()");
    expect(purchaseOrder).toContain("if (!po)");
    expect(purchaseOrder).toContain('t("notFound")');
  });
});
