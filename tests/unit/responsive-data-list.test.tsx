// @vitest-environment jsdom

import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResponsiveDataList } from "@/components/responsive-data-list";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const renderServerPaginatedList = (onPageChange: (page: number) => void) => (
  <ResponsiveDataList
    items={[{ id: "row-1", label: "Movement" }]}
    getKey={(item) => item.id}
    page={1}
    totalItems={40}
    onPageChange={onPageChange}
    onPageSizeChange={() => undefined}
    renderDesktop={(items) => (
      <div>
        {items.map((item) => (
          <span key={item.id}>{item.label}</span>
        ))}
      </div>
    )}
    renderMobile={(item) => <span>{item.label}</span>}
  />
);

describe("ResponsiveDataList", () => {
  it("does not reset server pagination only because the callback identity changed", async () => {
    const firstOnPageChange = vi.fn();
    const secondOnPageChange = vi.fn();
    const { rerender } = render(renderServerPaginatedList(firstOnPageChange));

    await waitFor(() => {
      expect(firstOnPageChange).toHaveBeenCalledTimes(1);
    });
    expect(firstOnPageChange).toHaveBeenCalledWith(1);

    rerender(renderServerPaginatedList(secondOnPageChange));
    await tick();

    expect(secondOnPageChange).not.toHaveBeenCalled();
  });
});
