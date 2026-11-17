// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReportTable } from "@/components/reports/report-controls";
import { TableBody, TableCell, TableRow } from "@/components/ui/table";
import ru from "../../messages/ru.json";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const originalScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");

let scrollWidth = 900;

const table = (
  <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Bishkek">
    <ReportTable className="min-w-[1100px]">
      <TableBody>
        <TableRow>
          <TableCell>Полнота</TableCell>
        </TableRow>
      </TableBody>
    </ReportTable>
  </NextIntlClientProvider>
);

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get: () => scrollWidth,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 500,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  scrollWidth = 900;
  if (originalScrollWidth) {
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", originalScrollWidth);
  }
  if (originalClientWidth) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
  }
});

describe("report table horizontal overflow hint", () => {
  it("shows the localized scroll hint when the table is wider than its container", () => {
    render(table);
    expect(screen.getByText(ru.reporting.tableScrollHint)).toBeTruthy();
  });

  it("does not show the hint when the table fits", () => {
    scrollWidth = 500;
    render(table);
    expect(screen.queryByText(ru.reporting.tableScrollHint)).toBeNull();
  });
});
